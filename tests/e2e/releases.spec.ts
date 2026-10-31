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
  const releases = await page.locator("#orca-version option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  await page.close();
  return releases;
};
const setKnown = (session: Session, known: string[]) => session.worker.evaluate((value) => chrome.storage.local.set({ knownReleases: value }), known);

test("a first run announces nothing, and shows what files are converted for", async () => {
  const page = await session.open("convert.html");
  await expect(page.locator("#options-version")).toContainText(/for Snapmaker Orca \d/);
  await expect(page.locator("#release-notice")).toBeHidden();
});

test("after an update adds a release: says so once, until dismissed", async () => {
  const releases = await releasesOf(session);
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
