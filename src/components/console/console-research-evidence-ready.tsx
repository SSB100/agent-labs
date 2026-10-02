"use client";

import { useEffect, useRef } from "react";
import { consoleCollectionScrollKey } from "./console-collection-scroll";

/** A resolved leaf signals only its own rendered exact scope; no fetch or filter state. */
export function ConsoleResearchEvidenceReady({ ownerId, scopeHref, recordId, businessId }: { ownerId: string; scopeHref: string; recordId: string; businessId: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => { marker.current?.dispatchEvent(new Event("console-research-evidence-ready", { bubbles: true })); }, [ownerId, scopeHref, recordId, businessId]);
  return <span hidden ref={marker} data-console-research-evidence-ready="true" data-console-research-ready-scope={consoleCollectionScrollKey(ownerId, scopeHref)} data-console-research-record={recordId} data-console-research-business={businessId}/>;
}
