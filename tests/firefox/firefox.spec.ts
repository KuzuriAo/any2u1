// SPDX-License-Identifier: AGPL-3.0-or-later
// What differs in Firefox: the background script runs as a page, there's no showOpenFilePicker, host access is asked
// for from a click, and the converter's worker can fail its own way. The rest is the Chromium suite's.
import { convert } from "any2orca";
import { bundledProfileSource } from "any2orca/node";
import { expect, test } from "@playwright/test";
import { zipSync } from "fflate";
import { fixture, longNamesProject, plateNotesProject, POLYMAKER, SAMPLE, sha256, sharedToolheadProject, thinLayersProject } from "../shared/fixtures";
import { FILAMENT_ROWS, LAYOUTS, type FilamentRows } from "../shared/layout";
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

test("installing opens one tab that says what happens on the next 3MF download, with the steps for this browser's own menu and whether the button is pinned", async () => {
  // A launch of its own, which keeps the tab the install opened.
  await firefox.close();
  firefox = await launch(site, undefined, { keepWelcome: true });
  const page = firefox.welcome!;
  expect((await firefox.urls()).filter((url) => url.includes("view=welcome"))).toHaveLength(1);
  await page.until(`document.querySelector("#pin-state")?.textContent !== ""`);
  expect(await page.evaluate<string>(`document.querySelector("#welcome h2").textContent`)).toBe("Ready to convert");
  const pinned = await page.evaluate<boolean>(`browser.action.getUserSettings().then((settings) => settings.isOnToolbar)`);
  expect(await page.evaluate<string>(`document.querySelector("#pin-state").textContent`)).toBe(pinned ? "The any2u1 button is pinned to your toolbar." : "The any2u1 button isn't pinned to your toolbar yet. To pin it:");
  expect(await page.evaluate<boolean>(`document.querySelector("#pin-steps").hidden`)).toBe(pinned);
  expect(await page.evaluate<string>(`document.querySelector("#pin-steps").textContent`)).toBe("Click the Extensions button (the puzzle piece) in the toolbar, then the three dots beside any2u1, and choose Pin to Toolbar.");
  expect(await page.evaluate<boolean>(`!!document.querySelector("#drop") && !document.querySelector("#drop").hidden`)).toBe(true);
});

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
  // The line names the file while the settings still load; "Opening the project" comes as the file goes to the worker.
  await page.until(`document.querySelector("#status")?.textContent.includes("Converting stuck.3mf · Opening the project")`);
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
  expect(notes).toEqual(library.report.notes.map((note) => note.text));
  expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .notes h3")].map((h) => h.textContent)`)).toEqual(["Filament presets"]);
  expect(notes.join(" ")).toContain("Filaments 3 and 4 use Snapmaker PLA SnapSpeed @U1's own settings instead of the creator's: nozzle temperature 225 °C → 220 °C");
  expect(sha256(await firefox.savedFile(output))).toBe(sha256(library.output));
});

test("the filament rows hold together at every desktop size and font, with a type and names far too long for a row", async () => {
  // Firefox 159 won't size an extension page's viewport ("browsingContext.setViewport": not in privileged scope), so the
  // page is in a frame of each size, which is a viewport of that size, fixed in the corner so it's on screen.
  const host = await firefox.open("settings.html");
  const frameAt = (layout: { width: number; height: number }) => `(() => { const frame = document.querySelector("#sized") ?? document.body.appendChild(Object.assign(document.createElement("iframe"), { id: "sized", src: "convert.html?view=window" })); frame.style.cssText = "position: fixed; inset: 0 auto auto 0; z-index: 1; border: 0; width: ${layout.width}px; height: ${layout.height}px"; return true; })()`;
  await host.evaluate(frameAt(LAYOUTS[0]));
  const page = await firefox.frame(host, "convert.html?view=window");
  await page.until(`document.querySelector("#options-version")?.textContent.includes("Snapmaker Orca")`);
  await page.evaluate(`(() => { const select = document.querySelector("#filament-names"); select.value = "snapmaker"; select.dispatchEvent(new Event("change")); return true; })()`);
  await page.until(`browser.storage.local.get("settings").then(({ settings }) => settings?.convert?.filamentNames === "snapmaker")`);
  await page.setFiles("#file", [{ name: "long.3mf", bytes: longNamesProject() }], "#choose");
  await page.until(`document.querySelector(".converted strong")?.textContent === "long_U1.3mf"`);
  expect(await page.evaluate<number>(`document.querySelectorAll(".converted .filaments li .was").length`)).toBe(3);
  for (const layout of LAYOUTS) {
    await host.evaluate(frameAt(layout));
    await page.evaluate(`(document.documentElement.style.fontSize = ${JSON.stringify(layout.rootFont)})`);
    await page.until(`window.innerWidth === ${layout.width} && window.innerHeight === ${layout.height}`, 5_000);
    const rows = await page.evaluate<FilamentRows>(FILAMENT_ROWS);
    expect(rows.problems, layout.name).toEqual([]);
    // Filament 2's "was" can never fit beside its name, so the check above has a wrapped one to look at, at every size.
    expect(rows.wrapped, layout.name).toContain(2);
  }
});

