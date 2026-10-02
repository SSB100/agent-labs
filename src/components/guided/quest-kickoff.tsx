"use client";

import { useCallback, useEffect, useId, useReducer, useRef, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { startGeographicDiscovery } from "@/app/dashboard/products/discovery-actions";
import {
  QUEST_MARKET_SCOPE, newQuestState, questAllowanceMicrousd, questDraftStorageKey,
  questEstimate, questMoney, questReducer, questReviewKey, restoreQuestDraft,
  serializeQuestDraft, validateQuestDraft, validQuestQuote,
  type QuestDraft, type QuestIssue, type QuestQuotePreview, type QuestStep,
} from "@/lib/core-ui/quest-draft";
import "./quest-kickoff.css";

type QuestKickoffProps = {
  ownerId: string;
  businesses: { id: string; name: string }[];
  businessesUnavailable?: boolean;
  available: boolean;
  quote: QuestQuotePreview;
};
const steps = ["Goal", "Scope", "Review"] as const;

function ReviewConsent({ id, checked, disabled, invalid, onChange }: { id: string; checked: boolean; disabled: boolean; invalid: boolean; onChange: (checked: boolean) => void }) {
  const { pending } = useFormStatus();
  return <label className="questKickoffConsent" htmlFor={id}>
    <input id={id} type="checkbox" name="confirmResearch" value="on" required checked={checked} disabled={disabled || pending} onChange={event => onChange(event.target.checked)} aria-invalid={invalid}/>
    <span>I approve only this bounded research process and its allowance through the existing OpenRouter connection. A recommendation does not approve image generation, listings, advertising or purchases.</span>
  </label>;
}

function ReviewControls({ disabled, onBack, onSettled }: { disabled: boolean; onBack: () => void; onSettled: () => void }) {
  const { pending } = useFormStatus();
  useEffect(() => { if (!pending) onSettled(); }, [pending, onSettled]);
  return <div className="questKickoffActions">
    <button className="questKickoffButton questKickoffButtonSecondary" type="button" disabled={pending} onClick={onBack}>Back to scope</button>
    <button className="questKickoffButton" type="submit" disabled={disabled || pending} aria-disabled={disabled || pending}>
      {pending ? "Reserving the research workflow…" : "Start bounded research"}
    </button>
    {pending ? <p className="questKickoffPending" role="status">Checking the fresh quote and reserving this research. Please keep this page open.</p> : null}
  </div>;
}

/** Owner changes remount all in-memory state, including unsaved approval. */
export function QuestKickoff(props: QuestKickoffProps) {
  if (props.businessesUnavailable) return <section className="questKickoff" id="discovery-goal" aria-label="Research setup unavailable">
    <div className="questKickoffBody"><h2>Business context is unavailable</h2><p className="questKickoffNotice" role="alert">Your Businesses could not be loaded. Reload to try again before setting up research. Any saved local draft is left unchanged.</p></div>
  </section>;
  return <QuestKickoffForm key={props.ownerId} {...props} />;
}

function QuestKickoffForm({ ownerId, businesses, available, quote }: QuestKickoffProps) {
  const [state, dispatch] = useReducer(questReducer, businesses[0]?.id ?? "", newQuestState);
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const submittedRef = useRef(false);
  const focusRequestedRef = useRef(false);
  const businessIds = businesses.map(business => business.id);
  const businessIdsKey = JSON.stringify(businessIds);
  const { draft, step } = state;
  const estimate = questEstimate(draft, quote);
  const allowance = questAllowanceMicrousd(draft.maximumUsd);
  const estimateFits = estimate !== null && allowance !== null && estimate <= allowance;
  const ready = available && validQuestQuote(quote) && businessIds.includes(draft.businessId);
  const reviewKey = questReviewKey(ownerId, draft, quote, ready);
  const confirmed = state.consentKey === reviewKey;
  const estimateChanged = state.reviewedEstimate !== null && estimate !== null && state.reviewedEstimate !== estimate;
  const fieldId = (field: string) => `${id}-${field}`;
  const errorFor = (field: QuestIssue["field"]) => state.issues.find(issue => issue.field === field);

  useEffect(() => {
    let saved = null;
    let storageAvailable = true;
    try { saved = restoreQuestDraft(window.sessionStorage.getItem(questDraftStorageKey(ownerId)), ownerId, JSON.parse(businessIdsKey)); }
    catch { storageAvailable = false; }
    dispatch({ type: "restore", saved, storageAvailable });
    // Business-list refreshes must not overwrite an in-progress draft or consent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  useEffect(() => {
    if (!state.hydrated) return;
    try { window.sessionStorage.setItem(questDraftStorageKey(ownerId), serializeQuestDraft(ownerId, { draft, step, reviewedEstimate: state.reviewedEstimate })); }
    catch { dispatch({ type: "storage-unavailable" }); }
  }, [ownerId, draft, step, state.reviewedEstimate, state.hydrated]);

  useEffect(() => {
    if (!focusRequestedRef.current) return;
    focusRequestedRef.current = false;
    if (state.issues.length) errorRef.current?.focus();
    else headingRef.current?.focus();
  }, [step, state.issues]);

  const settled = useCallback(() => { submittedRef.current = false; }, []);
  function edit(field: keyof QuestDraft, value: string) { dispatch({ type: "edit", field, value }); }
  function goTo(next: QuestStep) {
    focusRequestedRef.current = true;
    dispatch({ type: "step", step: next, ...(next === 2 ? { reviewedEstimate: estimate } : {}) });
  }
  function showIssues(issues: QuestIssue[]) {
    focusRequestedRef.current = true;
    dispatch({ type: "issues", issues });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    if (submittedRef.current) { event.preventDefault(); return; }
    const issues = validateQuestDraft(draft, businessIds, step === 0 ? "goal" : "scope");
    if (step > 0 && estimate !== null && allowance !== null && estimate > allowance) issues.push({ field: "maximumUsd", message: "The complete estimate exceeds this allowance. Change the scope or explicitly raise the allowance, up to US$1." });
    if (step < 2) {
      event.preventDefault();
      if (issues.length) showIssues(issues);
      else goTo((step + 1) as QuestStep);
      return;
    }
    if (!ready) issues.push({ field: "availability", message: "Research cannot start until the workflow, Business and complete current quote are available." });
    if (!confirmed) issues.push({ field: "confirmResearch", message: "Review this scope and estimate, then confirm the bounded research allowance." });
    if (issues.length) { event.preventDefault(); showIssues(issues); return; }
    submittedRef.current = true;
  }
  function focusIssue(issue: QuestIssue) {
    const destination = ["businessId", "goal", "audienceHint"].includes(issue.field) ? 0 : ["maximumCollections", "maximumUsd"].includes(issue.field) ? 1 : 2;
    if (destination !== step) goTo(destination);
    else (document.getElementById(fieldId(issue.field)) ?? headingRef.current)?.focus();
  }

  return <section className="questKickoff" id="discovery-goal" aria-labelledby={`${id}-title`}>
    <header className="questKickoffHeader">
      <div><p className="questKickoffEyebrow">Start a research quest</p><h2 id={`${id}-title`}>Find a market worth exploring</h2><p>One clear goal. A fixed research scope. Your approval before paid work.</p></div>
      <span className="questKickoffBadge">Experimental · live qualification incomplete</span>
    </header>
    <ol className="questKickoffSteps" aria-label="Research setup progress">
      {steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} data-complete={step > index}><span aria-hidden="true">{index + 1}</span>{label}</li>)}
    </ol>
    <p className="questKickoffLocal" role="status">
      {state.storage === "unavailable" ? "Local saving is unavailable in this browser. Keep this page open to retain your draft." : state.restored ? "Local draft restored in this browser tab. Approval is never saved; review and confirm again before starting." : "Draft only · saved locally in this browser tab after loading. You can return or reload here; nothing is saved to your Business until you start."}
    </p>
    <form action={step === 2 ? startGeographicDiscovery : undefined} onSubmit={submit} noValidate>
      {step !== 0 ? <><input type="hidden" name="businessId" value={draft.businessId}/><input type="hidden" name="goal" value={draft.goal}/><input type="hidden" name="audienceHint" value={draft.audienceHint}/></> : null}
      {step !== 1 ? <><input type="hidden" name="maximumCollections" value={draft.maximumCollections}/><input type="hidden" name="maximumUsd" value={draft.maximumUsd}/></> : null}
      {state.issues.length ? <div className="questKickoffErrors" ref={errorRef} tabIndex={-1} role="alert" aria-labelledby={`${id}-errors`}>
        <h3 id={`${id}-errors`}>Check these details before continuing</h3>
        <ul>{state.issues.map(issue => <li key={issue.field}><button type="button" onClick={() => focusIssue(issue)}>{issue.message}</button></li>)}</ul>
      </div> : null}
      <div className="questKickoffBody">
        <div className="questKickoffStepHeading"><p className="questKickoffEyebrow">Step {step + 1} of 3</p><h3 ref={headingRef} tabIndex={-1}>{["What would you like to learn?", "Set the boundaries", "Review before research starts"][step]}</h3></div>
        {step === 0 ? <div className="questKickoffFields">
          <label htmlFor={fieldId("businessId")}>Business context
            <select id={fieldId("businessId")} name="businessId" required value={draft.businessId} onChange={event => edit("businessId", event.target.value)} aria-invalid={Boolean(errorFor("businessId"))}>
              {!businessIds.includes(draft.businessId) ? <option value="">Choose a Business</option> : null}
              {businesses.map(business => <option key={business.id} value={business.id}>{business.name}</option>)}
            </select>
            <small>Original goals and receipts stay private to this Business.</small>
          </label>
          {!businesses.length ? <p className="questKickoffNotice" role="status">Create a Business before starting research. You can still prepare your goal here.</p> : null}
          <label htmlFor={fieldId("goal")}>What do you want to learn about original POD T-shirts?
            <textarea id={fieldId("goal")} name="goal" rows={4} minLength={20} maxLength={1200} required value={draft.goal} onChange={event => edit("goal", event.target.value)} aria-describedby={fieldId("goal-help")} aria-invalid={Boolean(errorFor("goal"))}/>
            <small id={fieldId("goal-help")}>This supported flow researches original print-on-demand T-shirts and their starting geographic market. Other jobs need their own supported workflow.</small>
          </label>
          <label htmlFor={fieldId("audienceHint")}>Audience constraint <span className="questKickoffOptional">optional</span>
            <input id={fieldId("audienceHint")} name="audienceHint" maxLength={160} value={draft.audienceHint} onChange={event => edit("audienceHint", event.target.value)} placeholder="For example, adult outdoor and nature enthusiasts" aria-describedby={fieldId("audience-help")} aria-invalid={Boolean(errorFor("audienceHint"))}/>
            <small id={fieldId("audience-help")}>Leave blank to explore adult outdoor and nature audiences. The app proposes the concepts and research questions.</small>
          </label>
          <div className="questKickoffScopeNote"><strong>The supported comparison</strong><p>{QUEST_MARKET_SCOPE}</p></div>
        </div> : null}
        {step === 1 ? <div className="questKickoffFields">
          <div className="questKickoffColumns">
            <label htmlFor={fieldId("maximumCollections")}>Fixed research scope
              <select id={fieldId("maximumCollections")} name="maximumCollections" value={draft.maximumCollections} onChange={event => edit("maximumCollections", event.target.value)} aria-invalid={Boolean(errorFor("maximumCollections"))}>
                <option value="1">One source collection · 5 paid calls</option><option value="2">Two source collections · 7 paid calls</option>
              </select>
              <small>A finite process, with no automatic retry.</small>
            </label>
            <label htmlFor={fieldId("maximumUsd")}>Research allowance (USD)
              <input id={fieldId("maximumUsd")} name="maximumUsd" inputMode="decimal" type="number" min="0.000001" max="1" step="0.000001" required value={draft.maximumUsd} onChange={event => edit("maximumUsd", event.target.value)} aria-describedby={fieldId("allowance-help")} aria-invalid={Boolean(errorFor("maximumUsd"))}/>
              <small id={fieldId("allowance-help")}>The full fresh estimate must fit this allowance. Calls stop on uncertain charges; there is no automatic retry.</small>
            </label>
          </div>
          <div className="questKickoffEstimate" aria-live="polite"><div><span>Current complete estimate</span><strong>{estimate === null ? "Unavailable" : questMoney(estimate)}</strong></div><p>{draft.maximumCollections === "1" ? "One collection · 5 paid calls" : "Two collections · 7 paid calls"}. Your allowance: {allowance === null ? "enter a valid amount" : questMoney(allowance)}.</p>{estimate !== null && allowance !== null && !estimateFits ? <p className="questKickoffWarning">This estimate exceeds your allowance. Change the scope or allowance before continuing.</p> : null}</div>
          {validQuestQuote(quote) ? <p className="questKickoffSubtle">Current complete estimates: {questMoney(quote.one)} for one collection; {questMoney(quote.two)} for two. Checked {new Date(quote.verifiedAt).toISOString()}.</p> : null}
          <div className="questKickoffScopeNote"><strong>What this process does</strong><p>Plans the query, collects public sources, selects exact quotations, evaluates nine product dimensions and obtains an independent review. A limited result may honestly need more evidence.</p><p>Seller bank country remains unknown; any fee scenarios are labelled.</p></div>
        </div> : null}
        {step === 2 ? <div className="questKickoffFields">
          <dl className="questKickoffReview">
            <div><dt>Business</dt><dd>{businesses.find(business => business.id === draft.businessId)?.name ?? "Choose a Business"}</dd></div>
            <div><dt>Research goal</dt><dd>{draft.goal}</dd></div>
            <div><dt>Audience</dt><dd>{draft.audienceHint.trim() || "Adult outdoor and nature enthusiasts"}</dd></div>
            <div><dt>Scope</dt><dd>Original POD T-shirts · United States, United Kingdom, Australia and New Zealand<br/>{draft.maximumCollections === "1" ? "One source collection · 5 paid calls" : "Two source collections · 7 paid calls"}</dd></div>
            <div><dt>Current complete estimate</dt><dd>{estimate === null ? "Unavailable" : questMoney(estimate)}{validQuestQuote(quote) ? <small>Checked {new Date(quote.verifiedAt).toISOString()}</small> : null}</dd></div>
            <div><dt>Your research allowance</dt><dd>{allowance === null ? "Invalid allowance" : `${questMoney(allowance)} USD`}</dd></div>
          </dl>
          {estimateChanged ? <p className="questKickoffNotice" role="status">The estimate changed since this review was opened. Check the current amount and approve again.</p> : null}
          {!estimateFits && estimate !== null ? <p className="questKickoffNotice">The complete estimate must fit your allowance. Go back to change the scope or allowance.</p> : null}
          <p className="questKickoffSubtle">The server verifies a fresh complete quote before starting. Prices can change; a new estimate must fit your approved allowance. Calls stop on uncertain charges; there is no automatic retry.</p>
          <ReviewConsent id={fieldId("confirmResearch")} checked={confirmed} disabled={!ready || !estimateFits} invalid={Boolean(errorFor("confirmResearch"))} onChange={checked => dispatch({ type: "consent", key: checked ? reviewKey : null })}/>
        </div> : null}
        <p className="questKickoffNotice">This research workflow has not yet passed live end-to-end qualification. A run may stop without a recommendation; incurred charges and failed-run history remain visible.</p>
        {!available ? <p className="questKickoffNotice" id={fieldId("availability")} tabIndex={-1} role="status">This version is awaiting its registered workflow and safety checks. Saved research remains available below.</p> : !validQuestQuote(quote) ? <p className="questKickoffNotice" id={fieldId("availability")} tabIndex={-1} role="status">Current provider prices are unavailable. Research cannot start until its complete quote is verified.</p> : null}
      </div>
      <footer className="questKickoffFooter">
        {step === 2 ? <><ReviewControls disabled={!state.hydrated || !ready || !estimateFits || !confirmed} onBack={() => goTo(1)} onSettled={settled}/><p>Repeated submissions reuse the saved goal. A later evidence refresh needs a focused reason and the remaining shared allowance.</p></> : <div className="questKickoffActions">{step > 0 ? <button className="questKickoffButton questKickoffButtonSecondary" type="button" onClick={() => goTo(0)}>Back to goal</button> : null}<button className="questKickoffButton" type="submit" disabled={!state.hydrated}>{step === 0 ? "Continue to scope" : "Review research"}<span aria-hidden="true"> →</span></button><span className="questKickoffSubtle">No paid work starts at this step</span></div>}
      </footer>
    </form>
    <noscript><p className="questKickoffNotice">Enable JavaScript to use the guided local draft and review steps.</p></noscript>
  </section>;
}
