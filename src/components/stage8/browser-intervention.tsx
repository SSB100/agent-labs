import { resumeBrowserControl } from "@/app/dashboard/browser-actions";
import type { OwnerInterventionRecord } from "@/lib/core-ui/workflows";

import { CoreIcon } from "../stage7/icons";

export function BrowserInterventionCard({
  businessName,
  intervention,
  returnTo,
  workflowName,
}: {
  businessName?: string;
  intervention: OwnerInterventionRecord;
  returnTo: string;
  workflowName?: string;
}) {
  const takeControl = intervention.intervention_type === "browser_takeover";

  return (
    <article className="needsYouCard browserInterventionCard">
      <span className="needsYouIcon"><CoreIcon name="browser" /></span>
      <div className="needsYouCopy">
        <p className="coreEyebrow">Browser control</p>
        <h3>{intervention.title}</h3>
        <p>{intervention.description}</p>
        <small>{[businessName, workflowName].filter(Boolean).join(" · ")}</small>
      </div>
      <form action={resumeBrowserControl} className="needsYouActions">
        <input name="interventionId" type="hidden" value={intervention.id} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <button
          className="coreButton coreButton-primary"
          name="decision"
          type="submit"
          value={takeControl ? "take_control" : "return_control"}
        >
          {takeControl ? "Take Control" : "Return Control"}
        </button>
      </form>
    </article>
  );
}
