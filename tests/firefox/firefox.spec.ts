// SPDX-License-Identifier: AGPL-3.0-or-later
// What differs in Firefox: the background script runs as a page, there's no showOpenFilePicker, host access is asked
// for from a click, and the converter's worker can fail its own way. The rest is the Chromium suite's.
import { convert, filamentNotes } from "any2orca";
import { bundledProfileSource } from "any2orca/node";
import { expect, test } from "@playwright/test";
import { zipSync } from "fflate";
import { fixture, SAMPLE, sha256 } from "../shared/fixtures";
import { startSiteServer, type SiteServer } from "../shared/site";
import { launch, type Session } from "./firefox";

let site: SiteServer;
let firefox: Session;
test.beforeEach(async () => {
  site = await startSiteServer();
  firefox = await launch(site);
});
test.afterEach(async () => {
  await firefox.close();
  await site.close();
});

const libraryOutput = async (bytes: Buffer) => sha256((await convert(bytes, { profiles: bundledProfileSource(), highFlowHotends: false, hardenedNozzles: false })).output);
/** Whatever left the browser went to the test site: nothing to any other host. */
const onlyTheSite = () => {
  expect(firefox.proxied.length).toBeGreaterThan(0);
  expect(firefox.proxied.filter((request) => request !== `CONNECT 127.0.0.1:${site.port}`)).toEqual([]);
};
const pendingCount = (session: Session, tab: Awaited<ReturnType<Session["open"]>>) =>
  tab.evaluate<number>(`browser.storage.session.get(null).then((all) => Object.keys(all).filter((key) => key.startsWith("pending:")).length)`);

test("a 3MF that finishes downloading opens the offer window, from the background page", async () => {
  await firefox.download(site, "/open/desk.3mf");
  const offer = await firefox.offerWindow();
  await offer.until(`document.querySelector(".row .name")?.textContent === "desk.3mf"`);
  expect(await offer.evaluate(`document.querySelector(".row .site").textContent`)).toBe("127.0.0.1");
  expect(site.countFor("/open/desk.3mf")).toBe(1); // Nothing is fetched until the user says yes.
});

test("Convert on a server anyone can read: no prompt, the library's bytes, and nothing sent anywhere else", async () => {
  await firefox.download(site, "/open/desk.3mf");
  const offer = await firefox.offerWindow();
  await offer.until(`document.querySelector(".row button.primary")`);
  await offer.click(".row button.primary");
  await offer.until(`document.querySelector(".converted strong")?.textContent === "desk_U1.3mf"`);
  expect(sha256(await firefox.savedFile("desk_U1.3mf"))).toBe(await libraryOutput(fixture(SAMPLE)));

  // The browser's download and the one fetch, with no cookie or referrer.
  expect(site.log.map((entry) => entry.path)).toEqual(["/", "/open/desk.3mf", "/open/desk.3mf"]);
  const fetched = site.log[2]!;
  expect(fetched.headers.cookie).toBeUndefined();
  expect(fetched.headers.referer).toBeUndefined();
  onlyTheSite();
});

test("a server that refuses gives both choices, and Allow access, from a click, fetches and converts", async () => {
  await firefox.download(site, "/closed/desk.3mf");
  const offer = await firefox.offerWindow();
  await offer.until(`document.querySelector(".row button.primary")`);
  await offer.click(".row button.primary");
  await offer.until(`document.querySelector(".row button.allow")?.textContent === "Allow access to 127.0.0.1" && document.querySelector(".row button.pick")`);

  // A scripted call can't ask: Firefox only allows the request from a user's click.
  const scripted = await offer.evaluate<string>(`browser.permissions.request({ origins: ["https://127.0.0.1/*"] }).then(() => "granted", (error) => error.message)`);
  expect(scripted).toContain("user input handler");
  // A real click asks, and the test profile accepts the prompt.
  await offer.click(".row button.allow");
  await offer.until(`document.querySelector(".converted strong")?.textContent === "desk_U1.3mf"`);
  expect(sha256(await firefox.savedFile("desk_U1.3mf"))).toBe(await libraryOutput(fixture(SAMPLE)));
  expect(await offer.evaluate(`browser.permissions.contains({ origins: ["https://127.0.0.1/*"] })`)).toBe(true);
  expect(site.countFor("/closed/desk.3mf")).toBe(3); // The download, the refused read, and the read once allowed.
  onlyTheSite();
});

test("Choose a file uses the file input, since Firefox has no showOpenFilePicker, and a zip of two gives two results", async () => {
  const page = await firefox.open("convert.html");
  await page.until(`document.querySelector("#options-version")?.textContent.includes("Snapmaker Orca")`);
  expect(await page.evaluate(`typeof window.showOpenFilePicker`)).toBe("undefined");
  // The click starts the page's own picker, which falls back to the input and waits for it.
  await page.setFiles("#file", [{ name: SAMPLE, bytes: fixture(SAMPLE) }], "#choose");
  const output = SAMPLE.replace(/\.3mf$/, "_U1.3mf");
  await page.until(`document.querySelector(".converted strong")?.textContent === ${JSON.stringify(output)}`);
  expect(sha256(await firefox.savedFile(output))).toBe(await libraryOutput(fixture(SAMPLE)));

  const zip = Buffer.from(zipSync({ "models/one.3mf": fixture(SAMPLE), "models/two.3mf": fixture(SAMPLE) }));
  await page.setFiles("#file", [{ name: "models.zip", bytes: zip }], "#choose");
  await page.until(`document.querySelectorAll(".converted").length === 3`);
  for (const name of ["one_U1.3mf", "two_U1.3mf"]) expect(sha256(await firefox.savedFile(name))).toBe(await libraryOutput(fixture(SAMPLE)));
  expect(firefox.proxied).toEqual([]); // A file from the computer: nothing leaves the browser at all.
});

