"use client";

import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";

export function BrowserReplay({ browserSessionId }: { browserSessionId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const source = `/api/browser/sessions/${browserSessionId}/replay/manifest`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source;
      return;
    }

    if (!Hls.isSupported()) {
      setError("This browser does not support HLS replay.");
      return;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
    });
    hls.loadSource(source);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setError("The browser replay could not be loaded yet.");
    });

    return () => hls.destroy();
  }, [source]);

  return (
    <div className="browserReplay">
      <video controls playsInline preload="metadata" ref={videoRef} />
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
