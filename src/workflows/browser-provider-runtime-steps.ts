import {
  browserSessionReplay,
  createBrowserProviderAdapter,
  estimateBrowserCostUsd,
  prepareBrowserQualification,
  verifyReturnedBrowserControl,
} from "@/browser";
import type { BrowserProviderKey, BrowserReplay } from "@/browser";
import { createRuntimeClient } from "@/lib/supabase/runtime";

import type {
  BrowserControlDecision,
  BrowserProviderRuntimeInput,
} from "./browser-provider-runtime";

type JsonRecord = Record<string, unknown>;

type BrowserRuntimeAccess = {
  browserSessionId: string;
  providerKey: BrowserProviderKey;
  providerSessionId: string | null;
  providerProfileId: string | null;
  status: string;
  controlMode: string;
  websocketUrl: string | null;
  debugUrl: string | null;
  sessionViewerUrl: string | null;
  replayUrl: string | null;
  startedAt: string | null;
  releasedAt: string | null;
};

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Unknown browser runtime error";
}

async function transition(
  input: BrowserProviderRuntimeInput,
  operation: string,
  payload: JsonRecord = {},
) {
  const supabase = createRuntimeClient();
  const { data, error } = await supabase.rpc("stage8_browser_runtime_transition", {
    p_business_id: input.businessId,
    p_operation: operation,
    p_payload: payload,
    p_runtime_capability: input.runtimeCapability,
    p_workflow_run_id: input.coreWorkflowRunId,
  });
  if (error) throw new Error(`${operation}: ${error.message}`);
  return asRecord(data);
}

async function runtimeAccess(input: BrowserProviderRuntimeInput) {
  const supabase = createRuntimeClient();
  const { data, error } = await supabase.rpc("stage8_browser_runtime_access", {
    p_business_id: input.businessId,
    p_runtime_capability: input.runtimeCapability,
    p_workflow_run_id: input.coreWorkflowRunId,
  });
  if (error) throw new Error(`browser_runtime_access: ${error.message}`);
  return asRecord(data) as BrowserRuntimeAccess;
}

export async function startBrowserProviderWorkflow(
  input: BrowserProviderRuntimeInput,
  runtimeRunId: string,
) {
  "use step";
  await transition(input, "runtime_started", { runtimeRunId });
}

export async function launchAndPrepareBrowser(
  input: BrowserProviderRuntimeInput,
) {
  "use step";

  const adapter = createBrowserProviderAdapter(input.providerKey);
  const reusableProfileId =
    input.providerProfileId && !input.providerProfileId.startsWith("pending:")
      ? input.providerProfileId
      : null;
  let providerSessionId: string | null = null;

  try {
    const session = await adapter.createSession({
      timeoutMs: 900_000,
      inactivityTimeoutMs: null,
      persistent: true,
      providerProfileId: reusableProfileId,
      metadata: {
        agentLabsWorkflowRunId: input.coreWorkflowRunId,
        browserSessionId: input.browserSessionId,
        qualification: "stage8",
      },
    });
    providerSessionId = session.providerSessionId;
    const verification = await prepareBrowserQualification(session.connectUrl);

    await transition(input, "session_launched", {
      browserMode: "headful",
      currentUrl: verification.currentUrl,
      debugUrl: session.liveViewUrl,
      pageTitle: verification.title,
      profileId: session.providerProfileId,
      providerSessionId: session.providerSessionId,
      region: input.providerKey === "steel" ? "us-east" : null,
      sessionViewerUrl: session.sessionViewerUrl,
      uploadName: "stage8-browser-upload.txt",
      uploadQualified: verification.uploadVerified,
      websocketUrl: session.connectUrl,
    });

    return {
      browserSessionId: input.browserSessionId,
      providerSessionId: session.providerSessionId,
      providerProfileId: session.providerProfileId,
      status: "live" as const,
    };
  } catch (error) {
    if (providerSessionId) {
      try {
        await adapter.releaseSession(providerSessionId);
      } catch {
        // The failure transition below remains authoritative even if cleanup also fails.
      }
    }
    await transition(input, "session_failed", {
      failure: {
        category:
          error && typeof error === "object" && "category" in error
            ? String(error.category)
            : "provider_unavailable",
        message: errorMessage(error).slice(0, 1000),
      },
      stageKey: "launch",
    });
    throw error;
  }
}

