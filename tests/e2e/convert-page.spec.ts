// SPDX-License-Identifier: AGPL-3.0-or-later
import { chmodSync } from "node:fs";
import { convert } from "any2orca";
import { bundledProfileSource } from "any2orca/node";
import { expect, test } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { FILAMENT_HELP, NOZZLE_HELP } from "../../src/core/settings";
import { FILAMENT_ROWS, LAYOUTS, type FilamentRows } from "../shared/layout";
import { libraryVersion } from "./helpers";
import { expectOnlyThese, fixture, fixturePath, launch, longNamesProject, plateNotesProject, PRUSA_FIXTURES, SAMPLE, savedNames, setSettings, sha256, superSlicerProject, type Session } from "./helpers";

let session: Session;
test.beforeEach(async () => {
  session = await launch();
});
test.afterEach(async () => {
  await session.close();
});

const zipFile = (name: string, entries: Record<string, Uint8Array>) => ({ name, mimeType: "application/zip", buffer: Buffer.from(zipSync(entries)) });

test("the file picker hides nothing, since a 3MF can be saved with no extension", async () => {
  const page = await session.open("convert.html");
  await expect(page.locator("#file")).not.toHaveAttribute("accept");
  await expect(page.locator("#row-file")).not.toHaveAttribute("accept");
});

for (const name of [
  "bambu-studio-2.8.4.57-beta.3mf",
  "creality-print-7.3.0.6157-scene.3mf",
  "anycubic-slicer-next-2.0.0.3-scene.3mf",
  "elegoo-slicer-1.5.3.5-scene.3mf",
  "flash-studio-1.7.20-scene.3mf",
  "qidi-studio-2.7.2.73-scene.3mf",
  ...PRUSA_FIXTURES,
]) {
  test(`${name}: same bytes as the library, with nothing but the extension's own files requested`, async () => {
    const page = await session.open("convert.html");
    await page.setInputFiles("#file", fixturePath(name));
    const outputName = name.replace(/\.3mf$/, "_U1.3mf");
    await expect(page.locator(".converted strong")).toHaveText(outputName);
    const saved = await session.savedFile(outputName);
    const library = await convert(fixture(name), { profiles: bundledProfileSource(), highFlowHotends: false, hardenedNozzles: false });
    expect(sha256(saved)).toBe(sha256(library.output));
    expectOnlyThese(session.requests, session.origin);
  });
}

test("each option reaches the library: same bytes as asking it directly", async () => {
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await page.locator("#orca-version option").first().waitFor({ state: "attached" });
  const versions = await page.locator("#orca-version option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value).filter((value) => value !== ""));
  expect(versions.length).toBeGreaterThan(1);
  const older = versions[1]!;
  await page.selectOption("#orca-version", older);
  await page.check("#high-flow-1");
  await page.check("#high-flow-3");
  await page.check("#hardened");
  await page.selectOption("#filament-names", "snapmaker");
  await expect.poll(() => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { convert?: { filamentNames?: string } } | undefined)?.convert?.filamentNames)).toBe("snapmaker");

  await page.setInputFiles("#file", fixturePath(SAMPLE));
  const saved = await session.savedFile(SAMPLE.replace(/\.3mf$/, "_U1.3mf"));
  const library = await convert(fixture(SAMPLE), {
    profiles: bundledProfileSource(),
    snapmakerOrcaVersion: older,
    highFlowHotends: [true, false, true, false],
    hardenedNozzles: true,
    filamentComplianceMode: "snapmaker",
  });
  expect(sha256(saved)).toBe(sha256(library.output));
  // And it's different from the default, or this test would prove nothing.
  const plain = await convert(fixture(SAMPLE), { profiles: bundledProfileSource() });
  expect(sha256(saved)).not.toBe(sha256(plain.output));
});

test("options survive a reload", async () => {
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await page.check("#hardened");
  await expect.poll(() => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { convert?: { hardenedNozzles?: boolean } } | undefined)?.convert?.hardenedNozzles)).toBe(true);
  await page.reload();
  await page.locator("summary").click();
  await expect(page.locator("#hardened")).toBeChecked();
});

test("a zip by hand converts the 3MF files inside and skips the rest", async () => {
  const page = await session.open("convert.html");
  const sample = fixture(SAMPLE);
  await page.setInputFiles("#file", zipFile("models.zip", {
    "models/one.3mf": sample,
    "models/parts/two.3mf": sample,
    "models/stl/part.stl": strToU8("solid x"),
    "__MACOSX/models/._one.3mf": strToU8("junk"),
  }));
  await expect(page.locator(".converted strong")).toHaveText(["one_U1.3mf", "two_U1.3mf"]);
  await expect(page.locator(".failed")).toHaveCount(0);
  await session.savedFile("one_U1.3mf");
  await session.savedFile("two_U1.3mf");
  expect(savedNames(session).sort()).toEqual(["one_U1.3mf", "two_U1.3mf"]);
});

