import { chromium, type Browser } from "playwright-core";

import type { BrowserVerificationResult } from "./types";
import { BrowserProviderError } from "./types";

const QUALIFICATION_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Agent Labs Browser Qualification</title>
<style>
body{font-family:system-ui,sans-serif;background:#07100d;color:#f3f8f5;margin:0;padding:40px}
main{max-width:760px;margin:auto;border:1px solid #345746;border-radius:18px;padding:28px;background:#0d1c16}
button,input{font:inherit}button{padding:12px 16px;border:0;border-radius:10px;background:#79e2a7;color:#07100d;font-weight:800}
code{color:#baf7d2}.panel{margin-top:22px;padding:18px;border-radius:12px;background:#07100d}
</style>
</head>
<body>
<main>
<p>Agent Labs Stage 8</p>
<h1>Remote browser qualification</h1>
<p>This isolated page proves Playwright control, upload handling, live viewing, human takeover, return control, and session persistence.</p>
<div class="panel">
<label for="qualification-upload">Qualification upload</label>
<input id="qualification-upload" type="file" />
<p>Upload: <code id="upload-name">none</code></p>
</div>
<div class="panel">
<p>Control marker: <code id="control-marker">agent-prepared</code></p>
<button id="takeover-marker" type="button">Confirm human takeover</button>
</div>
</main>
<script>
const marker = localStorage.getItem('agent-labs-stage8-marker') || 'agent-prepared';
document.querySelector('#control-marker').textContent = marker;
document.querySelector('#takeover-marker').addEventListener('click', () => {
  localStorage.setItem('agent-labs-stage8-marker', 'owner-control-confirmed');
  document.querySelector('#control-marker').textContent = 'owner-control-confirmed';
});
document.querySelector('#qualification-upload').addEventListener('change', (event) => {
  document.querySelector('#upload-name').textContent = event.target.files?.[0]?.name || 'none';
});
</script>
</body>
</html>`;

type DisconnectableBrowser = Browser & {
  _connection?: {
    close(): Promise<void> | void;
  };
};

async function disconnect(browser: Browser) {
  const connection = (browser as DisconnectableBrowser)._connection;
  if (connection) {
    await connection.close();
  }
}

async function connect(connectUrl: string) {
  try {
    return await chromium.connectOverCDP(connectUrl, { timeout: 20_000 });
  } catch (error) {
    throw new BrowserProviderError(
      "playwright_connection_failed",
      error instanceof Error
        ? error.message
        : "Playwright could not connect to the remote browser.",
      true,
    );
  }
}

export async function prepareBrowserQualification(
  connectUrl: string,
): Promise<BrowserVerificationResult> {
  const browser = await connect(connectUrl);
  try {
    const context = browser.contexts()[0];
    const page = context?.pages()[0];
    if (!page) {
      throw new BrowserProviderError(
        "playwright_verification_failed",
        "The provider did not create the expected initial browser context and page.",
        false,
      );
    }

    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    await page.setContent(QUALIFICATION_HTML, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("agent-labs-stage8-marker", "agent-prepared");
      const marker = document.querySelector("#control-marker");
      if (marker) marker.textContent = "agent-prepared";
    });
    await page.locator("#qualification-upload").setInputFiles({
      name: "stage8-browser-upload.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("agent-labs-stage8-upload-proof", "utf8"),
    });

    const uploadName = await page.locator("#upload-name").textContent();
    const title = await page.title();
    const marker = (await page.locator("#control-marker").textContent()) ?? "";

    if (
      title !== "Agent Labs Browser Qualification" ||
      uploadName !== "stage8-browser-upload.txt" ||
      marker !== "agent-prepared"
    ) {
      throw new BrowserProviderError(
        "playwright_verification_failed",
        "The remote browser did not preserve the qualification page, upload, and marker.",
        false,
        { title, uploadName, marker },
      );
    }

    return {
      title,
      currentUrl: page.url(),
      uploadVerified: true,
      marker,
    };
  } finally {
    await disconnect(browser);
  }
}

export async function verifyReturnedBrowserControl(
  connectUrl: string,
): Promise<BrowserVerificationResult> {
  const browser = await connect(connectUrl);
  try {
    const context = browser.contexts()[0];
    const page = context?.pages()[0];
    if (!page) {
      throw new BrowserProviderError(
        "playwright_verification_failed",
        "The remote browser no longer had its original page after takeover.",
        false,
      );
    }

    const title = await page.title();
    const marker = await page.evaluate(
      () => localStorage.getItem("agent-labs-stage8-marker") ?? "missing",
    );
    const uploadName = await page.locator("#upload-name").textContent();

    if (
      title !== "Agent Labs Browser Qualification" ||
      marker !== "owner-control-confirmed" ||
      uploadName !== "stage8-browser-upload.txt"
    ) {
      throw new BrowserProviderError(
        "playwright_verification_failed",
        "Return control verification did not find the expected human marker and persistent upload state.",
        false,
        { title, marker, uploadName },
      );
    }

    await page.evaluate(() => {
      localStorage.setItem("agent-labs-stage8-marker", "agent-control-resumed");
      const element = document.querySelector("#control-marker");
      if (element) element.textContent = "agent-control-resumed";
    });

    return {
      title,
      currentUrl: page.url(),
      uploadVerified: true,
      marker: "agent-control-resumed",
    };
  } finally {
    await disconnect(browser);
  }
}
