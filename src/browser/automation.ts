import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";

import type {
  BrowserAction,
  BrowserObservation,
  BrowserProviderSession,
} from "./types";
import { BrowserProviderError } from "./types";

const ACTION_CAPABILITIES: Record<BrowserAction["type"], string> = {
  click: "browser.interact",
  navigate: "browser.interact",
  observe: "browser.observe",
  type: "browser.interact",
  upload: "browser.upload",
};

const CDP_CONNECT_ATTEMPTS = 5;
const CDP_CONTEXT_WAIT_ATTEMPTS = 50;

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function disconnect(browser: Browser) {
  if (browser.isConnected()) {
    await browser.close({ reason: "Agent Labs CDP step completed." });
  }
}

async function waitForDefaultContext(browser: Browser) {
  for (let attempt = 1; attempt <= CDP_CONTEXT_WAIT_ATTEMPTS; attempt += 1) {
    if (!browser.isConnected()) return null;
    const context = browser.contexts()[0];
    if (context) return context;
    await delay(100);
  }
  return null;
}

async function connectRemoteBrowser(
  session: BrowserProviderSession,
): Promise<{ browser: Browser; context: BrowserContext; attempt: number }> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= CDP_CONNECT_ATTEMPTS; attempt += 1) {
    let browser: Browser | null = null;
    try {
      browser = await chromium.connectOverCDP(session.automationEndpoint, {
        timeout: 30_000,
      });
      const context = await waitForDefaultContext(browser);
      if (!context) {
        throw new Error(
          browser.isConnected()
            ? "Steel did not expose its default browser context in time."
            : "Steel closed the CDP connection before exposing a browser context.",
        );
      }
      return { browser, context, attempt };
    } catch (error) {
      lastError = error;
      if (browser) await disconnect(browser).catch(() => undefined);
      if (attempt < CDP_CONNECT_ATTEMPTS) {
        await delay(attempt * 1_000);
      }
    }
  }

  throw new BrowserProviderError(
    "automation_failed",
    `Playwright could not attach to the live Steel session after ${CDP_CONNECT_ATTEMPTS} attempts: ${errorMessage(lastError)}`,
    true,
    {
      attempts: CDP_CONNECT_ATTEMPTS,
      providerSessionSuffix: session.providerSessionId.slice(-8),
    },
  );
}

export function validateBrowserAction(
  action: BrowserAction,
  permittedCapabilities: readonly string[],
) {
  const required = ACTION_CAPABILITIES[action.type];
  if (!permittedCapabilities.includes(required)) {
    throw new BrowserProviderError(
      "automation_failed",
      `Browser action ${action.type} requires ${required}.`,
      false,
      { actionType: action.type, requiredCapability: required },
    );
  }

  if (action.type === "navigate") {
    const url = new URL(action.url);
    if (!["https:", "http:"].includes(url.protocol)) {
      throw new BrowserProviderError(
        "automation_failed",
        "Browser navigation is limited to HTTP and HTTPS URLs.",
        false,
      );
    }
  }
}

async function observePage(page: Page): Promise<BrowserObservation> {
  const state = await page.evaluate(() => {
    const upload = document.querySelector<HTMLInputElement>(
      "#agent-labs-stage8-upload",
    );
    const interactionCount = Number(
      document.documentElement.dataset.agentLabsOwnerInteractions ?? "0",
    );
    return {
      automationMarker:
        document.documentElement.dataset.agentLabsAutomationMarker ?? null,
      ownerInteractionCount: Number.isFinite(interactionCount)
        ? interactionCount
        : 0,
      text: (document.body?.innerText ?? "").slice(0, 2_000),
      uploadName: upload?.files?.[0]?.name ?? null,
    };
  });

  return {
    url: page.url(),
    title: await page.title(),
    text: state.text,
    uploadQualified: state.uploadName === "stage8-browser-proof.txt",
    uploadName: state.uploadName,
    ownerInteractionCount: state.ownerInteractionCount,
    automationMarker: state.automationMarker,
  };
}

export async function withBrowserSessionPage<T>(
  session: BrowserProviderSession,
  operation: (page: Page, connectionAttempt: number) => Promise<T>,
) {
  const { browser, context, attempt } = await connectRemoteBrowser(session);

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    return await operation(page, attempt);
  } finally {
    await disconnect(browser);
  }
}