test("a damaged 3MF in a zip gets a clear message and doesn't stop the others", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", zipFile("models.zip", { "bad.3mf": strToU8("not a zip at all"), "good.3mf": fixture(SAMPLE) }));
  await expect(page.locator(".converted strong")).toHaveText("good_U1.3mf");
  await expect(page.locator(".failed strong")).toHaveText("bad.3mf");
  await expect(page.locator(".failed p")).not.toBeEmpty();
});

for (const name of ["stl-only.zip", "stl-only"]) {
  test(`a zip with no 3MF says so, in words about a zip: named ${name}`, async () => {
    const page = await session.open("convert.html");
    await page.setInputFiles("#file", zipFile(name, { "part.stl": strToU8("solid x"), "readme.txt": strToU8("hi") }));
    await expect(page.locator(".failed p")).toContainText("This file is a zip, but not a 3MF project");
    expect(savedNames(session)).toEqual([]);
  });
}

test("a project from a slicer that isn't supported gets a message that names it and the slicers that work, and saves nothing", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", { name: "other.3mf", mimeType: "model/3mf", buffer: superSlicerProject() });
  const message = page.locator(".failed p");
  await expect(message).toContainText("SuperSlicer");
  await expect(message).toContainText("can be converted");
  // The list of slicers that work is the library's own, and it names PrusaSlicer.
  await expect(message).toContainText("PrusaSlicer can be converted");
  await expect(message).not.toContainText("any2orca");
  expect(savedNames(session)).toEqual([]);
});

test("a file that isn't a 3MF at all gets a message", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", { name: "a.3mf", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator(".failed p")).not.toBeEmpty();
});

test("a hostile name stays text, and can't choose where the file goes", async () => {
  const page = await session.open("convert.html");
  const hostile = '<img src=x onerror=alert(1)>.3mf';
  await page.setInputFiles("#file", { name: hostile, mimeType: "model/3mf", buffer: fixture(SAMPLE) });
  await expect(page.locator(".converted strong")).toHaveText("_img src=x onerror=alert(1)__U1.3mf");
  await expect(page.locator(".converted img")).toHaveCount(0);
  await session.savedFile("_img src=x onerror=alert(1)__U1.3mf");
});

test("names a browser would refuse or shorten are cleaned first, so every file is saved under the name shown", async () => {
  const page = await session.open("convert.html");
  const sample = fixture(SAMPLE);
  const names = {
    "family\u{1F468}\u200d\u{1F469}\u200d\u{1F467}.3mf": "family\u{1F468}\u{1F469}\u{1F467}_U1.3mf",
    "my\u200bmodel.3mf": "mymodel_U1.3mf",
    "nbsp\u00a0x.3mf": "nbsp x_U1.3mf",
    [`x${"\u{1F600}".repeat(90)}.3mf`]: `x${"\u{1F600}".repeat(49)}_U1.3mf`,
    [`${"\u6f22".repeat(150)}.3mf`]: `${"\u6f22".repeat(66)}_U1.3mf`,
  };
  await page.setInputFiles("#file", zipFile("names.zip", Object.fromEntries(Object.keys(names).map((name) => [name, sample]))));
  await expect(page.locator(".converted button.show")).toHaveCount(Object.keys(names).length, { timeout: 30_000 });
  await expect(page.locator(".converted.unsaved")).toHaveCount(0);
  for (const saved of Object.values(names)) await session.savedFile(saved);
  expect(savedNames(session).sort()).toEqual(Object.values(names).sort());
  expect((await page.locator(".converted strong").allTextContents()).sort()).toEqual(Object.values(names).sort());
});

test("two files with one name in a zip are both saved, and each result names the file the browser wrote", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", zipFile("variants.zip", { "a/same.3mf": fixture(SAMPLE), "b/same.3mf": fixture(SAMPLE) }));
  await expect(page.locator(".converted button.show")).toHaveCount(2);
  await session.savedFile("same_U1.3mf");
  await session.savedFile("same_U1 (1).3mf");
  await expect(page.locator(".converted strong")).toHaveText(["same_U1.3mf", "same_U1 (1).3mf"]);
});

test("a save the browser stops says the file wasn't saved, instead of saying it was", async () => {
  const page = await session.open("convert.html");
  // A downloads folder that can't be written to: the browser starts the save, then stops it.
  chmodSync(session.downloads, 0o555);
  try {
    await page.setInputFiles("#file", fixturePath(SAMPLE));
    await expect(page.locator(".converted.unsaved .saved")).toContainText("This file wasn't saved", { timeout: 15_000 });
    await expect(page.locator(".converted .saved")).not.toContainText("Saved to your downloads");
    await expect(page.locator(".converted button.show")).toHaveCount(0);
  } finally {
    chmodSync(session.downloads, 0o755);
  }
});

test("a name that could turn itself around on screen is shown without the marks that do it", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", { name: "report\u202efdp.3mf", mimeType: "text/plain", buffer: Buffer.from("not a 3MF") });
  await expect(page.locator(".failed strong")).toHaveText("reportfdp.3mf");
});