test("a project with more filaments than toolheads says first what its plates need, and the long notes fit at every desktop size and font", async () => {
  const project = plateNotesProject();
  const library = await convert(project, { profiles: bundledProfileSource() });
  // In a frame of each size, as above.
  const host = await firefox.open("settings.html");
  const frameAt = (layout: { width: number; height: number }) => `(() => { const frame = document.querySelector("#sized") ?? document.body.appendChild(Object.assign(document.createElement("iframe"), { id: "sized", src: "convert.html?view=window" })); frame.style.cssText = "position: fixed; inset: 0 auto auto 0; z-index: 1; border: 0; width: ${layout.width}px; height: ${layout.height}px"; return true; })()`;
  await host.evaluate(frameAt(LAYOUTS[0]));
  const page = await firefox.frame(host, "convert.html?view=window");
  await page.until(`document.querySelector("#options-version")?.textContent.includes("Snapmaker Orca")`);
  await page.setFiles("#file", [{ name: "plates.3mf", bytes: project }], "#choose");
  await page.until(`document.querySelector(".converted strong")?.textContent === "plates_U1.3mf"`);
  expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .notes li")].map((li) => li.textContent)`)).toEqual(library.report.notes.map((note) => note.text));
  expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .notes h3")].map((h) => h.textContent)`)).toEqual(["Filaments per plate", "Plates"]);
  expect(await page.evaluate<number>(`document.querySelectorAll(".converted .filaments li").length`)).toBe(17);
  for (const layout of LAYOUTS) {
    await host.evaluate(frameAt(layout));
    await page.evaluate(`(document.documentElement.style.fontSize = ${JSON.stringify(layout.rootFont)})`);
    await page.until(`window.innerWidth === ${layout.width} && window.innerHeight === ${layout.height}`, 5_000);
    expect((await page.evaluate<FilamentRows>(FILAMENT_ROWS)).problems, layout.name).toEqual([]);
  }
});

test("a Polymaker project with the Snapmaker option: the library's file and notes, with what Snapmaker Space's rules list about five colors on a plate, and each short type on one line at every desktop size", async () => {
  const library = await convert(fixture(POLYMAKER), { profiles: bundledProfileSource(), filamentComplianceMode: "snapmaker" });
  // In a frame of each size, as above.
  const host = await firefox.open("settings.html");
  const frameAt = (layout: { width: number; height: number }) => `(() => { const frame = document.querySelector("#sized") ?? document.body.appendChild(Object.assign(document.createElement("iframe"), { id: "sized", src: "convert.html?view=window" })); frame.style.cssText = "position: fixed; inset: 0 auto auto 0; z-index: 1; border: 0; width: ${layout.width}px; height: ${layout.height}px"; return true; })()`;
  await host.evaluate(frameAt(LAYOUTS[0]));
  const page = await firefox.frame(host, "convert.html?view=window");
  await page.until(`document.querySelector("#options-version")?.textContent.includes("Snapmaker Orca")`);
  await page.evaluate(`(() => { const select = document.querySelector("#filament-names"); select.value = "snapmaker"; select.dispatchEvent(new Event("change")); return true; })()`);
  await page.until(`browser.storage.local.get("settings").then(({ settings }) => settings?.convert?.filamentNames === "snapmaker")`);
  await page.setFiles("#file", [{ name: POLYMAKER, bytes: fixture(POLYMAKER) }], "#choose");
  const output = POLYMAKER.replace(/\.3mf$/, "_U1.3mf");
  await page.until(`document.querySelector(".converted strong")?.textContent === ${JSON.stringify(output)}`);
  expect(sha256(await firefox.savedFile(output))).toBe(sha256(library.output));
  const notes = await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .notes li")].map((li) => li.textContent)`);
  expect(notes).toEqual(library.report.notes.map((note) => note.text));
  expect(notes.filter((text) => text.includes("Snapmaker Space"))).toEqual([
    "To publish on Snapmaker Space: its review rules list more than four colors on one plate as a reason to turn a file down, unless the print pauses at filament changes or uses Full Spectrum. Plate 6 uses 5.",
  ]);
  expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .notes h3")].map((h) => h.textContent)`)).toEqual(["Filaments per plate", "Filament presets", "Plates"]);
  expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .filaments .fname")].map((name) => name.textContent)`)).toEqual(library.report.filaments.map((filament) => filament.outputName));
  for (const layout of LAYOUTS) {
    await host.evaluate(frameAt(layout));
    await page.evaluate(`(document.documentElement.style.fontSize = ${JSON.stringify(layout.rootFont)})`);
    await page.until(`window.innerWidth === ${layout.width} && window.innerHeight === ${layout.height}`, 5_000);
    expect((await page.evaluate<FilamentRows>(FILAMENT_ROWS)).problems, layout.name).toEqual([]);
  }
});

