"use client";

import { useEffect, useRef } from "react";
import { consoleCollectionScrollKey, mountConsoleCollectionScroll } from "./console-collection-scroll";

/** An inert marker adds scroll continuity without hydrating or fetching the collection rows. */
export function ConsoleCollectionViewport({ ownerId, scopeHref }: { ownerId: string; scopeHref: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = marker.current?.closest<HTMLElement>(".consoleCollectionPane");
    if (root) return mountConsoleCollectionScroll(root, ownerId, scopeHref);
  }); // Rebind after every server commit: retained rows/scrollers may be replaced at the same URL.
  return <span hidden ref={marker} data-console-collection-viewport="true" data-console-collection-scope={consoleCollectionScrollKey(ownerId, scopeHref)}/>;
}
