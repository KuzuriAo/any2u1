// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { defaultSettings } from "../../src/core/settings";
import { fixturePath, launch, SAMPLE, setSettings, type Session } from "./helpers";

let session: Session;
test.beforeEach(async () => {
  session = await launch();
});
test.afterEach(async () => {
  await session.close();
});

const releasesOf = async (session: Session) => {
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await page.locator("#orca-version option").first().waitFor({ state: "attached" });
  const releases = await page.locator("#orca-version option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value).filter((value) => value !== ""));
  await page.close();
  return releases;
};
const setKnown = (session: Session, known: string[]) => session.worker.evaluate((value) => chrome.storage.local.set({ knownReleases: value }), known);
const storedVersion = (session: Session) =>
  session.worker.evaluate(() => chrome.storage.local.get("settings").then(({ settings }) => (settings as { convert: { snapmakerOrcaVersion: string | null } }).convert.snapmakerOrcaVersion));
const choose = (session: Session, version: string | null) => {
  const settings = defaultSettings();
  return setSettings(session, { ...settings, convert: { ...settings.convert, snapmakerOrcaVersion: version } });
};

test("a first run announces nothing, and pins the newest by number", async () => {
  const page = await session.open("convert.html");
  await expect(page.locator("#options-version")).toContainText(/for Snapmaker Orca \d/);
  await expect(page.locator("#release-notice")).toBeHidden();
  await page.locator("summary").click();
  const newest = await page.locator("#orca-version option").nth(1).getAttribute("value");
  await expect(page.locator("#orca-version")).toHaveValue(newest!);
  await expect(page.locator("#orca-version option").first()).toHaveText(`Newest (currently ${newest})`);
  expect(await storedVersion(session)).toBe(newest);
});

test("the picker saves Newest as following the catalog, and the newest by number as exact", async () => {
  const releases = await releasesOf(session);
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await page.selectOption("#orca-version", "");
  await expect.poll(() => storedVersion(session)).toBeNull();
  await expect(page.locator("#options-version")).toContainText(`Snapmaker Orca ${releases[0]}`);
  await page.selectOption("#orca-version", releases[0]!);
  await expect.poll(() => storedVersion(session)).toBe(releases[0]);
  await page.reload();
  await page.locator("summary").click();
  await expect(page.locator("#orca-version")).toHaveValue(releases[0]!);
});

test("the newest chosen by number stays put when an update adds a release", async () => {
  const releases = await releasesOf(session);
  const chosen = releases[1]!;
  // As the extension was before the update: the chosen release was the newest it held, and was picked by number.
  await setKnown(session, releases.slice(1));
  await choose(session, chosen);

  const page = await session.open("convert.html");
  const notice = page.locator("#release-notice");
  await expect(notice).toContainText(`Snapmaker Orca ${releases[0]} is now available`);
  await expect(notice).toContainText(`You're still converting for ${chosen}.`);
  await expect(notice).toContainText(`If you've updated Snapmaker Orca, choose ${releases[0]} in the options.`);
  await expect(notice).not.toContainText("Conversions now use");
  await expect(page.locator("#options-version")).toContainText(`Snapmaker Orca ${chosen}`);
  await page.locator("summary").click();
  await expect(page.locator("#orca-version")).toHaveValue(chosen);
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".saved")).toContainText(`for Snapmaker Orca ${chosen}`);
  expect(await storedVersion(session)).toBe(chosen);

  // Dismissed, it stays away; the next new release brings it back.
  await notice.locator("button.dismiss-notice").click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.locator("#options-version")).toContainText(`Snapmaker Orca ${chosen}`);
  await expect(notice).toBeHidden();
  await setKnown(session, releases.slice(1));
  await page.reload();
  await expect(notice).toContainText(`You're still converting for ${chosen}.`);
});

test("after an update adds a release, Newest moves up: says so once, until dismissed", async () => {
  const releases = await releasesOf(session);
  await choose(session, null);
  await setKnown(session, releases.slice(1));
  const page = await session.open("convert.html");
  const notice = page.locator("#release-notice");
  await expect(notice).toContainText(`Snapmaker Orca ${releases[0]} is now available`);
  await expect(notice).toContainText("older version");

  await page.reload();
  await expect(notice).toBeVisible();
  await notice.locator("button.dismiss-notice").click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.locator("#options-version")).toContainText("Snapmaker Orca");
  await expect(notice).toBeHidden();
});

test("a chosen release the catalog dropped: says so, and the picker and the result agree on the newest", async () => {
  const releases = await releasesOf(session);
  await setKnown(session, [...releases, "2.3.9"]);
  const settings = defaultSettings();
  await setSettings(session, { ...settings, convert: { ...settings.convert, snapmakerOrcaVersion: "2.3.9" } });

  const page = await session.open("convert.html");
  await expect(page.locator("#release-notice")).toContainText("2.3.9 is no longer available");
  await expect(page.locator("#options-version")).toContainText(`Snapmaker Orca ${releases[0]}`);
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".saved")).toContainText(`for Snapmaker Orca ${releases[0]}`);
  // Moved to the newest pinned, like a first run, so the next update doesn't move it again.
  expect(await storedVersion(session)).toBe(releases[0]);
});

test("each result and the options name the version chosen", async () => {
  const releases = await releasesOf(session);
  const older = releases[1]!;
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await page.selectOption("#orca-version", older);
  await expect(page.locator("#options-version")).toContainText(`Snapmaker Orca ${older}`);
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".saved")).toContainText(`for Snapmaker Orca ${older}`);
});

test("the settings page shows the notice too", async () => {
  const releases = await releasesOf(session);
  await setKnown(session, releases.slice(1));
  const page = await session.open("settings.html");
  await expect(page.locator("#release-notice")).toContainText(`${releases[0]} is now available`);
});
