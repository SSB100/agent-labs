import { createHash } from "node:crypto";
import { HOST_PROBE_CASES } from "./host-probe";

// Static script only. No request values, interpolation of input, accounts, images,
// credential prompts, external assets, browser providers or environment values.
const SCRIPT = `"use strict";
const buttons = Array.from(document.querySelectorAll("button"));
const output = document.getElementById("output");
let busy = false;
for (const button of buttons) button.addEventListener("click", async () => {
  if (busy) return;
  busy = true; buttons.forEach(item => { item.disabled = true; });
  const mode = button.dataset.case;
  const control = new AbortController();
  const started = performance.now();
  const timer = setTimeout(() => control.abort(), 5500);
  let frames = 0;
  output.textContent = "Provider-free case: " + mode + "\\n";
  try {
    const response = await fetch("/api/health/r10-host-probe", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: control.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ case: mode }) });
    output.textContent += "HTTP " + response.status + "\\n";
    if (!response.ok) throw new Error("unavailable");
    if (mode === "normal-response") {
      const value = await response.json();
      output.textContent += value.diagnostic === "provider-free" && value.qualification === false ? "Plain JSON returned; inspect host logs for deferred control completion.\\n" : "Unexpected control response.\\n";
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) { output.textContent += "Transport EOF.\\n"; break; }
        pending += decoder.decode(chunk.value, { stream: true });
        if (pending.length > 2048) throw new Error("invalid");
        let newline;
        while ((newline = pending.indexOf("\\n")) >= 0) {
          const packet = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
          if (packet.type !== "frame" || packet.data !== "/9j/2Q==") throw new Error("invalid");
          frames += 1; output.textContent += "Inert frame " + frames + ".\\n";
        }
        if (mode === "client-cancel" && frames > 0) { control.abort(); output.textContent += "Client fetch aborted after its first inert frame.\\n"; break; }
      }
    }
  } catch { output.textContent += "Transport ended or failed; host logs decide cleanup retention.\\n"; }
  finally {
    clearTimeout(timer);
    output.textContent += "No provider was used. No viewer qualification is established.\\n";
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 6000 - (performance.now() - started))));
    output.textContent += "Ready for the next case.\\n";
    busy = false; buttons.forEach(item => { item.disabled = false; });
  }
});`;
const STYLE = "body{max-width:760px;margin:40px auto;padding:0 24px;font:18px system-ui;line-height:1.5;color:#18323b;background:#f4f8fa}button{font:inherit;display:block;padding:10px 16px;margin:10px 0}pre{white-space:pre-wrap;padding:20px;background:white;border:1px solid #bdcfd4}h1{font-size:30px}";
const digest = (value: string) => createHash("sha256").update(value).digest("base64");
export function hostProbePage(): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Provider-free hosting diagnostic</title><style>${STYLE}</style></head><body><main><h1>Provider-free hosting diagnostic</h1><p>Temporary protected Preview only. Fixed inert bytes and short local timers exercise hosting lifetime. No browser provider, account lookup, database, or live images. This is never viewer qualification.</p><p>Run one case at a time. Each button is enabled again after six seconds. Compare the transport result here with the allowlisted host logs. A successful run must include cleanup and hosting completion; the plain JSON control must include control completion.</p>${HOST_PROBE_CASES.map(mode => `<button type="button" data-case="${mode}">${mode}</button>`).join("")}<pre id="output" role="status" aria-live="polite">Choose a fixed diagnostic case.</pre></main><script>${SCRIPT}</script></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${digest(SCRIPT)}'; style-src 'sha256-${digest(STYLE)}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` },
  });
}
