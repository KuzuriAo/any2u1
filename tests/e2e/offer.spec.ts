// SPDX-License-Identifier: AGPL-3.0-or-later
import { convert } from "any2orca";
import { bundledProfileSource } from "any2orca/node";
import { expect, test } from "@playwright/test";
import { defaultSettings } from "../../src/core/settings";
import { downloadBlob, expectOnlyThese, fixture, fixturePath, launch, offerWindows, SAMPLE, savedNames, setSettings, sha256, startSite, type Session, type TestSite } from "./helpers";

let session: Session;
let site: TestSite;
test.beforeEach(async () => {
  session = await launch();
  site = await startSite();
});
test.afterEach(async () => {
  await session.close();
  await site.close();
});

test("a download the server lets anyone read: one click, no prompt, converted, nothing else sent", async () => {
  await site.download(session, "/open/desk.3mf");
  const offer = await session.offerWindow();
  const row = offer.locator(".row");
  await expect(row.locator(".name")).toHaveText("desk.3mf");
  await expect(row.locator(".site")).toHaveText("127.0.0.1");
  expect(site.countFor("/open/desk.3mf")).toBe(1); // Nothing is fetched until the user says yes.

  await row.locator("button.primary").click();
  await expect(offer.locator(".converted strong")).toHaveText("desk_U1.3mf");
  await session.savedFile("desk_U1.3mf");
  await expect(offer.locator(".row")).toHaveCount(0);
  await expect(offer.locator("#open-tip")).toBeVisible();

  // The download and the one fetch, and the fetch carried no cookie or referrer.
  expect(site.countFor("/open/desk.3mf")).toBe(2);
  const fetchRequest = site.log.filter((entry) => entry.path === "/open/desk.3mf")[1]!;
  expect(fetchRequest.headers.cookie).toBeUndefined();
  expect(fetchRequest.headers.referer).toBeUndefined();
  expectOnlyThese(session.requests, session.origin, [`${site.url}/`]);
  expect(site.log.every((entry) => entry.path === "/" || entry.path === "/open/desk.3mf")).toBe(true);
});

test("its own output gets no second offer", async () => {
  await site.download(session, "/open/desk.3mf");
  const offer = await session.offerWindow();
  await offer.locator("button.primary").click();
  await session.savedFile("desk_U1.3mf");
  await offer.waitForTimeout(1000);
  expect(await session.pendingCount()).toBe(0);
  await expect(offer.locator(".row")).toHaveCount(0);
});

test("a server that refuses: explains first, with site access and the picker as equal choices", async () => {
  await site.download(session, "/closed/desk.3mf");
  const offer = await session.offerWindow();
  await offer.locator("button.primary").click();
  const row = offer.locator(".row");
  await expect(row.locator("button.allow")).toHaveText("Allow access to 127.0.0.1");
  await expect(row.locator("button.pick")).toBeVisible();
  await expect(row.locator(".explain").first()).toContainText("127.0.0.1");

  const [chooser] = await Promise.all([offer.waitForEvent("filechooser"), row.locator("button.pick").click()]);
  await chooser.setFiles(fixturePath(SAMPLE));
  await expect(offer.locator(".converted strong")).toHaveText(SAMPLE.replace(/\.3mf$/, "_U1.3mf"));
  await expect(offer.locator(".row")).toHaveCount(0);
});

test("a file built in the page: straight to the picker, no prompt and no fetch", async () => {
  await downloadBlob(session, site, "page-built.3mf", fixture(SAMPLE));
  const offer = await session.offerWindow();
  const row = offer.locator(".row");
  await expect(row.locator(".name")).toHaveText("page-built.3mf");
  await expect(row.locator("button.pick")).toBeVisible();
  await expect(row.locator("button.primary")).toHaveCount(0);
  await expect(row.locator("button.allow")).toHaveCount(0);

  const [chooser] = await Promise.all([offer.waitForEvent("filechooser"), row.locator("button.pick").click()]);
  await chooser.setFiles({ name: "page-built.3mf", mimeType: "text/plain", buffer: fixture(SAMPLE) });
  await expect(offer.locator(".converted strong")).toHaveText("page-built_U1.3mf");
  await session.savedFile("page-built_U1.3mf");
});

for (const [name, path] of [["a soft login wall", "/wall/desk.3mf"], ["a file that changed", "/changed/desk.3mf"]] as const) {
  test(`${name} on the second look goes to the picker, not to the converter`, async () => {
    await site.download(session, path);
    const offer = await session.offerWindow();
    await offer.locator("button.primary").click();
    await expect(offer.locator(".row button.pick")).toBeVisible();
    await expect(offer.locator(".row button.allow")).toHaveCount(0);
    await expect(offer.locator(".converted")).toHaveCount(0);
  });
}