export async function recordBrowserControlTaken(
  input: BrowserProviderRuntimeInput,
  decision: BrowserControlDecision,
) {
  "use step";
  await transition(input, "control_taken", {
    decidedAt: decision.decidedAt,
    ownerUserId: decision.ownerUserId,
  });
}

export async function recordBrowserControlReturned(
  input: BrowserProviderRuntimeInput,
  decision: BrowserControlDecision,
) {
  "use step";
  await transition(input, "control_returned", {
    decidedAt: decision.decidedAt,
    ownerUserId: decision.ownerUserId,
  });
}

export async function verifyBrowserAutomationResumed(
  input: BrowserProviderRuntimeInput,
) {
  "use step";
  const access = await runtimeAccess(input);
  if (!access.websocketUrl) {
    throw new Error("The browser connection URL is unavailable after owner takeover.");
  }

  const verification = await verifyReturnedBrowserControl(access.websocketUrl);
  await transition(input, "automation_verified", {
    automationMarker: verification.marker,
    currentUrl: verification.currentUrl,
    ownerInteractionCount: 1,
    pageTitle: verification.title,
  });

  return verification;
}

export async function releaseBrowserProviderSession(
  input: BrowserProviderRuntimeInput,
) {
  "use step";
  const access = await runtimeAccess(input);
  if (!access.providerSessionId) {
    throw new Error("The browser provider session ID is unavailable for release.");
  }

  const adapter = createBrowserProviderAdapter(access.providerKey);
  await adapter.releaseSession(access.providerSessionId);

  const startedAt = access.startedAt ? new Date(access.startedAt).getTime() : Date.now();
  return {
    providerKey: access.providerKey,
    providerSessionId: access.providerSessionId,
    sessionViewerUrl: access.sessionViewerUrl,
    estimatedCostUsd: estimateBrowserCostUsd(
      access.providerKey,
      Math.max(0, Date.now() - startedAt),
    ),
  };
}

export async function checkBrowserReplay(
  input: BrowserProviderRuntimeInput,
): Promise<BrowserReplay> {
  "use step";
  const access = await runtimeAccess(input);
  if (!access.providerSessionId) {
    throw new Error("The browser provider session ID is unavailable for replay lookup.");
  }
  return browserSessionReplay(access.providerSessionId, access.providerKey);
}

export async function storeBrowserReplayAndComplete(
  input: BrowserProviderRuntimeInput,
  replay: BrowserReplay,
  sessionViewerUrl: string | null,
  estimatedCostUsd: number,
) {
  "use step";
  const supabase = createRuntimeClient();
  const replayUrl = replay.url ?? sessionViewerUrl;
  const status = replay.available && replayUrl ? "ready" : "unavailable";

  const { error } = await supabase.rpc("stage8_browser_store_replay", {
    p_business_id: input.businessId,
    p_replay_url: replayUrl,
    p_runtime_capability: input.runtimeCapability,
    p_status: status,
    p_workflow_run_id: input.coreWorkflowRunId,
  });
  if (error) throw new Error(`browser_replay_store: ${error.message}`);

  if (status !== "ready") {
    throw new Error("The browser provider did not expose an accessible replay.");
  }

  await transition(input, "session_released", {
    estimatedCostUsd,
    replayReady: true,
  });
}

export async function recordUnexpectedBrowserFailure(
  input: BrowserProviderRuntimeInput,
  stageKey: string,
  error: unknown,
) {
  "use step";

  try {
    const access = await runtimeAccess(input);
    if (access.providerSessionId && access.status !== "released") {
      try {
        await createBrowserProviderAdapter(access.providerKey).releaseSession(
          access.providerSessionId,
        );
      } catch {
        // Record the original failure even when provider cleanup cannot complete.
      }
    }
  } catch {
    // Runtime access can legitimately fail if launch never reached the provider.
  }

  await transition(input, "session_failed", {
    failure: {
      category:
        error && typeof error === "object" && "category" in error
          ? String(error.category)
          : "provider_unavailable",
      message: errorMessage(error).slice(0, 1000),
    },
    stageKey,
  });
}
