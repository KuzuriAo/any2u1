// SPDX-License-Identifier: AGPL-3.0-or-later
import { chmodSync } from "node:fs";
import { convert } from "any2orca";
import { bundledProfileSource } from "any2orca/node";
import { expect, test } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { libraryVersion } from "./helpers";
import { expectOnlyThese, fixture, fixturePath, launch, PRUSA_FIXTURES, SAMPLE, savedNames, sha256, superSlicerProject, type Session } from "./helpers";

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
  const versions = await page.locator("#orca-version option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
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

test("a file already set up for the U1 says so", async () => {
  const page = await session.open("convert.html");
  const once = await convert(fixture(SAMPLE), { profiles: bundledProfileSource() });
  await page.setInputFiles("#file", { name: "already_U1.3mf", mimeType: "model/3mf", buffer: Buffer.from(once.output) });
  // The first thing under the name, above where it was saved, so nobody thinks nothing happened.
  await expect(page.locator(".converted > *").nth(1)).toHaveClass("already");
  await expect(page.locator(".converted .already")).toContainText("already set up for the Snapmaker U1");
  await expect(page.locator(".converted > *").nth(2)).toHaveClass("saved");
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
  expect(await notes.allTextContents()).toEqual(library.report.warnings);
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

test("a match that wasn't plain says why under the profile, and a plain one says nothing", async () => {
  const entries = unzipSync(fixture(SAMPLE));
  const settings = JSON.parse(strFromU8(entries["Metadata/project_settings.config"]!)) as Record<string, unknown>;
  // A 0.5 mm nozzle has no U1 profile, so the 0.4 one is used, and the report says why.
  entries["Metadata/project_settings.config"] = strToU8(JSON.stringify({ ...settings, nozzle_diameter: ["0.5"] }));
  const variant = Buffer.from(zipSync(entries));
  const library = await convert(variant, { profiles: bundledProfileSource() });
  expect(library.report.profileNotes.length).toBeGreaterThan(0);

  const page = await session.open("convert.html");
  await page.setInputFiles("#file", { name: "half-mm.3mf", mimeType: "model/3mf", buffer: variant });
  await expect(page.locator(".converted .profile-notes li")).toHaveCount(library.report.profileNotes.length);
  await expect(page.locator(".converted .profile-notes li").first()).toContainText("0.5mm nozzle");

  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".converted")).toHaveCount(2);
  await expect(page.locator(".converted").nth(1).locator(".profile-notes")).toHaveCount(0);
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

test("on a nozzle with no high-flow option, it isn't sent: no warning, and the result doesn't claim it", async () => {
  const variant = nozzleVariant("0.6", "0.3", "0.30mm Standard @BBL X1C 0.6 nozzle");
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await page.locator("#orca-version option").first().waitFor({ state: "attached" });
  await page.check("#high-flow-1");
  await page.check("#hardened");
  await expect.poll(() => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { convert?: { hardenedNozzles?: boolean } } | undefined)?.convert?.hardenedNozzles)).toBe(true);
  await page.setInputFiles("#file", { name: "six.3mf", mimeType: "model/3mf", buffer: variant });
  await expect(page.locator(".converted .saved")).toContainText("0.6 nozzle");
  await expect(page.locator(".converted .saved")).not.toContainText("high-flow");
  await expect(page.locator(".converted .saved")).not.toContainText("hardened");
  await expect(page.locator(".converted .notes")).toHaveCount(0);
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