test("the extension's own saves get no offer", async () => {
  const page = await firefox.open("convert.html");
  await page.until(`document.querySelector("#options-version")?.textContent.includes("Snapmaker Orca")`);
  await page.setFiles("#file", [{ name: SAMPLE, bytes: fixture(SAMPLE) }], "#choose");
  const output = SAMPLE.replace(/\.3mf$/, "_U1.3mf");
  await firefox.savedFile(output);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(await pendingCount(firefox, page)).toBe(0);
  expect((await firefox.urls()).some((url) => url.includes("view=window"))).toBe(false);
});

test("a worker that fails mid-conversion: the file gets a message, and the next file converts in a new worker", async () => {
  const page = await firefox.open("convert.html");
  await page.until(`document.querySelector("#options-version")?.textContent.includes("Snapmaker Orca")`);
  // The page started its worker while loading, so the hook goes on the prototype, where that worker finds it.
  await page.evaluate(`(() => {
    const scope = window;
    scope.workers = [];
    scope.swallow = false;
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, transfer) {
      if (!scope.workers.includes(this)) scope.workers.push(this);
      if (scope.swallow && message && message.op === "open") return;
      return send.call(this, message, transfer);
    };
    return true;
  })()`);
  await page.evaluate(`(window.swallow = true)`);
  await page.setFiles("#file", [{ name: "stuck.3mf", bytes: fixture(SAMPLE) }], "#choose");
  await page.until(`document.querySelector("#status")?.textContent.includes("Converting stuck.3mf")`);
  // What a worker that runs out of memory looks like from the page.
  expect(await page.evaluate(`(() => { const worker = window.workers.at(-1); worker.dispatchEvent(new ErrorEvent("error", { message: "out of memory" })); worker.terminate(); return window.workers.length; })()`)).toBe(1);
  await page.until(`document.querySelector(".failed strong")?.textContent === "stuck.3mf"`);
  expect(await page.evaluate(`document.querySelector(".failed p").textContent`)).toContain("ran out of memory");

  await page.evaluate(`(window.swallow = false)`);
  await page.setFiles("#file", [{ name: SAMPLE, bytes: fixture(SAMPLE) }], "#choose");
  const output = SAMPLE.replace(/\.3mf$/, "_U1.3mf");
  await page.until(`document.querySelector(".converted strong")?.textContent === ${JSON.stringify(output)}`);
  expect(sha256(await firefox.savedFile(output))).toBe(await libraryOutput(fixture(SAMPLE)));
  expect(await page.evaluate(`window.workers.length`)).toBe(2);
});

test("the Snapmaker option's notes are the library's sentences, and the file is the library's", async () => {
  const page = await firefox.open("convert.html");
  await page.until(`document.querySelector("#options-version")?.textContent.includes("Snapmaker Orca")`);
  await page.evaluate(`(() => { const select = document.querySelector("#filament-names"); select.value = "snapmaker"; select.dispatchEvent(new Event("change")); return true; })()`);
  await page.until(`browser.storage.local.get("settings").then(({ settings }) => settings?.convert?.filamentNames === "snapmaker")`);
  await page.setFiles("#file", [{ name: SAMPLE, bytes: fixture(SAMPLE) }], "#choose");
  const output = SAMPLE.replace(/\.3mf$/, "_U1.3mf");
  await page.until(`document.querySelector(".converted strong")?.textContent === ${JSON.stringify(output)}`);
  const library = await convert(fixture(SAMPLE), { profiles: bundledProfileSource(), filamentComplianceMode: "snapmaker" });
  const notes = await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .notes li")].map((li) => li.textContent)`);
  expect(notes).toEqual([...library.report.warnings, ...filamentNotes(library.report)]);
  expect(notes.join(" ")).toContain("Filaments 3 and 4 use Snapmaker PLA SnapSpeed @U1's own settings instead of the creator's: nozzle temperature 225 °C → 220 °C");
  expect(sha256(await firefox.savedFile(output))).toBe(sha256(library.output));
});

test("the nozzle size chosen reaches the library: a 0.4 mm project made for 0.6 mm nozzles, the library's file", async () => {
  const page = await firefox.open("convert.html");
  await page.until(`document.querySelector("#options-version")?.textContent.includes("Snapmaker Orca")`);
  await page.evaluate(`(() => { const select = document.querySelector("#nozzle-size"); select.value = "0.6"; select.dispatchEvent(new Event("change")); return true; })()`);
  await page.until(`browser.storage.local.get("settings").then(({ settings }) => settings?.convert?.nozzle === "0.6")`);
  await page.setFiles("#file", [{ name: SAMPLE, bytes: fixture(SAMPLE) }], "#choose");
  const output = SAMPLE.replace(/\.3mf$/, "_U1.3mf");
  await page.until(`document.querySelector(".converted strong")?.textContent === ${JSON.stringify(output)}`);
  expect(await page.evaluate<string>(`document.querySelector(".converted .saved").textContent`)).toContain("for 0.6 mm nozzles");
  const library = await convert(fixture(SAMPLE), { profiles: bundledProfileSource(), nozzle: "0.6" });
  expect(sha256(await firefox.savedFile(output))).toBe(sha256(library.output));
});
