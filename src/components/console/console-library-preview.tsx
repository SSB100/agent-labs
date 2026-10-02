"use client";

import { useCallback, useState } from "react";

type CommittedPreview = Pick<HTMLImageElement, "complete" | "currentSrc" | "naturalWidth" | "src" | "getAttribute">;
/** A completed failed request is distinct from a lazy image that has not requested bytes yet. */
export function consoleLibraryPreviewFailed(image: CommittedPreview, signedUrl: string | null): boolean {
  return signedUrl !== null && image.getAttribute("src") === signedUrl && image.complete && image.currentSrc !== "" && image.currentSrc === image.src && image.naturalWidth === 0;
}

/** Only the private image URL enters this leaf; it never signs, fetches JSON, or uses a shared optimizer. */
export function ConsoleLibraryPreview({ signedUrl, reason, version, large = false, compact = false }: { signedUrl: string | null; reason: string | null; version: number; large?: boolean; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  // A cached/fast error may have completed before hydration registered onError.
  // The commit callback observes that finished request without triggering a fetch,
  // decoding an unrequested lazy image, or retrying a private URL.
  const inspectCommittedImage = useCallback((image: HTMLImageElement | null) => {
    if (image && consoleLibraryPreviewFailed(image, signedUrl)) setFailed(true);
  }, [signedUrl]);
  const ready = signedUrl !== null && !failed;
  const unavailable = failed ? "Private image access may have expired. Reload to refresh access." : reason ?? "Private image access is unavailable. Reload to refresh access.";
  return <figure className={large ? "consoleLibraryPreview consoleLibraryPreviewLarge" : "consoleLibraryPreview"} data-compact={compact}>
    {ready ? <>
      {/* Private signed URLs must not enter a shared image-optimization cache. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={inspectCommittedImage} src={signedUrl} alt={`Original artwork, version ${version}`} width={large ? 320 : 84} height={large ? 240 : 84} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
    </> : <div className="consoleLibraryPreviewMissing" role="status" aria-label={unavailable}><span aria-hidden="true">◇</span><span>Private preview unavailable</span></div>}
    {large ? <figcaption>Original artwork · not a product mockup{ready ? <a href={signedUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open full image ↗</a> : <span>{compact ? "Reload to refresh private access" : unavailable}</span>}</figcaption> : null}
  </figure>;
}
