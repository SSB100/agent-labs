/** Typed presentation-only feedback. Raw provider/database errors never enter URLs or UI. */
const catalog = {
  "products": {
    "message": {
      "duplicate-research-prevented-the-existing-experiment-decision-and-eviden": "Duplicate research prevented. The existing experiment, decision, and evidence remain authoritative; a new attempt needs genuinely new evidence.",
      "evidence-linked-owner-assessment-saved-this-is-a-provisional-research-de": "Evidence-linked owner assessment saved. This is a provisional research decision and does not authorize creative production or publication.",
      "existing-completed-research-reconciled-without-another-provider-call": "Existing completed research reconciled without another provider call.",
      "outcome-unconfirmed": "An action response was returned. Verify the exact saved record before continuing.",
      "evidence-already-considered": "That evidence has already been considered. The existing experiment was reused.",
      "new-evidence-recorded": "New research evidence recorded as a separate experiment. Earlier decisions remain in the registry."
    },
    "error": {
      "invalid-product-reference": "Invalid product reference.",
      "candidate-not-found": "Candidate not found.",
      "research-launch-could-not-be-confirmed-the-reservation-is-preserved-to-p": "Research launch could not be confirmed. The reservation is preserved to prevent duplicate provider calls. Check its workflow before trying again.",
      "a-completed-research-experiment-is-required": "A completed research experiment is required.",
      "outcome-unconfirmed": "The action outcome could not be confirmed. Your nonsecret draft remains in this tab. Inspect the exact saved record and its reservations before trying again."
    }
  },
  "artifacts": {
    "message": {
      "specific-technical-creative-approval-saved-it-authorizes-one-bounded-run": "Specific technical creative approval saved. It authorizes one bounded run; market validation and publication remain separate.",
      "duplicate-launch-prevented-the-original-creative-run-and-cost-reservatio": "Duplicate launch prevented. The original creative run and cost reservations remain authoritative.",
      "separate-candidate-creative-approval-saved-review-and-start-its-single-b": "Separate candidate creative approval saved. Review and start its single bounded run when ready; publication is not authorized.",
      "expired-run-closed-for-owner-review-existing-artifacts-receipts-and-unce": "Expired run closed for owner review. Existing artifacts, receipts and uncertain reservations are preserved; no provider call was made.",
      "outcome-unconfirmed": "An action response was returned. Verify the exact saved record before continuing."
    },
    "error": {
      "explicitly-choose-the-image-and-repair-limit-before-saving-a-new-approva": "Explicitly choose the image and repair limit before saving a new approval.",
      "choose-one-image-with-no-repair-or-up-to-two-images-with-one-repair": "Choose one image with no repair, or up to two images with one repair.",
      "explicitly-select-the-supported-bfl-native-png-provider-before-saving-a": "Explicitly select the supported BFL native-PNG provider before saving a new approval.",
      "acknowledge-the-bfl-openrouter-data-use-disclosure-including-its-retenti": "Acknowledge the BFL/OpenRouter data-use disclosure, including its retention and training-license uncertainty.",
      "business-or-approval-reference-not-found": "Business or approval reference not found.",
      "confirm-the-specific-original-design-technical-scope-print-specification": "Confirm the specific original design, technical scope, print specification, provider terms and total allowance.",
      "provide-the-specific-original-concept-audience-and-50-1500-character-des": "Provide the specific original concept, audience and 50\u20131500 character design instructions.",
      "this-technical-test-allows-at-most-us-1-total-across-all-phases": "This technical test allows at most US$1 total across all phases.",
      "current-conservative-estimate-exceeds-the-allowance-no-provider-call-was": "Current conservative estimate exceeds the allowance; no provider call was made.",
      "invalid-creative-approval-reference": "Invalid creative approval reference.",
      "creative-approval-not-found": "Creative approval not found.",
      "creative-launch-could-not-be-confirmed-its-reservation-is-preserved-chec": "Creative launch could not be confirmed. Its reservation is preserved; check the existing run before another attempt.",
      "invalid-candidate-or-approval-reference": "Invalid candidate or approval reference.",
      "confirm-the-exact-candidate-original-instructions-policy-screen-print-sp": "Confirm the exact candidate, original instructions, policy screen, print specification, terms and allowance.",
      "owned-candidate-not-found": "Owned candidate not found.",
      "the-candidate-decision-changed-review-the-current-evidence-before-approv": "The candidate decision changed. Review the current evidence before approving.",
      "the-complete-candidate-evaluation-history-could-not-be-checked": "The complete candidate evaluation history could not be checked.",
      "the-reviewed-discovery-root-could-not-be-checked": "The reviewed discovery root could not be checked.",
      "a-current-evidence-backed-reviewed-test-is-required-unresolved-blockers": "A current evidence-backed reviewed TEST is required. Unresolved blockers cannot be waived by creative approval.",
      "this-bounded-creative-run-allows-at-most-us-1-across-all-phases": "This bounded creative run allows at most US$1 across all phases.",
      "invalid-creative-run-reference": "Invalid creative run reference.",
      "outcome-unconfirmed": "The action outcome could not be confirmed. Your nonsecret draft remains in this tab. Inspect the exact saved record and its reservations before trying again."
    }
  },
  "packs": {
    "message": {
      "outcome-unconfirmed": "An action response was returned. Verify the exact saved record before continuing.",
      "pack-activated": "Pack activated."
    },
    "error": {
      "workflow-input-invalid": "Check the installed workflow required JSON input. No workflow was reserved.",
      "business-not-found": "Business not found.",
      "pack-catalog-could-not-be-loaded": "Pack catalog could not be loaded.",
      "web-research-qualification-could-not-start": "Web Research qualification could not start.",
      "active-installation-not-found": "Active installation not found.",
      "workflow-could-not-start-try-a-new-launch": "Workflow could not start. Try a new launch.",
      "etsy-discovery-simulation-could-not-start-no-external-provider-was-calle": "Etsy discovery simulation could not start. No external provider was called.",
      "outcome-unconfirmed": "The action outcome could not be confirmed. Your nonsecret draft remains in this tab. Inspect the exact saved record and its reservations before trying again."
    }
  }
} as const;
export type RetainedTool = keyof typeof catalog;
export function retainedFeedbackMessage(tool:RetainedTool,kind:"error"|"message",code:unknown) {
  const entries:Readonly<Record<string,string>>=catalog[tool][kind];
  return typeof code === "string" ? entries[code] ?? entries["outcome-unconfirmed"] : undefined;
}
export function retainedFeedbackHref(tool:RetainedTool,kind:"error"|"message",detail:string,scope:{business?:string;panel:string;candidate?:string}) {
  const entries:Readonly<Record<string,string>>=catalog[tool][kind];
  const code=Object.keys(entries).find(key=>entries[key]===detail) ?? "outcome-unconfirmed";
  const query=new URLSearchParams({panel:scope.panel,[kind]:code});
  if(scope.business)query.set("business",scope.business);
  if(scope.candidate)query.set("candidate",scope.candidate);
  return `/dashboard/${tool}?${query}`;
}

