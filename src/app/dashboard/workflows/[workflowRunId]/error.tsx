"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import "@/components/console/console-retained-workspace.css";

export default function WorkflowReadError() {
  const query = useSearchParams(), business = query.get("business");
  return <section className="consoleRetained consoleRetainedError"><div className="consoleRetainedBody">
    <p className="coreEyebrow">Work status unavailable</p>
    <h1>This work could not be loaded</h1>
    <p role="alert">Its saved run may still exist. Reloading only checks the page again; it does not restart work or repeat a provider request.</p>
    <div className="corePageActions"><button className="coreButton coreButton-primary" onClick={() => window.location.reload()}>Reload saved work</button><Link className="coreButton coreButton-secondary" href={`/dashboard?view=work${business ? `&business=${encodeURIComponent(business)}` : ""}`}>Back to work</Link></div>
  </div></section>;
}