test("a conversion names each step as it goes, then clears the line", async () => {
  const page = await session.open("convert.html");
  await expect(page.locator("#options-version")).toContainText("Snapmaker Orca");
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { steps: string[] }).steps = seen;
    new MutationObserver(() => seen.push(document.querySelector("#status")?.textContent ?? "")).observe(document.querySelector("#status")!, { childList: true, characterData: true, subtree: true });
  });
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".converted strong")).toBeVisible();
  const steps = await page.evaluate(() => (window as unknown as { steps: string[] }).steps);
  const text = steps.join("\n");
  for (const step of ["Reading ", "Opening the project", "Matching the profile", "Loading the profile", "Merging the settings", "Writing the file"]) expect(text, step).toContain(step);
  // In the order a conversion does them.
  expect(text.indexOf("Opening the project")).toBeLessThan(text.indexOf("Matching the profile"));
  expect(text.indexOf("Matching the profile")).toBeLessThan(text.indexOf("Writing the file"));
  await expect(page.locator("#status")).toBeEmpty();
});

test("a zip says which file of how many it is on", async () => {
  const page = await session.open("convert.html");
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { steps: string[] }).steps = seen;
    new MutationObserver(() => seen.push(document.querySelector("#status")?.textContent ?? "")).observe(document.querySelector("#status")!, { childList: true, characterData: true, subtree: true });
  });
  await page.setInputFiles("#file", zipFile("two.zip", { "a/one.3mf": fixture(SAMPLE), "b/two.3mf": fixture(SAMPLE) }));
  await expect(page.locator(".converted")).toHaveCount(2);
  const text = (await page.evaluate(() => (window as unknown as { steps: string[] }).steps)).join("\n");
  expect(text).toContain("Looking inside the file");
  expect(text).toContain("File 1 of 2 · Writing the file");
  expect(text).toContain("File 2 of 2 · Writing the file");
});

test("Clear empties the results without a reload, keeps the saved files, and the next file still shows", async () => {
  const page = await session.open("convert.html");
  await expect(page.locator("#results-section")).toBeHidden();
  await page.setInputFiles("#file", [{ name: SAMPLE, mimeType: "model/3mf", buffer: fixture(SAMPLE) }, { name: "not-a-3mf.3mf", mimeType: "text/plain", buffer: Buffer.from("nothing") }]);
  await expect(page.locator(".converted")).toHaveCount(1);
  await expect(page.locator(".failed")).toHaveCount(1);
  await session.savedFile(SAMPLE.replace(/\.3mf$/, "_U1.3mf"));
  await page.locator("#clear-results").click();
  await expect(page.locator("#results-section")).toBeHidden();
  await expect(page.locator("#open-tip")).toBeHidden();
  await expect(page.locator("#results li")).toHaveCount(0);
  expect(savedNames(session)).toEqual([SAMPLE.replace(/\.3mf$/, "_U1.3mf")]);

  await page.setInputFiles("#file", fixturePath("elegoo-slicer-1.5.3.5-scene.3mf"));
  await expect(page.locator(".converted strong")).toHaveText("elegoo-slicer-1.5.3.5-scene_U1.3mf");
  await expect(page.locator("#results-section")).toBeVisible();
  await expect(page.locator("#open-tip")).toBeVisible();
});

test("after saving: show in folder, and the warning about how to open the file", async () => {
  const page = await session.open("convert.html");
  await expect(page.locator("#open-tip")).toBeHidden();
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator("button.show")).toBeVisible();
  await expect(page.locator("#open-tip")).toContainText("Open as project");
});

test("the extension's own save gets no offer", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await session.savedFile(SAMPLE.replace(/\.3mf$/, "_U1.3mf"));
  await page.waitForTimeout(1000);
  expect(await session.pendingCount()).toBe(0);
  expect(session.context.pages().filter((p) => p.url().includes("view=window"))).toEqual([]);
});

test("a file already set up for the U1 says so, and nothing else", async () => {
  const page = await session.open("convert.html");
  const once = await convert(fixture(SAMPLE), { profiles: bundledProfileSource() });
  await page.setInputFiles("#file", { name: "already_U1.3mf", mimeType: "model/3mf", buffer: Buffer.from(once.output) });
  // The first thing under the name, above where it was saved, so nobody thinks nothing happened.
  await expect(page.locator(".converted > *").nth(1)).toHaveClass("already");
  await expect(page.locator(".converted .already")).toContainText("already set up for the Snapmaker U1");
  await expect(page.locator(".converted > *").nth(2)).toHaveClass("saved");
  // No note about "the creator" for the U1 layout the file already has.
  await expect(page.locator(".converted .notes li")).toHaveCount(0);
});

test("a file dropped anywhere on the page converts, and the page stays", async () => {
  const page = await session.open("convert.html");
  const base64 = fixture(SAMPLE).toString("base64");
  const url = page.url();
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "dropped.3mf"));
    document.querySelector("h1")!.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, base64);
  await expect(page.locator(".converted strong")).toHaveText("dropped_U1.3mf");
  expect(page.url()).toBe(url);
});

