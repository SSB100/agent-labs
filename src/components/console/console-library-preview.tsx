"use client";

import { useState } from "react";

/** Only the private image URL enters this leaf; it never signs, fetches JSON, or uses a shared optimizer. */
export function ConsoleLibraryPreview({ signedUrl, reason, version, large = false }: { signedUrl: string | null; reason: string | null; version: number; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const ready = signedUrl !== null && !failed;
  return <figure className={large ? "consoleLibraryPreview consoleLibraryPreviewLarge" : "consoleLibraryPreview"}>
    {ready ? <>
      {/* Private signed URLs must not enter a shared image-optimization cache. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={signedUrl} alt={`Original artwork, version ${version}`} width={large ? 320 : 84} height={large ? 240 : 84} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
    </> : <div className="consoleLibraryPreviewMissing" role="status"><span aria-hidden="true">◇</span><span>Private preview unavailable</span></div>}
    {large ? <figcaption>Original artwork · not a product mockup{ready ? <a href={signedUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open full image ↗</a> : <span>{failed ? "Private image access may have expired. Reload to refresh access." : reason ?? "Private image access is unavailable. Reload to refresh access."}</span>}</figcaption> : null}
  </figure>;
}
