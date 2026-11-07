// SPDX-License-Identifier: AGPL-3.0-or-later
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { defaultSettings } from "../../src/core/settings";
import { extensionPath, launch, setSettings, type Session } from "./helpers";

const RELEASES = ["2.5.1", "2.5.0", "2.4.3", "2.4.2", "2.4.1", "2.4.0"];

/**
 * A copy of the built extension whose catalog lists made-up releases, under the library's rules for a catalog: the
 * newest at its top, matching its slicer, and each older one in releases/<version>. Only the list is made up; drawing
 * the picker never reads an older release's folder. The copy is in a temporary folder, so nothing here enters dist.
 */
function withReleases(releases: string[]): string {
  const copy = mkdtempSync(join(tmpdir(), "extension-releases-"));
  cpSync(extensionPath, copy, { recursive: true });
  const path = join(copy, "profiles", "index.json");
  const index = JSON.parse(readFileSync(path, "utf-8")) as { slicer: Record<string, string>; releases: unknown };
  const newest = releases[0]!;
  index.slicer = { ...index.slicer, version: newest, application: `Snapmaker_Orca-${newest}` };
  index.releases = releases.map((version) => ({ version, application: `Snapmaker_Orca-${version}`, path: version === newest ? "." : `releases/${version}` }));
  writeFileSync(path, JSON.stringify(index));
  return copy;
}

let extension: string;
let session: Session;
test.beforeAll(() => {
  extension = withReleases(RELEASES);
});
test.beforeEach(async () => {
  session = await launch(extension);
});
test.afterEach(async () => {
  await session.close();
});

const storedVersion = () =>
  session.worker.evaluate(() => chrome.storage.local.get("settings").then(({ settings }) => (settings as { convert: { snapmakerOrcaVersion: string | null } }).convert.snapmakerOrcaVersion));
const choose = (version: string | null) => {
  const settings = defaultSettings();
  return setSettings(session, { ...settings, convert: { ...settings.convert, snapmakerOrcaVersion: version } });
};
const values = (page: Page, selector: string) => page.locator(selector).evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
const olderToggle = (page: Page) => page.getByRole("button", { name: "Older versions (3)", exact: true });

test("the picker shows the current releases, with the older ones behind a closed control", async () => {
  const page = await session.open("settings.html");
  await expect(page.locator("#orca-version option").first()).toHaveText("Newest (currently 2.5.1)");
  expect(await values(page, "#orca-version option")).toEqual(["", "2.5.1", "2.5.0", "2.4.3"]);
  await expect(olderToggle(page)).toBeVisible();
  await expect(olderToggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#orca-version optgroup")).toHaveCount(0);
});

test("the control opens and closes by keyboard and says so, and an older release picked is saved exactly", async () => {
  const page = await session.open("settings.html");
  await page.locator("#orca-version").focus();
  await page.keyboard.press("Tab");
  await expect(olderToggle(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(olderToggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#orca-version optgroup")).toHaveAttribute("label", "Older versions");
  expect(await values(page, "#orca-version optgroup option")).toEqual(["2.4.2", "2.4.1", "2.4.0"]);
  await page.keyboard.press("Space");
  await expect(olderToggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#orca-version optgroup")).toHaveCount(0);

  await page.keyboard.press("Enter");
  await page.selectOption("#orca-version", "2.4.1");
  await expect.poll(storedVersion).toBe("2.4.1");
  // Closing the list now would show another choice than the saved one, so the control steps aside.
  await expect(olderToggle(page)).toBeHidden();
  await page.selectOption("#orca-version", "2.5.0");
  await expect.poll(storedVersion).toBe("2.5.0");
  await expect(olderToggle(page)).toBeVisible();
  await expect(olderToggle(page)).toHaveAttribute("aria-expanded", "true");
});

test("a saved older choice starts with the list open, on both pages, and the label agrees", async () => {
  await choose("2.4.0");
  const settings = await session.open("settings.html");
  await expect(settings.locator("#orca-version")).toHaveValue("2.4.0");
  await expect(settings.locator("#orca-version optgroup")).toHaveCount(1);
  await expect(olderToggle(settings)).toBeHidden();

  const page = await session.open("convert.html");
  await expect(page.locator("#options-version")).toContainText("Snapmaker Orca 2.4.0");
  await page.locator("summary").click();
  await expect(page.locator("#orca-version")).toHaveValue("2.4.0");
  await expect(page.locator("#orca-version optgroup")).toHaveCount(1);
  expect(await storedVersion()).toBe("2.4.0");
});