for (const pause of [true, false]) {
  test(`a plate on which two filaments share a toolhead, ${pause ? "with the pause already in the project" : "with no pause yet"}: the library's file and notes, and the whole plan in sight in the small window`, async () => {
    const project = sharedToolheadProject({ pause });
    const library = await convert(project, { profiles: bundledProfileSource() });
    const plan = library.report.notes.find((note) => note.topic === "plate-filaments" && note.text.startsWith("Plate 2 "))!;
    expect(plan.text).toContain(pause ? "the project already has a pause at layer 60" : "add a pause on a layer from 26 to 100");
    // In a frame of each size, as above.
    const host = await firefox.open("settings.html");
    const frameAt = (layout: { width: number; height: number }) => `(() => { const frame = document.querySelector("#sized") ?? document.body.appendChild(Object.assign(document.createElement("iframe"), { id: "sized", src: "convert.html?view=window" })); frame.style.cssText = "position: fixed; inset: 0 auto auto 0; z-index: 1; border: 0; width: ${layout.width}px; height: ${layout.height}px"; return true; })()`;
    await host.evaluate(frameAt(LAYOUTS[0]));
    const page = await firefox.frame(host, "convert.html?view=window");
    await page.until(`document.querySelector("#options-version")?.textContent.includes("Snapmaker Orca")`);
    const name = pause ? "shared-toolhead-pause.3mf" : "shared-toolhead.3mf";
    await page.setFiles("#file", [{ name, bytes: project }], "#choose");
    const output = name.replace(/\.3mf$/, "_U1.3mf");
    await page.until(`document.querySelector(".converted strong")?.textContent === ${JSON.stringify(output)}`);
    expect(sha256(await firefox.savedFile(output))).toBe(sha256(library.output));
    expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .notes li")].map((li) => li.textContent)`)).toEqual(library.report.notes.map((note) => note.text));
    expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .notes h3")].map((h) => h.textContent)`)).toEqual(["Filaments per plate", "Plates"]);
    // As converted, with no scrolling: the result's name and the whole plan are in sight together.
    const inSight = `(() => { window.scrollTo(0, 0); const plan = [...document.querySelectorAll(".converted .notes li")].find((li) => li.textContent === ${JSON.stringify(plan.text)}); return [document.querySelector(".converted strong"), plan].every((part) => { const box = part.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; }); })()`;
    expect(await page.evaluate<boolean>(inSight)).toBe(true);
    for (const layout of LAYOUTS) {
      await host.evaluate(frameAt(layout));
      await page.evaluate(`(document.documentElement.style.fontSize = ${JSON.stringify(layout.rootFont)})`);
      await page.until(`window.innerWidth === ${layout.width} && window.innerHeight === ${layout.height}`, 5_000);
      expect((await page.evaluate<FilamentRows>(FILAMENT_ROWS)).problems, layout.name).toEqual([]);
    }
  });
}