const workflowMessages: Record<string, string> = {
  "browser-control-returned": "Control returned. Agent Labs is reconnecting automation.",
  "browser-control-taken": "Takeover approved. The live browser is now interactive.",
  "browser-duplicate-prevented": "The existing browser qualification remains authoritative.",
  "browser-workflow-started": "Remote browser qualification started.",
  "browser-planner-workflow-started": "Browser Planner qualification started.",
  "browser-planner-duplicate-prevented": "The existing Browser Planner qualification remains authoritative.",
  "review-approved": "Decision recorded. The durable workflow is resuming.",
  "review-failed": "Failure decision recorded. The workflow is closing safely.",
  "workflow-duplicate-prevented": "The existing workflow remains authoritative.",
  "workflow-started": "Durable workflow started. Live activity will appear below.",
};

const workflowErrors: Record<string, string> = {
  "browser-control-not-open": "That browser-control request is no longer open.",
  "browser-control-resume-failed": "The browser workflow could not resume.",
  "browser-launch-failed": "The remote browser workflow could not launch.",
  "browser-planner-launch-failed": "The Browser Planner workflow could not launch.",
  "invalid-browser-control": "The browser-control request was invalid.",
  "invalid-review-decision": "The review decision was invalid.",
  "review-not-open": "That review is no longer open.",
  "review-resume-failed": "The workflow could not be resumed.",
};
export function retainedWorkflowFeedback(kind:"error"|"message",code:unknown){
  const entries=kind==="error"?workflowErrors:workflowMessages;
  return typeof code==="string" ? entries[code] ?? (kind==="error"?"The action outcome could not be confirmed. Inspect the saved record before retrying.":"Inspect the saved record to confirm the action outcome.") : undefined;
}