test("every filament is listed as the file has it, in order, with what each is named now", async () => {
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await page.selectOption("#filament-names", "snapmaker");
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  const library = await convert(fixture(SAMPLE), { profiles: bundledProfileSource(), filamentComplianceMode: "snapmaker" });
  const rows = page.locator(".converted .filaments li");
  await expect(rows).toHaveCount(library.report.filaments.length);
  for (const [index, filament] of library.report.filaments.entries()) {
    const row = rows.nth(index);
    await expect(row.locator(".slot")).toHaveText(String(filament.slot));
    await expect(row.locator(".fname")).toHaveText(filament.outputName);
    if (filament.outputName !== filament.sourceName) await expect(row.locator(".was")).toHaveText(`was ${filament.sourceName}`);
  }
  // The scene's four filaments, renamed but kept in order: nothing dropped or merged.
  expect(library.report.filaments.map((filament) => filament.slot)).toEqual([1, 2, 3, 4]);
});

test("the filament rows hold together at every desktop size and font, with a type and names far too long for a row", async () => {
  const project = longNamesProject();
  const library = await convert(project, { profiles: bundledProfileSource(), filamentComplianceMode: "snapmaker" });
  expect(library.report.filaments[0]).toMatchObject({ type: "T".repeat(300), outputName: "N".repeat(400) });
  expect(library.report.filaments[1]).toMatchObject({ outputName: "Snapmaker PLA SnapSpeed @U1", sourceName: "W".repeat(400) });
  const page = await session.open("convert.html?view=window");
  await page.locator("summary").click();
  await page.selectOption("#filament-names", "snapmaker");
  await page.setInputFiles("#file", { name: "long.3mf", mimeType: "model/3mf", buffer: project });
  await expect(page.locator(".converted strong")).toHaveText("long_U1.3mf");
  await expect(page.locator(".converted .filaments li .was")).toHaveCount(3);
  for (const layout of LAYOUTS) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.evaluate((size) => (document.documentElement.style.fontSize = size), layout.rootFont);
    const rows = await page.evaluate<FilamentRows>(FILAMENT_ROWS);
    expect(rows.problems, layout.name).toEqual([]);
    // Filament 2's "was" can never fit beside its name, so the check above has a wrapped one to look at, at every size.
    expect(rows.wrapped, layout.name).toContain(2);
  }
});

test("a project with more filaments than toolheads says first what its plates need, under a heading of its own, and the long notes fit at every desktop size and font", async () => {
  const project = plateNotesProject();
  const library = await convert(project, { profiles: bundledProfileSource() });
  expect(library.report.notes.map((note) => note.topic)).toEqual(["plate-filaments", "plate-filaments", "plates"]);
  const page = await session.open("convert.html?view=window");
  await page.setViewportSize({ width: LAYOUTS[0].width, height: LAYOUTS[0].height });
  await page.setInputFiles("#file", { name: "plates.3mf", mimeType: "model/3mf", buffer: project });
  await expect(page.locator(".converted strong")).toHaveText("plates_U1.3mf");
  expect(await page.locator(".converted .notes li").allTextContents()).toEqual(library.report.notes.map((note) => note.text));
  await expect(page.locator(".converted .notes h3")).toHaveText(["Filaments per plate", "Plates"]);
  expect(await page.locator(".converted .notes ul").evaluateAll((lists) => lists.map((list) => list.children.length))).toEqual([2, 1]);
  // What to check before printing is in sight in the small window, with seventeen filaments listed below it.
  await expect(page.locator(".converted .notes li").first()).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".converted .filaments li")).toHaveCount(17);
  for (const layout of LAYOUTS) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.evaluate((size) => (document.documentElement.style.fontSize = size), layout.rootFont);
    expect((await page.evaluate<FilamentRows>(FILAMENT_ROWS)).problems, layout.name).toEqual([]);
  }
  // The check does see the notes: one that couldn't wrap widens its card, and the page with it.
  await page.addStyleTag({ content: ".notes li { white-space: nowrap; }" });
  expect((await page.evaluate<FilamentRows>(FILAMENT_ROWS)).problems.join(" ")).toContain("the page scrolls sideways");
});

test("the Snapmaker option says, in the library's words, which filaments now use a preset's own settings; Original says nothing of it", async () => {
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await expect(page.locator("#filament-names ~ .help")).toHaveText(FILAMENT_HELP);
  await page.selectOption("#filament-names", "snapmaker");
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  const output = SAMPLE.replace(/\.3mf$/, "_U1.3mf");
  await expect(page.locator(".converted strong")).toHaveText(output);
  const snapmaker = await convert(fixture(SAMPLE), { profiles: bundledProfileSource(), filamentComplianceMode: "snapmaker" });
  expect(await page.locator(".converted .notes li").allTextContents()).toEqual(snapmaker.report.notes.map((note) => note.text));
  await expect(page.locator(".converted .notes h3")).toHaveText(["Filament presets"]);
  await expect(page.locator(".converted .notes")).toContainText("Filaments 3 and 4 use Snapmaker PLA SnapSpeed @U1's own settings instead of the creator's: nozzle temperature 225 °C → 220 °C");
  expect(sha256(await session.savedFile(output))).toBe(sha256(snapmaker.output));

  await page.locator("#clear-results").click();
  await page.selectOption("#filament-names", "original");
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  // The same name is taken now, so the browser numbers the second copy, and the result names it as saved.
  await expect(page.locator(".converted strong")).toHaveText(output.replace(/\.3mf$/, " (1).3mf"));
  await expect(page.locator(".converted button.show")).toBeVisible();
  const original = await convert(fixture(SAMPLE), { profiles: bundledProfileSource() });
  expect(original.report.notes).toEqual([]);
  await expect(page.locator(".converted .notes")).toHaveCount(0);
});

