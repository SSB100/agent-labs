import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { sheetLifecycleDocument, sheetOrigin, sheetReturn } from "./helpers/console-sheet-lifecycle.mjs";

test("research dismissal retains its modal barrier until the route removes it", async () => {
  const source = readFileSync("src/components/console/console-command.tsx", "utf8");
  const close = source.match(/function close\(\) \{([^\n]+)\}/)?.[1];
  assert.ok(close?.includes("startDismissal"));
  assert.ok(close.includes("router.push(returnTo"));
  assert.ok(!close.includes(".close("), "Do not expose underlying launch controls during route transition");
  assert.match(source, /onCancel=\{event => \{ event.preventDefault\(\); close\(\); \}\}/);
  assert.match(source, /return \(\) => \{ if \(element\?\.open\) element.close\(\); \}/);
  const html = await sheetLifecycleDocument();
  assert.ok(html.includes("sheet-lifecycle-root"));
  assert.ok(html.includes("interruptWithReopen"));
});

const enabled = process.env.GUIDED_UI_BROWSER === "1" || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
test("retained research sheet survives delayed and interrupted client Close/Escape navigation", {skip:!enabled,timeout:120000}, async t => {
  const html = await sheetLifecycleDocument();
  const directory = path.resolve("test-results/guided-ui"); mkdirSync(directory,{recursive:true});
  const browser = await chromium.launch({headless:true,...(process.env.GUIDED_UI_CHROMIUM_PATH?{executablePath:process.env.GUIDED_UI_CHROMIUM_PATH}:{})});
  try {
    for (const width of [1440,390,320]) await t.test(`${width}px modal transition lifecycle`, async () => {
      const context = await browser.newContext({viewport:{width,height:900},reducedMotion:"reduce",serviceWorkers:"block"});
      const unexpected=[];
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin===sheetOrigin && route.request().resourceType()==="document") return route.fulfill({status:200,contentType:"text/html",body:html});
        unexpected.push(url.toString()); return route.abort();
      });
      const page=await context.newPage();
      try {
        await page.goto(sheetOrigin+sheetReturn);
        await page.waitForFunction(()=>Boolean(window.__sheetFixture));
        const launch=page.getByRole("button",{name:"Plan research",exact:true});
        await launch.click();
        const dialog=page.getByRole("dialog",{name:"Research setup",exact:true});
        await page.waitForFunction(()=>document.querySelector("dialog")?.matches(":modal"));
        await dialog.getByRole("textbox",{name:"Draft goal"}).fill("Unsaved draft remains visible");
        for (const cancel of ["close","escape"]) {
          if(cancel==="close") await dialog.getByRole("button",{name:"Close research setup"}).click(); else await page.keyboard.press("Escape");
          await page.waitForFunction(()=>window.__sheetRequests.length>0);
          assert.equal(await page.evaluate(()=>document.querySelector("dialog")?.matches(":modal")),true);
          assert.equal(await dialog.getByRole("button",{name:"Close research setup"}).isDisabled(),true);
          assert.equal(await page.evaluate(()=>document.activeElement?.closest("dialog")!==null),true);
          // A real pointer cannot hit the exposed opener while the close route is pending.
          const box=await launch.boundingBox(); assert.ok(box);
          await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
          assert.equal(await page.evaluate(()=>window.__sheetRequests.length),cancel==="close"?1:2);
          assert.equal(await page.evaluate(()=>document.querySelector("dialog")?.matches(":modal")),true);
          // A newer client navigation back to this same sheet retains the instance.
          await page.evaluate(()=>window.__sheetFixture.interruptWithReopen());
          await page.waitForFunction(()=>!document.querySelector('[aria-label="Close research setup"]')?.disabled);
          assert.ok(page.url().includes("sheet=research"));
          assert.equal(await page.evaluate(()=>document.querySelector("dialog")?.matches(":modal")),true);
          assert.equal(await dialog.getByRole("textbox",{name:"Draft goal"}).inputValue(),"Unsaved draft remains visible");
        }
        await page.screenshot({path:path.join(directory,`console-sheet-interrupted-${width}.png`),animations:"disabled"});
        await dialog.getByRole("button",{name:"Close research setup"}).click();
        await page.evaluate(()=>window.__sheetFixture.commit());
        await page.waitForURL(sheetOrigin+sheetReturn);
        assert.equal(await page.locator("dialog").count(),0);
        assert.equal(await launch.evaluate(node=>node===document.activeElement),true);
        await launch.click();
        await page.waitForFunction(()=>document.querySelector("dialog")?.matches(":modal"));
        await page.keyboard.press("Escape");
        await page.evaluate(()=>window.__sheetFixture.commit());
        await page.waitForURL(sheetOrigin+sheetReturn);
        assert.equal(await page.locator("dialog").count(),0);
        assert.equal(await launch.evaluate(node=>node===document.activeElement),true);
        assert.deepEqual(await page.evaluate(()=>window.__sheetErrors),[]);
        assert.deepEqual(unexpected,[]);
      } finally {await context.close();}
    });
  } finally {await browser.close();}
});