export async function prepareQualificationPage(
  session: BrowserProviderSession,
): Promise<BrowserObservation> {
  return withBrowserSessionPage(session, async (page) => {
    const permitted = [
      "browser.observe",
      "browser.interact",
      "browser.upload",
    ];
    const navigate: BrowserAction = {
      type: "navigate",
      url: `https://example.com/?agent-labs-stage8=${encodeURIComponent(
        session.providerSessionId,
      )}`,
    };
    validateBrowserAction(navigate, permitted);
    await page.goto(navigate.url, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });

    await page.evaluate(() => {
      document.title = "Agent Labs Stage 8 Browser Qualification";
      document.documentElement.dataset.agentLabsOwnerInteractions = "0";
      const existing = document.querySelector("#agent-labs-stage8-panel");
      existing?.remove();
      const panel = document.createElement("section");
      panel.id = "agent-labs-stage8-panel";
      panel.style.cssText =
        "margin:24px 0;padding:20px;border:2px solid #2f855a;border-radius:14px;background:#ecfdf5;color:#102a22;font-family:system-ui";
      panel.innerHTML = `
        <h2 style="margin:0 0 8px">Agent Labs remote browser qualification</h2>
        <p style="margin:0 0 14px">The browser is under automation control. When Take Control is enabled, click the button below before returning control.</p>
        <button id="agent-labs-stage8-human-proof" style="padding:10px 16px;border:0;border-radius:9px;background:#166534;color:white;font-weight:700;cursor:pointer">Record human interaction</button>
        <input id="agent-labs-stage8-upload" type="file" style="display:block;margin-top:14px" />
        <output id="agent-labs-stage8-output" style="display:block;margin-top:12px;font-weight:700">Human interactions: 0</output>
      `;
      document.body.appendChild(panel);
      panel
        .querySelector<HTMLButtonElement>("#agent-labs-stage8-human-proof")
        ?.addEventListener("click", () => {
          const current = Number(
            document.documentElement.dataset.agentLabsOwnerInteractions ?? "0",
          );
          const next = current + 1;
          document.documentElement.dataset.agentLabsOwnerInteractions = String(next);
          const output = document.querySelector<HTMLOutputElement>(
            "#agent-labs-stage8-output",
          );
          if (output) output.value = `Human interactions: ${next}`;
        });
    });

    const upload: BrowserAction = {
      type: "upload",
      selector: "#agent-labs-stage8-upload",
      fileName: "stage8-browser-proof.txt",
      mimeType: "text/plain",
      content: "Agent Labs Stage 8 upload qualification",
    };
    validateBrowserAction(upload, permitted);
    await page.locator(upload.selector).setInputFiles({
      buffer: Buffer.from(upload.content, "utf8"),
      mimeType: upload.mimeType,
      name: upload.fileName,
    });

    return observePage(page);
  });
}

export async function verifyReturnedControl(
  session: BrowserProviderSession,
): Promise<BrowserObservation> {
  return withBrowserSessionPage(session, async (page) => {
    const beforeResume = await observePage(page);
    if (beforeResume.ownerInteractionCount < 1) {
      throw new BrowserProviderError(
        "automation_failed",
        "Return control was requested before the owner recorded a human interaction.",
        false,
        { ownerInteractionCount: beforeResume.ownerInteractionCount },
      );
    }
    if (!beforeResume.uploadQualified) {
      throw new BrowserProviderError(
        "automation_failed",
        "The qualification upload was not preserved through human takeover.",
        false,
        { uploadName: beforeResume.uploadName },
      );
    }

    await page.evaluate(() => {
      document.documentElement.dataset.agentLabsAutomationMarker =
        `returned-${Date.now()}`;
      const panel = document.querySelector<HTMLElement>(
        "#agent-labs-stage8-panel",
      );
      if (panel) {
        panel.style.borderColor = "#2563eb";
        const previous = document.querySelector("#agent-labs-stage8-returned");
        previous?.remove();
        const status = document.createElement("p");
        status.id = "agent-labs-stage8-returned";
        status.textContent = "Control returned to Agent Labs automation.";
        status.style.fontWeight = "800";
        panel.appendChild(status);
      }
    });
    const observation = await observePage(page);
    if (!observation.automationMarker) {
      throw new BrowserProviderError(
        "automation_failed",
        "Automation could not verify control after owner takeover.",
        false,
      );
    }
    return observation;
  });
}