test("a PrusaSlicer scene keeps all four filaments in order with their colors, and shows the library's notes", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", fixturePath("prusaslicer-2.9.6-scene.3mf"));
  const library = await convert(fixture("prusaslicer-2.9.6-scene.3mf"), { profiles: bundledProfileSource(), highFlowHotends: false, hardenedNozzles: false });
  const rows = page.locator(".converted .filaments li");
  await expect(rows).toHaveCount(4);
  expect(library.report.filaments.map((filament) => filament.slot)).toEqual([1, 2, 3, 4]);
  // PrusaSlicer shows the extruder colors, and so does the list: black, blue, green, red, in that order.
  expect(library.report.filaments.map((filament) => filament.color)).toEqual(["#000000", "#0000FF", "#21FF06", "#FB0207"]);
  for (const [index, filament] of library.report.filaments.entries()) {
    const row = rows.nth(index);
    await expect(row.locator(".slot")).toHaveText(String(filament.slot));
    const [red, green, blue] = [1, 3, 5].map((at) => parseInt(filament.color.slice(at, at + 2), 16));
    await expect(row.locator(".swatch")).toHaveCSS("background-color", `rgb(${red}, ${green}, ${blue})`);
  }
  // The library's own notes: the extruder colors used, and the color change that became a pause. Nothing implies a limit on colors.
  const notes = page.locator(".converted .notes li");
  await expect(notes.filter({ hasText: "extruder colors" })).toHaveCount(1);
  await expect(notes.filter({ hasText: "become pauses" })).toHaveCount(1);
  // In the library's order, as it writes them, under the one topic they share.
  expect(await notes.allTextContents()).toEqual(library.report.notes.map((note) => note.text));
  await expect(page.locator(".converted .notes h3")).toHaveText(["From the file"]);
  await expect(page.locator(".converted")).not.toContainText(/limit|only four|at most four/i);
  expect(savedNames(session)).toEqual(["prusaslicer-2.9.6-scene_U1.3mf"]);
});

test("a PrusaSlicer file is compared with its preset from the extension's own copy of the data, and a Bambu Studio file loads none", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", fixturePath("prusaslicer-2.9.6.3mf"));
  await expect(page.locator(".converted strong")).toHaveText("prusaslicer-2.9.6_U1.3mf");
  // The preset bundle for the release that saved the project, read from the extension's files and nowhere else.
  expect(session.requests).toContain(`${session.origin}/profiles/sources/prusaslicer/PrusaResearch-2.9.6.json`);
  expectOnlyThese(session.requests, session.origin);
  const notes = page.locator(".converted .notes li");
  await expect(notes.filter({ hasText: "compared with PrusaSlicer's" })).toHaveCount(1);
  await expect(notes.filter({ hasText: "isn't in Prusa Research's presets" })).toHaveCount(0);

  const before = session.requests.length;
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".converted strong")).toHaveText(["prusaslicer-2.9.6_U1.3mf", SAMPLE.replace(/\.3mf$/, "_U1.3mf")]);
  expect(session.requests.slice(before).filter((url) => url.includes("/profiles/sources/"))).toEqual([]);
});

test("a PrusaSlicer project on several beds converts, and the library's note about plates shows with the others", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", fixturePath("prusaslicer-2.9.6-beds.3mf"));
  await expect(page.locator(".converted strong")).toHaveText("prusaslicer-2.9.6-beds_U1.3mf");
  await expect(page.locator(".converted .filaments li")).toHaveCount(4);
  await expect(page.locator(".converted .notes li").filter({ hasText: "4 beds become 4 plates" })).toHaveCount(1);
});

/** Waits until the stored settings have the nozzle size chosen, so a conversion started next reads it. */
const storedNozzle = () => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { convert?: { nozzle?: string } } | undefined)?.convert?.nozzle);

async function chooseNozzle(page: Awaited<ReturnType<Session["open"]>>, size: string): Promise<void> {
  await page.locator("summary").click();
  await page.selectOption("#nozzle-size", size);
  await expect.poll(storedNozzle).toBe(size);
}

/** The version note the library writes into a converted file. */
const stampOf = (file: Uint8Array) => JSON.parse(strFromU8(unzipSync(file)["Metadata/any2orca.json"]!)) as { profileId: string; options: { nozzle?: { choice: string; size: string } } };

