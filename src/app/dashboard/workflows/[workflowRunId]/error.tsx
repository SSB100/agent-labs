"use client";

import Link from "next/link";

export default function WorkflowReadError({ reset }: { reset: () => void }) {
  return <main className="coreReadError">
    <p className="coreEyebrow">Work status unavailable</p>
    <h1>This work could not be loaded</h1>
    <p role="alert">Its saved run may still exist. Reloading only checks the page again; it does not restart work or repeat a provider request.</p>
    <div className="corePageActions"><button className="coreButton coreButton-primary" onClick={reset}>Reload saved work</button><Link className="coreButton coreButton-secondary" href="/dashboard/workflows">Back to work</Link></div>
  </main>;
}