test("the settings switches take clicks once they show what is stored, and keep them", async () => {
  const page = await firefox.open("settings.html");
  // They start disabled in the page, and are enabled when the stored settings are drawn.
  await page.until(`["#enabled", "#style-window", "#style-badge", "#ask-where"].every((id) => !document.querySelector(id).disabled)`);
  expect(await page.evaluate<boolean[]>(`["#enabled", "#style-window", "#style-badge", "#ask-where"].map((id) => document.querySelector(id).checked)`)).toEqual([true, true, false, false]);
  await page.evaluate(`(document.querySelector("#ask-where").click(), true)`);
  await page.until(`browser.storage.local.get("settings").then(({ settings }) => settings?.askWhereToSave === true)`);
  await page.evaluate(`(document.querySelector("#style-badge").click(), true)`);
  await page.until(`browser.storage.local.get("settings").then(({ settings }) => settings?.offerStyle === "badge")`);
  await page.until(`!document.querySelector("#pin-tip").hidden`);
  // Once the rest of the page has loaded, the switches are as clicked.
  await page.until(`document.querySelector("#orca-version") !== null`);
  expect(await page.evaluate<boolean[]>(`["#enabled", "#style-window", "#style-badge", "#ask-where"].map((id) => document.querySelector(id).checked)`)).toEqual([true, false, true, true]);
  expect(await page.evaluate<string>(`document.querySelector("footer #independent").textContent`)).toBe("any2u1 is an independent project, not made by or affiliated with Snapmaker or the makers of the slicers it reads.");
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

/** Chooses a value in one of the options' lists, the way a person's choice reaches the page. */
const choose = (id: string, value: string) => `(() => { const select = document.querySelector(${JSON.stringify(id)}); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event("change")); return select.value; })()`;
const storedConvert = (check: string) => `browser.storage.local.get("settings").then(({ settings }) => { const convert = settings?.convert ?? {}; return ${check}; })`;
const optionTexts = (id: string) => `[...document.querySelectorAll(${JSON.stringify(`${id} option`)})].map((option) => option.textContent)`;

test("layers thinner than the nozzle's profiles use: the library's file and notes, and the note under its own heading, whole in the small window", async () => {
  const project = thinLayersProject();
  const library = await convert(project, { profiles: bundledProfileSource(), nozzle: "0.6" });
  const note = library.report.notes.find((each) => each.topic === "layers")!;
  expect(note.text.startsWith("The project has layers as thin as 0.1 mm, below the 0.12 to 0.42 mm that Snapmaker's U1 profiles use for the 0.6 mm nozzle.")).toBe(true);
  const host = await firefox.open("settings.html");
  const frameAt = (layout: { width: number; height: number }) => `(() => { const frame = document.querySelector("#sized") ?? document.body.appendChild(Object.assign(document.createElement("iframe"), { id: "sized", src: "convert.html?view=window" })); frame.style.cssText = "position: fixed; inset: 0 auto auto 0; z-index: 1; border: 0; width: ${layout.width}px; height: ${layout.height}px"; return true; })()`;
  await host.evaluate(frameAt(LAYOUTS[0]));
  const page = await firefox.frame(host, "convert.html?view=window");
  await page.until(`document.querySelector("#options-version")?.textContent.includes("Snapmaker Orca")`);
  await page.evaluate(choose("#nozzle-size", "0.6"));
  await page.until(storedConvert(`convert.nozzle === "0.6"`));
  await page.setFiles("#file", [{ name: "thin-layers.3mf", bytes: project }], "#choose");
  await page.until(`document.querySelector(".converted strong")?.textContent === "thin-layers_U1.3mf"`);
  expect(sha256(await firefox.savedFile("thin-layers_U1.3mf"))).toBe(sha256(library.output));
  expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .notes li")].map((li) => li.textContent)`)).toEqual(library.report.notes.map((each) => each.text));
  expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .notes h3")].map((h) => h.textContent)`)).toContain("Layer height");
  // With its heading at the top of the window, the whole note is in sight, and nothing scrolls sideways.
  const inSight = `(() => { const heading = [...document.querySelectorAll(".converted .notes h3")].find((h) => h.textContent === "Layer height"); const shown = [...document.querySelectorAll(".converted .notes li")].find((li) => li.textContent === ${JSON.stringify(note.text)}); heading.scrollIntoView(); return [heading, shown].every((part) => { const box = part.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; }) && document.documentElement.scrollWidth <= document.documentElement.clientWidth; })()`;
  expect(await page.evaluate<boolean>(inSight)).toBe(true);
  for (const layout of LAYOUTS) {
    await host.evaluate(frameAt(layout));
    await page.evaluate(`(document.documentElement.style.fontSize = ${JSON.stringify(layout.rootFont)})`);
    await page.until(`window.innerWidth === ${layout.width} && window.innerHeight === ${layout.height}`, 5_000);
    expect((await page.evaluate<FilamentRows>(FILAMENT_ROWS)).problems, layout.name).toEqual([]);
    expect(await page.evaluate<boolean>(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), layout.name).toBe(true);
  }
});

test("the Layer height option lists the nozzle size's heights and follows the size, and a height chosen reaches the library: its file", async () => {
  const page = await firefox.open("convert.html");
  await page.until(`document.querySelector("#layer-height") !== null`);
  expect(await page.evaluate<string[]>(optionTexts("#layer-height"))).toEqual(["Keep the creator's layers", "0.08 mm", "0.1 mm", "0.12 mm", "0.16 mm", "0.2 mm", "0.24 mm", "0.28 mm"]);
  await page.evaluate(choose("#nozzle-size", "0.6"));
  expect(await page.evaluate<string[]>(optionTexts("#layer-height"))).toEqual(["Keep the creator's layers", "0.18 mm", "0.24 mm", "0.3 mm"]);
  expect(await page.evaluate<string>(choose("#layer-height", "0.18"))).toBe("0.18");
  await page.until(storedConvert(`convert.nozzle === "0.6" && convert.layerHeight === 0.18`));
  await page.until(`/0\\.6 mm nozzles and 0\\.18 mm layers\\)$/.test(document.querySelector("#options-version").textContent)`);
  const project = thinLayersProject();
  await page.setFiles("#file", [{ name: "one-height.3mf", bytes: project }], "#choose");
  await page.until(`document.querySelector(".converted strong")?.textContent === "one-height_U1.3mf"`);
  const library = await convert(project, { profiles: bundledProfileSource(), nozzle: "0.6", layerHeight: 0.18 });
  expect(sha256(await firefox.savedFile("one-height_U1.3mf"))).toBe(sha256(library.output));
  expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .notes li")].map((li) => li.textContent)`)).toEqual(library.report.notes.map((each) => each.text));
  expect(await page.evaluate<string>(`document.querySelector(".converted .saved").textContent`)).toContain("using 0.18mm Standard, for 0.6 mm nozzles");
  // A size without that height goes back to the creator's layers, in the page and in storage; Match the file has none to choose.
  await page.evaluate(choose("#nozzle-size", "0.4"));
  expect(await page.evaluate<string>(`document.querySelector("#layer-height").value`)).toBe("");
  await page.until(storedConvert(`convert.nozzle === "0.4" && convert.layerHeight === null`));
  await page.evaluate(choose("#nozzle-size", "match"));
  expect(await page.evaluate<string[]>(optionTexts("#layer-height"))).toEqual(["Keep the creator's layers"]);
  expect(await page.evaluate<boolean>(`document.querySelector("#layer-height").disabled`)).toBe(true);
});

test("Polymaker among the Filament choices gives the library's file, and can't be chosen for a nozzle size it has no presets for", async () => {
  const page = await firefox.open("convert.html");
  await page.until(`document.querySelector("#filament-names") !== null`);
  expect(await page.evaluate<string[]>(optionTexts("#filament-names"))).toEqual(["Original", "Snapmaker", "Polymaker", "Generic"]);
  expect(await page.evaluate<string>(choose("#filament-names", "polymaker"))).toBe("polymaker");
  await page.until(storedConvert(`convert.filamentNames === "polymaker"`));
  expect(await page.evaluate<string>(`document.querySelector("#filament-choice").textContent`)).toBe("Switch PLA to Polymaker presets, with their own settings; other filaments as Snapmaker.");
  expect(await page.evaluate<boolean>(`document.querySelector("#polymaker-reason").hidden`)).toBe(true);
  await page.setFiles("#file", [{ name: "six-filaments.3mf", bytes: fixture(POLYMAKER) }], "#choose");
  await page.until(`document.querySelector(".converted strong")?.textContent === "six-filaments_U1.3mf"`);
  const library = await convert(fixture(POLYMAKER), { profiles: bundledProfileSource(), filamentComplianceMode: "polymaker" });
  expect(sha256(await firefox.savedFile("six-filaments_U1.3mf"))).toBe(sha256(library.output));
  expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".converted .notes li")].map((li) => li.textContent)`)).toEqual(library.report.notes.map((each) => each.text));
  // At 0.6 mm it is grayed out with the reason, and the choice becomes Snapmaker, which is what it would convert as.
  await page.evaluate(choose("#nozzle-size", "0.6"));
  expect(await page.evaluate<boolean>(`document.querySelector("#filament-names option[value=polymaker]").disabled`)).toBe(true);
  expect(await page.evaluate<string>(`document.querySelector("#filament-names").value`)).toBe("snapmaker");
  expect(await page.evaluate<string>(`document.querySelector("#polymaker-reason").textContent`)).toBe("Snapmaker Orca has Polymaker presets for the 0.4 mm nozzle only.");
  expect(await page.evaluate<boolean>(`document.querySelector("#polymaker-reason").hidden`)).toBe(false);
  await page.until(storedConvert(`convert.nozzle === "0.6" && convert.filamentNames === "snapmaker"`));
});