test("a match that wasn't plain says why among the notes, once, and a plain one says nothing", async () => {
  const entries = unzipSync(fixture(SAMPLE));
  const settings = JSON.parse(strFromU8(entries["Metadata/project_settings.config"]!)) as Record<string, unknown>;
  // A 0.5 mm nozzle has no U1 profile: the file is made for 0.4 mm nozzles, and the report says so.
  entries["Metadata/project_settings.config"] = strToU8(JSON.stringify({ ...settings, nozzle_diameter: ["0.5"] }));
  const variant = Buffer.from(zipSync(entries));
  const library = await convert(variant, { profiles: bundledProfileSource() });
  expect(library.report.profileNotes.length).toBeGreaterThan(0);

  const page = await session.open("convert.html");
  await page.setInputFiles("#file", { name: "half-mm.3mf", mimeType: "model/3mf", buffer: variant });
  await expect(page.locator(".converted .saved")).toContainText("for 0.4 mm nozzles");
  await expect(page.locator(".converted .notes li").filter({ hasText: "set up for a 0.5 mm nozzle; converted for your 0.4 mm nozzles" })).toHaveCount(1);
  await expect(page.locator(".converted").getByText("converted for your 0.4 mm nozzles (choose 0.5 mm")).toHaveCount(1);

  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".converted")).toHaveCount(2);
  await expect(page.locator(".converted").nth(1).locator(".notes")).toHaveCount(0);
});

test("with Match the file, a size with no U1 profile still gets the 0.4 mm one, and says why", async () => {
  const entries = unzipSync(fixture(SAMPLE));
  const settings = JSON.parse(strFromU8(entries["Metadata/project_settings.config"]!)) as Record<string, unknown>;
  entries["Metadata/project_settings.config"] = strToU8(JSON.stringify({ ...settings, nozzle_diameter: ["0.5"] }));
  const variant = Buffer.from(zipSync(entries));
  const library = await convert(variant, { profiles: bundledProfileSource(), nozzle: "match" });

  const page = await session.open("convert.html");
  await chooseNozzle(page, "match");
  await page.setInputFiles("#file", { name: "half-mm.3mf", mimeType: "model/3mf", buffer: variant });
  expect(library.report.profileNotes.length).toBeGreaterThan(0);
  await expect(page.locator(".converted .notes li").filter({ hasText: "0.5 mm nozzle, which has no U1 profile" })).toHaveCount(1);
  expect(sha256(await session.savedFile("half-mm_U1.3mf"))).toBe(sha256(library.output));
});

test("a filament color that isn't a plain hex color is never put into the page's styles", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  const styles = await page.locator(".converted .swatch").evaluateAll((swatches) => swatches.map((s) => (s as HTMLElement).style.cssText));
  for (const style of styles) expect(style === "" || /^background-color: rgb\(\d+, \d+, \d+\);$/.test(style), style).toBe(true);
});

function nozzleVariant(nozzle: string, layer: string, tier: string): Buffer {
  const entries = unzipSync(fixture(SAMPLE));
  const settings = JSON.parse(strFromU8(entries["Metadata/project_settings.config"]!)) as Record<string, unknown>;
  entries["Metadata/project_settings.config"] = strToU8(JSON.stringify({ ...settings, nozzle_diameter: [nozzle], layer_height: layer, print_settings_id: tier }));
  return Buffer.from(zipSync(entries));
}

test("high-flow reaches a 0.4 file, is named on the result, and gives the same bytes as the library", async () => {
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await page.locator("#orca-version option").first().waitFor({ state: "attached" });
  await page.check("#high-flow-1");
  await page.check("#hardened");
  await expect.poll(() => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { convert?: { hardenedNozzles?: boolean } } | undefined)?.convert?.hardenedNozzles)).toBe(true);
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".converted .saved")).toContainText("high-flow on T1, hardened steel nozzles");
  const library = await convert(fixture(SAMPLE), { profiles: bundledProfileSource(), highFlowHotends: [true, false, false, false], hardenedNozzles: true });
  expect(sha256(await session.savedFile(SAMPLE.replace(/\.3mf$/, "_U1.3mf")))).toBe(sha256(library.output));
});

test("a 0.6 mm project is made for 0.4 mm nozzles by default, so high-flow and hardened nozzles apply to it", async () => {
  const variant = nozzleVariant("0.6", "0.3", "0.30mm Standard @BBL X1C 0.6 nozzle");
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await page.locator("#orca-version option").first().waitFor({ state: "attached" });
  await page.check("#high-flow-1");
  await page.check("#hardened");
  await expect.poll(() => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { convert?: { hardenedNozzles?: boolean } } | undefined)?.convert?.hardenedNozzles)).toBe(true);
  await page.setInputFiles("#file", { name: "six.3mf", mimeType: "model/3mf", buffer: variant });
  await expect(page.locator(".converted .saved")).toContainText("for 0.4 mm nozzles");
  await expect(page.locator(".converted .saved")).toContainText("high-flow on T1, hardened steel nozzles");
  await expect(page.locator(".converted .notes li").filter({ hasText: "set up for a 0.6 mm nozzle; converted for your 0.4 mm nozzles" })).toHaveCount(1);
  const library = await convert(variant, { profiles: bundledProfileSource(), highFlowHotends: [true, false, false, false], hardenedNozzles: true });
  expect(sha256(await session.savedFile("six_U1.3mf"))).toBe(sha256(library.output));
});

