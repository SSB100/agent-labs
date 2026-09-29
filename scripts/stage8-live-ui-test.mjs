import { chromium } from "playwright";

const baseUrl = process.env.STAGE8_BASE_URL;
const email = process.env.STAGE8_TEST_EMAIL;
const password = process.env.STAGE8_TEST_PASSWORD;

if (!baseUrl || !email || !password) {
  throw new Error("Stage 8 browser test configuration is incomplete.");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForButton(page, name, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const button = page.getByRole("button", { name, exact: true }).first();
    if (await button.isVisible().catch(() => false)) return button;
    await page.waitForTimeout(3_000);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  }
  throw new Error(`${name} did not become available within the qualification window.`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const consoleErrors = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

let workflowRunId = null;
let browserSessionId = null;

try {
  await page.goto(baseUrl, {
    timeout: 120_000,
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard(?:\?.*)?$/, { timeout: 60_000 }),
    page.getByRole("button", { name: "Open control centre" }).click(),
  ]);

  const accountsUrl = new URL("/dashboard/accounts", page.url()).toString();
  await page.goto(accountsUrl, {
    timeout: 60_000,
    waitUntil: "networkidle",
  });

  const bodyBefore = await page.locator("body").innerText();
  assert(bodyBefore.includes("Steel Browser"), "Steel Browser was missing from Accounts.");
  assert(bodyBefore.includes("4/4"), "The Accounts page did not report four connected services.");

  const launchButton = page
    .getByRole("button", { name: "Run for Stage 8 Live Qualification", exact: true })
    .first();
  assert(await launchButton.isEnabled(), "The live browser qualification button was disabled.");

  await launchButton.click();
  await page.waitForURL(/\/dashboard\/workflows\/[0-9a-f-]{36}/i, {
    timeout: 90_000,
  });

  workflowRunId = page.url().match(/\/dashboard\/workflows\/([0-9a-f-]{36})/i)?.[1] ?? null;
  assert(workflowRunId, "The browser qualification workflow ID was not available.");

  const takeControlButton = await waitForButton(page, "Take Control");

  const liveFrame = page.locator('iframe[title="Agent Labs live remote browser"]').first();
  await liveFrame.waitFor({ state: "visible", timeout: 120_000 });
  const liveSource = await liveFrame.getAttribute("src");
  browserSessionId = liveSource?.match(/\/sessions\/([0-9a-f-]{36})\/live/i)?.[1] ?? null;
  assert(browserSessionId, "The live browser session ID was not exposed through the owner route.");

  await takeControlButton.click();
  const returnControlButton = await waitForButton(page, "Return Control");

  const remoteFrame = page.frameLocator('iframe[title="Agent Labs live remote browser"]').first();
  const humanButton = remoteFrame.locator("#agent-labs-stage8-human-proof");
  await humanButton.waitFor({ state: "visible", timeout: 120_000 });
  await humanButton.click();
  await remoteFrame
    .locator("#agent-labs-stage8-output")
    .filter({ hasText: "Human interactions: 1" })
    .waitFor({ state: "visible", timeout: 30_000 });

  await returnControlButton.click();

  let released = false;
  for (let attempt = 1; attempt <= 36; attempt += 1) {
    await page.waitForTimeout(5_000);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    const text = await page.locator("body").innerText().catch(() => "");
    if (
      text.includes("Recorded session") ||
      text.includes("Session replay") ||
      /\bReleased\b/.test(text)
    ) {
      released = true;
      break;
    }
  }
  assert(released, "The Steel session did not reach its released state.");

  const origin = new URL(page.url()).origin;
  let replayReady = false;
  let replayLength = 0;
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    const response = await context.request.get(
      `${origin}/api/browser/sessions/${browserSessionId}/replay/manifest`,
      { timeout: 30_000 },
    );
    if (response.ok()) {
      const playlist = await response.text();
      replayLength = playlist.length;
      if (playlist.includes("#EXTM3U")) {
        replayReady = true;
        break;
      }
    }
    await page.waitForTimeout(5_000);
  }
  assert(replayReady, "The authenticated Steel replay manifest did not become available.");

  assert(
    !consoleErrors.some((entry) => /uncaught|internal server error|hydration failed/i.test(entry)),
    `The browser reported blocking console errors: ${consoleErrors.join(" | ")}`,
  );

  console.log(
    JSON.stringify(
      {
        browserSessionId,
        consoleErrorCount: consoleErrors.length,
        replayLength,
        status: "passed",
        workflowRunId,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({
    fullPage: true,
    path: "stage8-live-qualification-failure.png",
  }).catch(() => undefined);
  console.error(
    JSON.stringify(
      {
        browserSessionId,
        consoleErrors,
        message: error instanceof Error ? error.message : String(error),
        status: "failed",
        url: page.url(),
        workflowRunId,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