test("a server that never finishes sending: Dismiss stays, and ends the fetch", async () => {
  await site.download(session, "/trickle/desk.3mf");
  const offer = await session.offerWindow();
  await offer.locator("button.primary").click();
  await expect(offer.locator(".row .working")).toHaveText(/^Getting the file\.\.\./);
  await expect.poll(() => site.trickling()).toBe(1);
  await offer.locator(".row button.dismiss").click();
  await expect(offer.locator(".row")).toHaveCount(0);
  await expect.poll(() => site.trickling()).toBe(0);
  expect(await session.pendingCount()).toBe(0);
});

test("a file being fetched shows how much has arrived, against the size the browser saved", async () => {
  await site.download(session, "/trickle/desk.3mf");
  const offer = await session.offerWindow();
  await offer.locator("button.primary").click();
  const line = offer.locator(".row .working");
  await expect(line).toHaveText(/^Getting the file\.\.\. \d+ B of 66 KB$/);
  const first = await line.textContent();
  await expect.poll(() => line.textContent(), { timeout: 8000 }).not.toBe(first);
  await expect(line).toHaveText(/^Getting the file\.\.\. \d+ B of 66 KB$/);
  await offer.locator(".row button.dismiss").click();
});

test("a download that's converting shows its step on its row, in place", async () => {
  await site.download(session, "/open/desk.3mf");
  const offer = await session.offerWindow();
  await offer.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { rowSteps: string[] }).rowSteps = seen;
    new MutationObserver(() => seen.push(document.querySelector(".row .working")?.textContent ?? "")).observe(document.querySelector("#pending")!, { childList: true, characterData: true, subtree: true });
  });
  await offer.locator("button.primary").click();
  await expect(offer.locator(".converted strong")).toHaveText("desk_U1.3mf");
  const text = (await offer.evaluate(() => (window as unknown as { rowSteps: string[] }).rowSteps)).join("\n");
  expect(text).toMatch(/Converting · Opening the project · \d+ s/);
  expect(text).toMatch(/Converting · Writing the file · \d+ s/);
});

test("one file is fetched at a time, and the next starts when the first is dismissed", async () => {
  await site.download(session, "/trickle/one.3mf");
  const offer = await session.offerWindow();
  await site.download(session, "/trickle/two.3mf");
  await expect(offer.locator(".row button.primary")).toHaveCount(2);
  await offer.locator(".row button.primary").first().click();
  await expect(offer.locator(".row .working").first()).toHaveText(/^Getting the file\.\.\./);
  await offer.locator(".row button.primary").click();
  await expect(offer.locator(".row .working")).toHaveText([/^Getting the file\.\.\./, "Waiting for the files ahead of it..."]);
  await offer.waitForTimeout(1500);
  expect(site.trickling()).toBe(1);
  await offer.locator(".row button.dismiss").first().click();
  await expect(offer.locator(".row .working")).toHaveText(/^Getting the file\.\.\./);
  await expect.poll(() => site.countFor("/trickle/two.3mf")).toBe(2);
  // The server hears the first connection close a moment after the page has let it go.
  await expect.poll(() => site.trickling()).toBe(1);
  await offer.locator(".row button.dismiss").click();
  await expect.poll(() => site.trickling()).toBe(0);
});

test("an address with a user name and password: fetched without them, with no prompt", async () => {
  await site.download(session, site.url.replace("https://", "https://user:secret@") + "/open/desk.3mf");
  const offer = await session.offerWindow();
  await offer.locator("button.primary").click();
  await expect(offer.locator(".converted strong")).toHaveText("desk_U1.3mf");
  await expect(offer.locator(".row button.allow")).toHaveCount(0);
  const fetched = site.log.filter((entry) => entry.path === "/open/desk.3mf").at(-1)!;
  expect(fetched.headers.authorization).toBeUndefined();
});

test("a file saved with no extension is caught by its type, and named sensibly", async () => {
  await site.download(session, "/type-only/thing");
  const offer = await session.offerWindow();
  await expect(offer.locator(".row .name")).toHaveText("thing");
  await offer.locator("button.primary").click();
  await session.savedFile("thing_U1.3mf");
});

test("a PrusaSlicer project that arrives as a download converts through the same offer", async () => {
  await site.download(session, "/prusa.3mf");
  const offer = await session.offerWindow();
  await offer.locator("button.primary").click();
  await expect(offer.locator(".converted .filaments li")).toHaveCount(4);
  const saved = await session.savedFile("prusa_U1.3mf");
  const library = await convert(fixture("prusaslicer-2.9.6-scene.3mf"), { profiles: bundledProfileSource(), highFlowHotends: false, hardenedNozzles: false });
  expect(sha256(saved)).toBe(sha256(library.output));
});

test("a project from a slicer that isn't supported: says why, and doesn't offer the saved copy, which would fail the same way", async () => {
  await site.download(session, "/superslicer.3mf");
  const offer = await session.offerWindow();
  await offer.locator("button.primary").click();
  await expect(offer.locator(".failed p")).toContainText("SuperSlicer");
  await expect(offer.locator(".row")).toHaveCount(0);
  expect(savedNames(session)).toEqual(["superslicer.3mf"]);
  // A download knows the site it came from, and the report says so.
  await offer.locator(".failed .report-text summary").click();
  await expect(offer.locator(".failed .report-text pre")).toContainText("Site: 127.0.0.1");
});