test("with Match the file, a 0.6 mm project stays 0.6: high-flow isn't sent, no warning, and the result doesn't claim it", async () => {
  const variant = nozzleVariant("0.6", "0.3", "0.30mm Standard @BBL X1C 0.6 nozzle");
  const page = await session.open("convert.html");
  await chooseNozzle(page, "match");
  await page.check("#high-flow-1");
  await page.check("#hardened");
  await expect.poll(() => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { convert?: { hardenedNozzles?: boolean } } | undefined)?.convert?.hardenedNozzles)).toBe(true);
  await page.setInputFiles("#file", { name: "six.3mf", mimeType: "model/3mf", buffer: variant });
  await expect(page.locator(".converted .saved")).toContainText("0.30mm Standard, for 0.6 mm nozzles");
  await expect(page.locator(".converted .saved")).not.toContainText("high-flow");
  await expect(page.locator(".converted .saved")).not.toContainText("hardened");
  await expect(page.locator(".converted .notes")).toHaveCount(0);
  const library = await convert(variant, { profiles: bundledProfileSource(), nozzle: "match", highFlowHotends: false, hardenedNozzles: true });
  expect(sha256(await session.savedFile("six_U1.3mf"))).toBe(sha256(library.output));
});

test("a 0.4 mm project with 0.6 mm chosen is made for 0.6 mm nozzles, says so, and gets no high-flow", async () => {
  const page = await session.open("convert.html");
  await chooseNozzle(page, "0.6");
  await expect(page.locator("#options-version")).toContainText("and 0.6 mm nozzles");
  await page.check("#high-flow-1");
  await expect.poll(() => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { convert?: { highFlowToolheads?: boolean[] } } | undefined)?.convert?.highFlowToolheads?.[0])).toBe(true);
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".converted .saved")).toContainText(/using 0\.\d+mm [A-Za-z ]+, for 0\.6 mm nozzles and Snapmaker Orca \d/);
  // The profile is matched for 0.6 mm before converting, so high-flow, which the 0.4 mm profiles have, isn't sent.
  await expect(page.locator(".converted .saved")).not.toContainText("high-flow");
  await expect(page.locator(".converted").getByText("converted for your 0.6 mm nozzles").first()).toBeVisible();

  const saved = await session.savedFile(SAMPLE.replace(/\.3mf$/, "_U1.3mf"));
  const stamp = stampOf(saved);
  expect(stamp.options.nozzle).toEqual({ choice: "0.6", size: "0.6" });
  expect(stamp.profileId).toMatch(/^snapmaker-u1-0\.6-/);
  const settings = JSON.parse(strFromU8(unzipSync(saved)["Metadata/project_settings.config"]!)) as { print_settings_id: string; nozzle_diameter: string[] };
  expect(settings.print_settings_id).toContain("(0.6 nozzle)");
  expect(settings.nozzle_diameter).toEqual(["0.6", "0.6", "0.6", "0.6"]);
  const library = await convert(fixture(SAMPLE), { profiles: bundledProfileSource(), nozzle: "0.6", highFlowHotends: false });
  expect(sha256(saved)).toBe(sha256(library.output));
});

test("the default is 0.4 mm, recorded in the file", async () => {
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await expect(page.locator("#nozzle-size")).toHaveValue("0.4");
  await expect(page.locator("#options-version")).toContainText("and 0.4 mm nozzles");
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  const stamp = stampOf(await session.savedFile(SAMPLE.replace(/\.3mf$/, "_U1.3mf")));
  expect(stamp.options.nozzle).toEqual({ choice: "0.4", size: "0.4" });
});

test("a nozzle size stored wrongly reads as 0.4 mm, and the file is made for 0.4 mm", async () => {
  await setSettings(session, { convert: { nozzle: "0.5" } });
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await expect(page.locator("#nozzle-size")).toHaveValue("0.4");
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".converted .saved")).toContainText("for 0.4 mm nozzles");
  expect(stampOf(await session.savedFile(SAMPLE.replace(/\.3mf$/, "_U1.3mf"))).options.nozzle).toEqual({ choice: "0.4", size: "0.4" });
});

test("the settings page has the nozzle size before the high-flow toolheads, with its help, and keeps a choice", async () => {
  const page = await session.open("settings.html");
  const select = page.locator("#nozzle-size");
  await expect(select).toHaveValue("0.4");
  await expect(select.locator("option")).toHaveText(["0.2 mm", "0.4 mm", "0.6 mm", "0.8 mm", "Match the file"]);
  await expect(page.locator("label[for=nozzle-size]")).toHaveText("Your U1's nozzle size");
  const field = page.locator(".field").filter({ has: select });
  await expect(field.locator(".help")).toHaveText(NOZZLE_HELP);
  await expect(field.locator("+ .field .label")).toHaveText("High-flow toolheads");
  await page.selectOption("#nozzle-size", "0.8");
  await expect.poll(storedNozzle).toBe("0.8");
  await page.reload();
  await expect(page.locator("#nozzle-size")).toHaveValue("0.8");
  const convertPage = await session.open("convert.html");
  await expect(convertPage.locator("#options-version")).toContainText("and 0.8 mm nozzles");
  await page.selectOption("#nozzle-size", "match");
  await expect.poll(storedNozzle).toBe("match");
  await expect(convertPage.locator("#options-version")).toContainText("and the file's nozzle size");
});

