import { PageHeader } from "@/components/stage7/app-shell";
import "@/components/console/console-retained-workspace.css";
export default function WorkflowLoading() {
  return <section className="consoleRetained" role="status" aria-live="polite"><div className="consoleRetainedHeader"><PageHeader eyebrow="Exact saved workflow" title="Loading exact saved workflow" description="Checking the requested record and Business. No other workflow is substituted and no action is started." /></div><div className="consoleRetainedBody"><p>Saved content is loading. Actions are unavailable until the exact record has been checked.</p></div></section>;
}
