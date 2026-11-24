// SPDX-License-Identifier: AGPL-3.0-or-later
// The tab an install opens: what happens on the next 3MF download, and how to pin the button.
import { expect, test, type Page } from "@playwright/test";
import { textContrast, type TextContrast } from "../shared/layout";
import { launch, type Session } from "./helpers";

let session: Session;
test.afterEach(async () => {
  await session.close();
});

const welcomeTabs = (session: Session) => session.context.pages().filter((page) => page.url().includes("view=welcome"));
const CHROMIUM_STEPS = "Click the Extensions button (the puzzle piece) in the toolbar, then the pin beside any2u1.";

/** Opens the first-run view in a new tab whose action.getUserSettings answers `pinned` (or is missing, for `"missing"`). */
async function welcomeWith(pinned: boolean | "missing"): Promise<Page> {
  const page = await session.context.newPage();
  await page.addInitScript((value) => {
    const action = chrome.action as unknown as { getUserSettings?: unknown };
    if (value === "missing") delete action.getUserSettings;
    else action.getUserSettings = () => Promise.resolve({ isOnToolbar: value });
  }, pinned);
  await page.goto(`${session.origin}/convert.html?view=welcome`);
  await expect(page.locator("#welcome")).toBeVisible();
  return page;
}

test("installing opens one tab that says what happens on the next 3MF download, and whether the button is pinned, as the browser says", async () => {
  session = await launch(undefined, { keepWelcome: true });
  const page = session.welcome!;
  expect(welcomeTabs(session)).toHaveLength(1);
  await expect(page.locator("#welcome h2")).toHaveText("Ready to convert");
  await expect(page.locator("#welcome > p")).toHaveText([
    "When a 3MF finishes downloading, a small window offers to convert it for your Snapmaker U1. You can also drop a file below at any time, or open this page with the any2u1 button.",
    "Each file is made for the Snapmaker Orca version and nozzle size set in Options, below. Check them before your first file, and set a layer height there if you want one.",
  ]);
  // Options is below, as the line says, and is where those three are.
  const options = page.locator("details", { has: page.locator("summary", { hasText: "Options" }) });
  expect((await options.boundingBox())!.y).toBeGreaterThan((await page.locator("#welcome-options").boundingBox())!.y);
  await options.locator("summary").click();
  for (const field of ["#orca-version", "#nozzle-size", "#layer-height"]) await expect(options.locator(field)).toBeVisible();
  // The page converts as it always does: the drop zone is right below.
  await expect(page.locator("#drop")).toBeVisible();
  const { isOnToolbar } = await session.worker.evaluate(() => chrome.action.getUserSettings());
  await expect(page.locator("#pin-state")).toHaveText(isOnToolbar ? "The any2u1 button is pinned to your toolbar." : "The any2u1 button isn't pinned to your toolbar yet. To pin it:");
  if (isOnToolbar) await expect(page.locator("#pin-steps")).toBeHidden();
  else await expect(page.locator("#pin-steps")).toHaveText(CHROMIUM_STEPS);
  // Nothing but the extension's own files.
  expect(session.requests.filter((url) => !url.startsWith(session.origin) && !url.startsWith("about:"))).toEqual([]);
});

test("an update, or the browser's own update, opens no tab", async () => {
  session = await launch();
  expect(welcomeTabs(session)).toHaveLength(0);
  await session.worker.evaluate(() => {
    const event = chrome.runtime.onInstalled as unknown as { dispatch(details: object): void };
    event.dispatch({ reason: "update", previousVersion: "0.0.9" });
    event.dispatch({ reason: "chrome_update" });
  });
  // An install would have opened it by now; check for a while longer than that takes.
  await new Promise((done) => setTimeout(done, 1_500));
  expect(welcomeTabs(session)).toHaveLength(0);
});

test("the pin line follows what the browser says: pinned hides the steps, not pinned shows them, and a browser that can't say gets the steps alone", async () => {
  session = await launch();
  const pinned = await welcomeWith(true);
  await expect(pinned.locator("#pin-state")).toHaveText("The any2u1 button is pinned to your toolbar.");
  await expect(pinned.locator("#pin-steps")).toBeHidden();
  const unpinned = await welcomeWith(false);
  await expect(unpinned.locator("#pin-state")).toHaveText("The any2u1 button isn't pinned to your toolbar yet. To pin it:");
  await expect(unpinned.locator("#pin-steps")).toHaveText(CHROMIUM_STEPS);
  const unknown = await welcomeWith("missing");
  await expect(unknown.locator("#pin-state")).toHaveText("To pin the any2u1 button to your toolbar:");
  await expect(unknown.locator("#pin-steps")).toHaveText(CHROMIUM_STEPS);
});

test("the convert page without the first-run view shows none of it", async () => {
  session = await launch();
  for (const path of ["convert.html", "convert.html?view=window"]) {
    const page = await session.open(path);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("#welcome")).toBeHidden();
  }
});

test("the first-run tab reads at every width down to the small window at 200% zoom, in light and dark", async () => {
  session = await launch();
  const page = await welcomeWith(false);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1280, 480, 240]) {
      await page.setViewportSize({ width, height: 700 });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(wide, `${width} px, ${colorScheme}: the page scrolls sideways`).toBeLessThanOrEqual(0);
    }
    for (const selector of ["#welcome > p", "#pin-state", "#pin-steps"]) {
      const contrast = await page.evaluate<TextContrast>(textContrast(selector));
      expect(contrast.ratio, `${selector} in ${colorScheme}: ${contrast.text} on ${contrast.behind}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