/** An extension page's clipboard can't be granted to a test, so this records what's written and lets the real write run. */
async function openWithClipboardSpy(path: string) {
  const page = await session.context.newPage();
  await page.addInitScript(() => {
    const spy = window as unknown as { written: string[] };
    spy.written = [];
    const real = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (text: string) => {
      spy.written.push(text);
      return real(text);
    };
  });
  await page.goto(`${session.origin}/${path}`);
  return page;
}
const written = (page: Awaited<ReturnType<typeof openWithClipboardSpy>>) => page.evaluate(() => (window as unknown as { written: string[] }).written);

test("a failure offers a report that names no file or address, and copies it", async () => {
  const page = await openWithClipboardSpy("convert.html");
  const other = superSlicerProject();
  await page.setInputFiles("#file", { name: "secret-model-name.3mf", mimeType: "model/3mf", buffer: other });
  const text = page.locator(".failed .report-text pre");
  await expect(page.locator(".failed strong")).toHaveText("secret-model-name.3mf");
  await page.locator(".failed .report-text summary").click();
  await expect(text).toContainText("Error: unsupported_slicer (SuperSlicer)");
  await expect(text).toContainText(`File size: ${other.byteLength} bytes`);
  await expect(text).toContainText("Browser: Chrome");
  await expect(text).toContainText(`any2orca ${libraryVersion}`);
  const shown = (await text.textContent()) ?? "";
  expect(shown).not.toContain("secret-model-name");
  expect(shown).not.toMatch(/\.3mf|https?:|SuperSlicer 2/i);
  expect(shown).not.toContain("Site:");

  await page.locator(".failed button.copy-report").click();
  await expect(page.locator(".failed button.copy-report")).toHaveText("Copied");
  expect(await written(page)).toEqual([shown]);
});

test("the settings page copies the versions, and says what a download manager does", async () => {
  const page = await openWithClipboardSpy("settings.html");
  await expect(page.locator("main")).toContainText("download manager that takes over your downloads");
  await page.locator("#diagnostics .copy-report").click();
  await expect(page.locator("#diagnostics .copy-report")).toHaveText("Copied");
  const [copied] = await written(page);
  expect(copied).toMatch(/^any2u1 diagnostics\nBrowser: Chrome \d+\nany2u1 0\.1\.0, any2orca \d+\.\d+\.\d+$/);
  // The settings page, like the others, asks for nothing but the extension's own files.
  expectOnlyThese(session.requests, session.origin);
});

/**
 * A driver can't answer the browser's own Save dialog, so this records what the page asks the download API for, and
 * saves without the dialog (or fails the way Firefox does when its dialog is canceled). The dialog itself is a hand check.
 */
async function openWithDownloadSpy(path: string, cancel = false) {
  const page = await session.context.newPage();
  await page.addInitScript((cancelIt) => {
    const spy = window as unknown as { asked: unknown[] };
    spy.asked = [];
    const downloads = chrome.downloads;
    const real = downloads.download.bind(downloads);
    downloads.download = ((options: chrome.downloads.DownloadOptions) => {
      spy.asked.push(options.saveAs);
      return cancelIt ? Promise.reject(new Error("Download canceled by the user")) : real({ ...options, saveAs: false });
    }) as typeof downloads.download;
  }, cancel);
  await page.goto(`${session.origin}/${path}`);
  return page;
}
const asked = (page: Awaited<ReturnType<typeof openWithDownloadSpy>>) => page.evaluate(() => (window as unknown as { asked: unknown[] }).asked);

test("by default the file is saved with no dialog", async () => {
  const page = await openWithDownloadSpy("convert.html");
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".converted .saved .show")).toBeVisible();
  await expect(page.locator(".converted .saved")).toContainText("Saved to your downloads");
  expect(await asked(page)).toEqual([false]);
});

test("with Ask where to save on, the browser is asked for its Save dialog, and the result says so", async () => {
  await setSettings(session, { askWhereToSave: true });
  const page = await openWithDownloadSpy("convert.html");
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".converted .saved .show")).toBeVisible();
  await expect(page.locator(".converted .saved")).toContainText("Saved where you chose");
  expect(await asked(page)).toEqual([true]);
  expect(savedNames(session)).toContain(SAMPLE.replace(/\.3mf$/, "_U1.3mf"));
});

test("a canceled Save dialog says the file wasn't saved, calmly", async () => {
  await setSettings(session, { askWhereToSave: true });
  const page = await openWithDownloadSpy("convert.html", true);
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".converted .saved")).toHaveText("This file wasn't saved: the save was canceled. Convert it again to save it.");
  await expect(page.locator(".converted")).toHaveClass(/unsaved/);
});

test("the settings page switches Ask where to save on and off", async () => {
  const page = await session.open("settings.html");
  // The page shows the stored settings a moment after it loads; a click before that could be drawn over.
  await expect(page.locator("#orca-version")).toBeVisible();
  const box = page.locator("#ask-where");
  await expect(box).not.toBeChecked();
  await box.check();
  await expect.poll(() => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { askWhereToSave?: boolean } | undefined)?.askWhereToSave)).toBe(true);
  await box.uncheck();
  await expect.poll(() => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { askWhereToSave?: boolean } | undefined)?.askWhereToSave)).toBe(false);
});
