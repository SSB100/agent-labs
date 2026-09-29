import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { chromium, type Browser } from "playwright-core";

import {
  prepareQualificationPage,
  verifyReturnedControl,
} from "@/browser/automation";
import { createBrowserProviderAdapter } from "@/browser/registry";
import type { BrowserProviderSession } from "@/browser/types";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const TOKEN_HASH =
  "e3f9237206edda0d604dc19efa270552205795be4ff557b1333e3118a66cfd31";

type DisconnectableBrowser = Browser & {
  _connection?: {
    close(): Promise<void> | void;
  };
};

function authorized(token: string) {
  const supplied = createHash("sha256").update(token).digest();
  const expected = Buffer.from(TOKEN_HASH, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function disconnect(browser: Browser) {
  const connection = (browser as DisconnectableBrowser)._connection;
  if (connection) await connection.close();
}

function errorDetails(error: unknown) {
  if (error && typeof error === "object") {
    return {
      category:
        "category" in error ? String(error.category) : "live_check_failed",
      message:
        "message" in error
          ? String(error.message).slice(0, 800)
          : "Unknown live provider error",
      name: "name" in error ? String(error.name) : "UnknownError",
    };
  }

  return {
    category: "live_check_failed",
    message: "Unknown live provider error",
    name: "UnknownError",
  };
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function verifyLiveView(session: BrowserProviderSession, interactive: boolean) {
  const url = new URL(session.debugUrl);
  url.searchParams.set("interactive", interactive ? "true" : "false");
  url.searchParams.set("showControls", "true");
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const html = await response.text();
  return {
    bytes: html.length,
    ready:
      response.ok &&
      (html.includes("baseWsUrl") ||
        html.includes("sessions/cast") ||
        html.includes("WebSocket")),
    status: response.status,
  };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  if (
    process.env.VERCEL_ENV !== "preview" ||
    !authorized(requestUrl.searchParams.get("token") ?? "")
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const adapter = createBrowserProviderAdapter("steel");
  let session: BrowserProviderSession | null = null;
  let released = false;
  const startedAt = Date.now();

  try {
    session = await adapter.createSession({
      browserSessionId: randomUUID(),
      profileId: null,
      timeoutMs: 300_000,
    });

    const readOnlyLiveView = await verifyLiveView(session, false);
    const interactiveLiveView = await verifyLiveView(session, true);
    if (!readOnlyLiveView.ready || !interactiveLiveView.ready) {
      throw new Error(
        `Steel live view was unavailable: ${JSON.stringify({ readOnlyLiveView, interactiveLiveView })}`,
      );
    }

    const prepared = await prepareQualificationPage(session);

    const humanBrowser = await chromium.connectOverCDP(
      session.automationEndpoint,
      { timeout: 30_000 },
    );
    let humanInteractionCount = 0;
    try {
      const context = humanBrowser.contexts()[0];
      const page = context?.pages()[0];
      if (!page) throw new Error("The human-control page was unavailable.");
      await page.locator("#agent-labs-stage8-human-proof").click();
      humanInteractionCount = await page.evaluate(() =>
        Number(
          document.documentElement.dataset.agentLabsOwnerInteractions ?? "0",
        ),
      );
    } finally {
      await disconnect(humanBrowser);
    }

    const resumedSession = await adapter.retrieveSession(
      session.providerSessionId,
    );
    const resumed = await verifyReturnedControl(resumedSession);

    await adapter.releaseSession(session.providerSessionId);
    released = true;

    let replayReady = false;
    let replayBytes = 0;
    let replayContentType = "";
    let replayAttempt = 0;
    let replayFailure: ReturnType<typeof errorDetails> | null = null;

    for (let attempt = 1; attempt <= 12; attempt += 1) {
      replayAttempt = attempt;
      try {
        const response = await adapter.fetchReplay(session.providerSessionId);
        replayContentType = response.headers.get("content-type") ?? "";
        const body = await response.text();
        replayBytes = body.length;
        replayReady =
          body.includes("#EXTM3U") ||
          replayContentType.includes("mpegurl") ||
          replayContentType.includes("video/");
        if (replayReady) break;
      } catch (error) {
        replayFailure = errorDetails(error);
      }

      await delay(5_000);
    }

    const checks = {
      humanInteraction: humanInteractionCount >= 1,
      interactiveLiveView: interactiveLiveView.ready,
      persistentProfile: Boolean(session.profileId),
      playwrightConnected: true,
      readOnlyLiveView: readOnlyLiveView.ready,
      replayReady,
      returnedControl:
        resumed.ownerInteractionCount >= 1 &&
        Boolean(resumed.automationMarker),
      sessionReleased: released,
      uploadQualified:
        prepared.uploadQualified && resumed.uploadQualified,
    };
    const passed = Object.values(checks).every(Boolean);

    return Response.json(
      {
        checks,
        durationMs: Date.now() - startedAt,
        liveView: {
          interactiveBytes: interactiveLiveView.bytes,
          readOnlyBytes: readOnlyLiveView.bytes,
        },
        provider: "steel",
        replay: {
          attempts: replayAttempt,
          bytes: replayBytes,
          contentType: replayContentType,
          failure: replayReady ? null : replayFailure,
        },
        session: {
          browserMode: session.browserMode,
          idSuffix: session.providerSessionId.slice(-8),
          region: session.region,
        },
        status: passed ? "passed" : "partial",
      },
      { status: passed ? 200 : 502 },
    );
  } catch (error) {
    if (session && !released) {
      await adapter
        .releaseSession(session.providerSessionId)
        .catch(() => undefined);
    }

    return Response.json(
      {
        durationMs: Date.now() - startedAt,
        error: errorDetails(error),
        provider: "steel",
        sessionReleasedAfterFailure: Boolean(session),
        status: "failed",
      },
      { status: 500 },
    );
  }
}
