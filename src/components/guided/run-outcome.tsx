import Link from "next/link";

import { summarizeRunOutcome, type RunOutcomeInput } from "@/lib/core-ui/run-outcome";

import "./run-outcome.css";

/** Read-only server component. Existing domain pages keep the recovery and approval actions. */
export function RunOutcome(props: RunOutcomeInput) {
  const result = summarizeRunOutcome(props);
  const headingId = `run-outcome-${props.run.id}`;
  return <section className="guidedRunOutcome" data-tone={result.tone} aria-labelledby={headingId}>
    <header className="guidedOutcomeHeader">
      <span className="guidedOutcomeMarker" aria-hidden="true">{result.tone === "success" ? "✓" : result.tone === "attention" ? "!" : "·"}</span>
      <div><p className="guidedOutcomeEyebrow">Saved outcome</p><h2 id={headingId}>{result.title}</h2><p className="guidedOutcomeSummary">{result.summary}</p></div>
    </header>
    {result.goal ? <p className="guidedOutcomeGoal"><span>Research goal</span>{result.goal}</p> : null}
    {result.readWarning ? <p className="guidedOutcomeReadWarning" role="status">{result.readWarning}</p> : null}
    <div className="guidedOutcomeGrid">
      <section className="guidedOutcomeSection" aria-label="What is retained"><h3>What is retained</h3><ul>{result.retained.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></section>
      <section className="guidedOutcomeSection" aria-label="What still needs attention"><h3>What still needs attention</h3><ul>{result.blocked.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></section>
      <section className="guidedOutcomeSection guidedOutcomeSpending" aria-label="Spending for this run"><h3>Spending for this run</h3>
        <dl><div><dt>{result.spending.label}</dt><dd>{result.spending.value}</dd></div></dl>
        <p>{result.spending.detail}</p>
        {result.spending.reservation ? <p className="guidedOutcomeUtility">{result.spending.reservation}</p> : null}
        {result.spending.allowance ? <p className="guidedOutcomeUtility">{result.spending.allowance}</p> : null}
        {result.spending.exactAmounts.length ? <details className="guidedOutcomeReceipts"><summary>Exact recorded charges and estimates</summary><dl>{result.spending.exactAmounts.map((amount, index) => <div key={`${index}:${amount.label}`}><dt>{amount.label}</dt><dd>{amount.value}</dd></div>)}</dl></details> : null}
      </section>
    </div>
    <footer className="guidedOutcomeNext"><div><h3>Next step</h3><p>{result.next.detail}</p></div><Link className="guidedOutcomeButton" href={result.next.href}>{result.next.label}<span aria-hidden="true">→</span></Link></footer>
  </section>;
}
