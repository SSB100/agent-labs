import {
  prepareQualificationPage,
  verifyReturnedControl,
} from "@/browser/automation";
import { createBrowserProviderAdapter } from "@/browser/registry";
import { BrowserProviderError } from "@/browser/types";
import { createRuntimeClient } from "@/lib/supabase/runtime";

import type {
  BrowserControlDecision,
  BrowserProviderRuntimeInput,
} from "./browser-provider-runtime";

type FailureSummary = {
  category: string;
  message: string;
  name: string;
};

function errorMessage(error: unknown) {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Unknown Supabase error";
}

async function transition(
  input: BrowserProviderRuntimeInput,
  operation: string,
  payload: Record<string, unknown> = {},
) {
  const supabase = createRuntimeClient();
  const { data, error } = await supabase.rpc("stage8_browser_runtime_transition", {
    p_business_id: input.businessId,
    p_operation: operation,
    p_payload: payload,
    p_runtime_capability: input.runtimeCapability,
    p_workflow_run_id: input.coreWorkflowRunId,
  });
  if (error) throw new Error(`${operation}: ${errorMessage(error)}`);
  return data;
}

export async function startBrowserWorkflow(
  input: BrowserProviderRuntimeInput,
  runtimeRunId: string,
) {
  "use step";
  await transition(input, "runtime_started", { runtimeRunId });
}

export async function launchAndObserveBrowser(
  input: BrowserProviderRuntimeInput,
) {
  "use step";

  const adapter = createBrowserProviderAdapter(input.providerKey);
  const session = await adapter.createSession({
    browserSessionId: input.browserSessionId,
    profileId: input.providerProfileId,
    timeoutMs: 15 * 60 * 1_000,
  });

  try {
    const observation = await prepareQualificationPage(session);
    await transition(input, "session_launched", {
      browserMode: session.browserMode,
      currentUrl: observation.url,
      debugUrl: session.debugUrl,
      pageTitle: observation.title,
      profileId: session.profileId,
      providerSessionId: session.providerSessionId,
      region: session.region,
      sessionViewerUrl: session.sessionViewerUrl,
      uploadName: observation.uploadName,
      uploadQualified: observation.uploadQualified,
      websocketUrl: session.automationEndpoint.replace(
        /([?&])apiKey=[^&]+/,
        "$1apiKey=REDACTED",
      ),
    });
    return session.providerSessionId;
  } catch (error) {
    await adapter.releaseSession(session.providerSessionId).catch(() => undefined);
    throw error;
  }
}

export async function recordBrowserControlTaken(
  input: BrowserProviderRuntimeInput,
  decision: BrowserControlDecision,
) {
  "use step";
  await transition(input, "control_taken", decision);
}

export async function recordBrowserControlReturned(
  input: BrowserProviderRuntimeInput,
  decision: BrowserControlDecision,
) {
  "use step";
  await transition(input, "control_returned", decision);
}

export async function verifyBrowserAutomationReturned(
  input: BrowserProviderRuntimeInput,
  providerSessionId: string,
) {
  "use step";

  const adapter = createBrowserProviderAdapter(input.providerKey);
  const session = await adapter.retrieveSession(providerSessionId);
  const observation = await verifyReturnedControl(session);
  await transition(input, "automation_verified", {
    automationMarker: observation.automationMarker,
    currentUrl: observation.url,
    ownerInteractionCount: observation.ownerInteractionCount,
    pageTitle: observation.title,
  });
}

export async function releaseQualifiedBrowser(
  input: BrowserProviderRuntimeInput,
  providerSessionId: string,
) {
  "use step";

  const adapter = createBrowserProviderAdapter(input.providerKey);
  await adapter.releaseSession(providerSessionId);
  await transition(input, "session_released", { replayReady: true });
}

export async function recordBrowserWorkflowFailure(
  input: BrowserProviderRuntimeInput,
  providerSessionId: string | null,
  stageKey: string,
  failure: FailureSummary,
) {
  "use step";

  if (providerSessionId) {
    const adapter = createBrowserProviderAdapter(input.providerKey);
    await adapter.releaseSession(providerSessionId).catch(() => undefined);
  }

  const normalizedFailure =
    failure instanceof BrowserProviderError
      ? {
          category: failure.category,
          message: failure.message,
          name: failure.name,
        }
      : failure;

  await transition(input, "session_failed", {
    failure: normalizedFailure,
    stageKey,
  }).catch(() => undefined);
}