test("a damaged file fetched from the site: offers the saved copy, in case it was damaged on the way", async () => {
  await site.download(session, "/damaged.3mf");
  const offer = await session.offerWindow();
  await offer.locator("button.primary").click();
  await expect(offer.locator(".failed p")).not.toBeEmpty();
  await expect(offer.locator(".row button.pick")).toBeVisible();
});

test("a zip download gets no offer", async () => {
  await site.download(session, "/bundle.zip");
  await expect.poll(() => savedNames(session)).toContain("bundle.zip");
  await session.worker.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1000)));
  expect(await session.pendingCount()).toBe(0);
  expect(offerWindows(session)).toEqual([]);
});

test("several downloads share one window", async () => {
  await site.download(session, "/open/desk.3mf");
  const offer = await session.offerWindow();
  await site.download(session, "/open/other.3mf");
  await expect(offer.locator(".row .name")).toHaveText(["desk.3mf", "other.3mf"]);
  expect(offerWindows(session).length).toBe(1);
});

test("closing the window and downloading again opens a new one", async () => {
  await site.download(session, "/open/desk.3mf");
  const first = await session.offerWindow();
  await first.close();
  await expect.poll(() => session.worker.evaluate(async () => (await chrome.storage.session.get("offerWindowId")).offerWindowId ?? null)).toBeNull();
  await site.download(session, "/open/other.3mf");
  const second = await session.offerWindow();
  // The first download is still waiting, since it was never answered.
  await expect(second.locator(".row .name")).toHaveText(["desk.3mf", "other.3mf"]);
});

test("dismiss removes the offer", async () => {
  await site.download(session, "/open/desk.3mf");
  const offer = await session.offerWindow();
  await offer.locator("button.dismiss").click();
  await expect(offer.locator(".row")).toHaveCount(0);
  expect(await session.pendingCount()).toBe(0);
});

test("the off switch: no offer at all", async () => {
  await setSettings(session, { ...defaultSettings(), enabled: false });
  await site.download(session, "/open/desk.3mf");
  await expect.poll(() => savedNames(session)).toContain("desk.3mf");
  await session.worker.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1000)));
  expect(await session.pendingCount()).toBe(0);
  expect(offerWindows(session)).toEqual([]);
});

test("not on this site: no more offers from that host, until it's removed in settings", async () => {
  await site.download(session, "/open/desk.3mf");
  const offer = await session.offerWindow();
  await offer.locator("button.quiet").click();
  await expect(offer.locator(".row")).toHaveCount(0);
  await site.download(session, "/open/other.3mf");
  await expect.poll(() => savedNames(session)).toContain("other.3mf");
  await offer.waitForTimeout(1000);
  await expect(offer.locator(".row")).toHaveCount(0);

  const settings = await session.open("settings.html");
  await expect(settings.locator("#quiet li span")).toHaveText("127.0.0.1");
  await settings.locator("#quiet button").click();
  await expect(settings.locator("#quiet li.empty")).toBeVisible();
});

test("the badge setting: a number and no window, and the button opens the window", async () => {
  await setSettings(session, { ...defaultSettings(), offerStyle: "badge" });
  await site.download(session, "/open/desk.3mf");
  await expect.poll(() => session.worker.evaluate(() => chrome.action.getBadgeText({}))).toBe("1");
  expect(offerWindows(session)).toEqual([]);

  await session.worker.evaluate(() => (chrome.action.onClicked as unknown as { dispatch(tab: object): void }).dispatch({}));
  const offer = await session.offerWindow();
  await expect(offer.locator(".row .name")).toHaveText("desk.3mf");
  await offer.locator("button.dismiss").click();
  await expect.poll(() => session.worker.evaluate(() => chrome.action.getBadgeText({}))).toBe("");
});

test("the button with nothing waiting opens the convert page in a tab", async () => {
  await session.worker.evaluate(() => (chrome.action.onClicked as unknown as { dispatch(tab: object): void }).dispatch({}));
  const page = await session.context.waitForEvent("page", { predicate: (p) => p.url().endsWith("/convert.html") });
  await expect(page.locator("h1")).toBeVisible();
  expect(offerWindows(session)).toEqual([]);
});

test("the settings page has a Close button that closes its tab", async () => {
  const page = await session.open("settings.html");
  await expect(page.locator("#close")).toBeVisible();
  await Promise.all([page.waitForEvent("close"), page.locator("#close").click()]);
  expect(page.isClosed()).toBe(true);
});

test("the settings page tells people to pin the button when they choose the badge", async () => {
  const page = await session.open("settings.html");
  await expect(page.locator("#pin-tip")).toBeHidden();
  await page.check("#style-badge");
  await expect(page.locator("#pin-tip")).toBeVisible();
  await page.check("#style-window");
  await expect(page.locator("#pin-tip")).toBeHidden();
});
