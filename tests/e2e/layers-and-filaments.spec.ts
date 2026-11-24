// SPDX-License-Identifier: AGPL-3.0-or-later
/** The library's note about layers outside the nozzle's profiles, the Layer height option, and Polymaker among the Filament choices. */
import { convert, loadCatalog } from "any2orca";
import { bundledProfileSource } from "any2orca/node";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { FILAMENT_CHOICES, FILAMENT_HELP, KEEP_LAYERS, LAYER_HEIGHT_HELP, LAYER_HEIGHT_MATCH_HELP, layerHeightsBySize, layerHeightText } from "../../src/core/settings";
import { FILAMENT_ROWS, LAYOUTS, textContrast, type FilamentRows, type TextContrast } from "../shared/layout";
import { expectOnlyThese, fixture, launch, POLYMAKER, setSettings, sha256, thinLayersProject, type Session } from "./helpers";

let session: Session;
test.beforeEach(async () => {
  session = await launch();
});
test.afterEach(async () => {
  await session.close();
});

type StoredConvert = { snapmakerOrcaVersion?: string | null; nozzle?: string; layerHeight?: number | null; filamentNames?: string };
const stored = () => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { convert?: StoredConvert } | undefined)?.convert);
const settingsOf = (file: Uint8Array) => JSON.parse(strFromU8(unzipSync(file)["Metadata/project_settings.config"]!)) as { layer_height: string; print_settings_id: string; filament_settings_id: string[] };
const stampOf = (file: Uint8Array) => JSON.parse(strFromU8(unzipSync(file)["Metadata/any2orca.json"]!)) as { options: { layerHeight?: number; filamentComplianceMode?: string | null } };
const optionTexts = (page: Page, select: string) => page.locator(`${select} option`).allTextContents();
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** A project and the nozzle size it's made for, each with layers below what that size's U1 profiles use. */
const THIN_LAYERS = [
  { title: "a height range that sets 0.1 mm layers, made for 0.6 mm nozzles", project: () => thinLayersProject(), nozzle: "0.6", starts: "The project has layers as thin as 0.1 mm, below the 0.12 to 0.42 mm that Snapmaker's U1 profiles use for the 0.6 mm nozzle.", names: null },
  { title: "variable layer heights on a named object, made for 0.4 mm nozzles", project: () => fixture("prusaslicer-2.9.6-scene.3mf"), nozzle: "0.4", starts: "The project has layers as thin as 0.07 mm, below the 0.08 to 0.32 mm that Snapmaker's U1 profiles use for the 0.4 mm nozzle.", names: "Shape-Sphere" },
] as const;

for (const { title, project, nozzle, starts, names } of THIN_LAYERS) {
  test(`layers thinner than the nozzle's profiles use (${title}): the library's file, and its note under a heading of its own, whole in the small window, read in light and dark`, async () => {
    const bytes = project();
    const library = await convert(bytes, { profiles: bundledProfileSource(), nozzle });
    const note = library.report.notes.filter((each) => each.topic === "layers");
    expect(note).toHaveLength(1);
    expect(note[0]!.text.startsWith(starts)).toBe(true);
    expect(note[0]!.text).toContain("Layers this thin can be deliberate, as in filament paintings.");
    if (names !== null) expect(note[0]!.text).toContain(`The creator made the layer height vary on ${names} (variable layer heights)`);

    await setSettings(session, { convert: { nozzle } });
    const page = await session.open("convert.html?view=window");
    await page.setViewportSize({ width: LAYOUTS[0].width, height: LAYOUTS[0].height });
    await page.setInputFiles("#file", { name: "thin-layers.3mf", mimeType: "model/3mf", buffer: bytes });
    await expect(page.locator(".converted strong")).toHaveText("thin-layers_U1.3mf");
    expect(sha256(await session.savedFile("thin-layers_U1.3mf"))).toBe(sha256(library.output));
    expect(await page.locator(".converted .notes li").allTextContents()).toEqual(library.report.notes.map((each) => each.text));
    const heading = page.locator(".converted .notes h3", { hasText: /^Layer height$/ });
    await expect(heading).toHaveCount(1);
    const shown = page.locator(".converted .notes li", { hasText: starts });
    await expect(shown).toHaveText(note[0]!.text);
    await shown.evaluate((element) => element.setAttribute("data-layers", ""));

    const behind: string[] = [];
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      // Its heading and the whole note fit the small window together, with nothing to scroll sideways.
      await heading.scrollIntoViewIfNeeded();
      await expect(heading, colorScheme).toBeInViewport({ ratio: 1 });
      await expect(shown, colorScheme).toBeInViewport({ ratio: 1 });
      expect(await noSidewaysScroll(page), colorScheme).toBe(true);
      const contrast = await page.evaluate<TextContrast>(textContrast("[data-layers]"));
      expect(contrast.ratio, `the layer note in ${colorScheme}: ${contrast.text} on ${contrast.behind}`).toBeGreaterThanOrEqual(4.5);
      behind.push(contrast.behind);
      for (const layout of LAYOUTS) {
        await page.setViewportSize({ width: layout.width, height: layout.height });
        await page.evaluate((size) => (document.documentElement.style.fontSize = size), layout.rootFont);
        expect((await page.evaluate<FilamentRows>(FILAMENT_ROWS)).problems, `${layout.name}, ${colorScheme}`).toEqual([]);
        expect(await noSidewaysScroll(page), `${layout.name}, ${colorScheme}`).toBe(true);
      }
      await page.setViewportSize({ width: LAYOUTS[0].width, height: LAYOUTS[0].height });
      await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    }
    expect(behind[0]).not.toBe(behind[1]);
    expectOnlyThese(session.requests, session.origin);
  });
}

test("the same project made for 0.4 mm nozzles, whose profiles do use 0.1 mm layers, gets no note about layers", async () => {
  const library = await convert(thinLayersProject(), { profiles: bundledProfileSource() });
  expect(library.report.notes.some((each) => each.topic === "layers")).toBe(false);
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", { name: "thin-layers.3mf", mimeType: "model/3mf", buffer: thinLayersProject() });
  await expect(page.locator(".converted strong")).toHaveText("thin-layers_U1.3mf");
  expect(sha256(await session.savedFile("thin-layers_U1.3mf"))).toBe(sha256(library.output));
  await expect(page.locator(".converted .notes h3", { hasText: /^Layer height$/ })).toHaveCount(0);
});

test("the Layer height option comes after the nozzle size, lists that size's profile heights from the catalog, and follows the size", async () => {
  const catalog = await loadCatalog(bundledProfileSource());
  const heights = layerHeightsBySize(catalog.list());
  const page = await session.open("settings.html");
  const select = page.locator("#layer-height");
  await expect(page.locator("label[for=layer-height]")).toHaveText("Layer height");
  await expect(page.locator(".field").filter({ has: page.locator("#nozzle-size") }).locator("+ .field select")).toHaveAttribute("id", "layer-height");
  const field = page.locator(".field").filter({ has: select });
  await expect(field.locator("+ .field .label")).toHaveText("High-flow toolheads");
  await expect(field.locator(".help")).toHaveText(LAYER_HEIGHT_HELP);
  await expect(select).toHaveValue("");

  for (const size of ["0.2", "0.4", "0.6", "0.8"] as const) {
    await page.selectOption("#nozzle-size", size);
    expect(heights[size]!.length, size).toBeGreaterThan(0);
    await expect(page.locator("#layer-height option"), size).toHaveText([KEEP_LAYERS, ...heights[size]!.map(layerHeightText)]);
    await expect(select).toBeEnabled();
  }
  expect(await optionTexts(page, "#layer-height")).toEqual(["Keep the creator's layers", "0.24 mm", "0.32 mm", "0.4 mm"]);

  // A height the next size has too stays chosen; one it doesn't have goes back to the creator's layers, in the page and in storage.
  await page.selectOption("#nozzle-size", "0.6");
  await page.selectOption("#layer-height", "0.24");
  await expect.poll(async () => (await stored())?.layerHeight).toBe(0.24);
  await page.selectOption("#nozzle-size", "0.8");
  await expect(select).toHaveValue("0.24");
  await expect.poll(stored).toMatchObject({ nozzle: "0.8", layerHeight: 0.24 });
  await page.selectOption("#layer-height", "0.4");
  await expect.poll(async () => (await stored())?.layerHeight).toBe(0.4);
  await page.selectOption("#nozzle-size", "0.4");
  await expect(select).toHaveValue("");
  await expect.poll(stored).toMatchObject({ nozzle: "0.4", layerHeight: null });

  // It survives a reload, and the convert page says it beside the nozzle size.
  await page.selectOption("#layer-height", "0.28");
  await expect.poll(async () => (await stored())?.layerHeight).toBe(0.28);
  await page.reload();
  await expect(page.locator("#layer-height")).toHaveValue("0.28");
  const convertPage = await session.open("convert.html");
  await expect(convertPage.locator("#options-version")).toHaveText(/^\(for Snapmaker Orca [\d.]+, 0\.4 mm nozzles and 0\.28 mm layers\)$/);
  await convertPage.locator("summary").click();
  await expect(convertPage.locator("#layer-height")).toHaveValue("0.28");

  // Match the file has no one size, so nothing to choose from, and it says why.
  await page.selectOption("#nozzle-size", "match");
  expect(await optionTexts(page, "#layer-height")).toEqual([KEEP_LAYERS]);
  await expect(page.locator("#layer-height")).toBeDisabled();
  await expect(page.locator(".field").filter({ has: page.locator("#layer-height") }).locator(".help")).toHaveText(LAYER_HEIGHT_MATCH_HELP);
  await expect.poll(stored).toMatchObject({ nozzle: "match", layerHeight: null });
  await expect(convertPage.locator("#options-version")).toHaveText(/^\(for Snapmaker Orca [\d.]+ and the file's nozzle size\)$/);
});

test("another Snapmaker Orca version that has the same height keeps the layer height chosen, and both are saved", async () => {
  const page = await session.open("settings.html");
  await page.selectOption("#nozzle-size", "0.6");
  await page.selectOption("#layer-height", "0.18");
  await page.selectOption("#filament-names", "snapmaker");
  await expect.poll(stored).toMatchObject({ nozzle: "0.6", layerHeight: 0.18, filamentNames: "snapmaker" });
  const versions = await page.locator("#orca-version option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value).filter((value) => value !== ""));
  expect(versions.length).toBeGreaterThan(1);
  for (const version of [versions[1]!, "", versions[0]!]) {
    await page.selectOption("#orca-version", version);
    await expect.poll(stored).toMatchObject({ snapmakerOrcaVersion: version === "" ? null : version, nozzle: "0.6", layerHeight: 0.18, filamentNames: "snapmaker" });
    await expect(page.locator("#layer-height")).toHaveValue("0.18");
    await expect(page.locator("#layer-height option")).toHaveText(["Keep the creator's layers", "0.18 mm", "0.24 mm", "0.3 mm"]);
    await expect(page.locator("#filament-names option[value=polymaker]")).toBeDisabled();
  }
});

test("with a layer height chosen, the file is the library's with that one height, the result and the notes say so, and the creator's range is gone", async () => {
  const project = thinLayersProject();
  const library = await convert(project, { profiles: bundledProfileSource(), nozzle: "0.6", layerHeight: 0.18 });
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await page.selectOption("#nozzle-size", "0.6");
  await page.selectOption("#layer-height", "0.18");
  await expect.poll(stored).toMatchObject({ nozzle: "0.6", layerHeight: 0.18 });
  await expect(page.locator("#options-version")).toHaveText(/^\(for Snapmaker Orca [\d.]+, 0\.6 mm nozzles and 0\.18 mm layers\)$/);
  await page.setInputFiles("#file", { name: "one-height.3mf", mimeType: "model/3mf", buffer: project });
  await expect(page.locator(".converted strong")).toHaveText("one-height_U1.3mf");
  const saved = await session.savedFile("one-height_U1.3mf");
  expect(sha256(saved)).toBe(sha256(library.output));
  expect(settingsOf(saved).layer_height).toBe("0.18");
  expect(stampOf(saved).options.layerHeight).toBe(0.18);
  expect(strFromU8(unzipSync(saved)["Metadata/layer_config_ranges.xml"]!)).not.toContain('opt_key="layer_height"');
  await expect(page.locator(".converted .saved")).toContainText("using 0.18mm Standard, for 0.6 mm nozzles");
  expect(await page.locator(".converted .notes li").allTextContents()).toEqual(library.report.notes.map((each) => each.text));
  await expect(page.locator(".converted .notes li", { hasText: "Every layer is 0.18 mm, as you chose." })).toHaveText(
    "Every layer is 0.18 mm, as you chose. The creator's layer heights set for ranges of an object's height were replaced.",
  );
  await expect(page.locator(".converted .notes li", { hasText: "The project has layers as thin as" })).toHaveCount(0);
  expectOnlyThese(session.requests, session.origin);
});

for (const [what, layerHeight] of [["a height the nozzle size doesn't have", 0.2], ["a height written as text", "0.18"], ["a height below zero", -0.18], ["a height far too large", 400]] as const) {
  test(`a layer height stored wrongly (${what}) keeps the creator's layers: the file converts, as the library's without one, and the wrong value is gone`, async () => {
    await setSettings(session, { convert: { nozzle: "0.6", layerHeight } });
    const page = await session.open("convert.html");
    await page.locator("summary").click();
    await expect(page.locator("#layer-height")).toHaveValue("");
    await expect(page.locator("#options-version")).toHaveText(/^\(for Snapmaker Orca [\d.]+ and 0\.6 mm nozzles\)$/);
    await page.setInputFiles("#file", { name: "kept-layers.3mf", mimeType: "model/3mf", buffer: thinLayersProject() });
    await expect(page.locator(".converted strong")).toHaveText("kept-layers_U1.3mf");
    const library = await convert(thinLayersProject(), { profiles: bundledProfileSource(), nozzle: "0.6" });
    expect(sha256(await session.savedFile("kept-layers_U1.3mf"))).toBe(sha256(library.output));
    await expect.poll(async () => (await stored())?.layerHeight ?? null).toBeNull();
  });
}

test("the Filament option lists Original, Snapmaker, Polymaker and Generic, says what the one chosen does, and Polymaker gives the library's file", async () => {
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await expect(page.locator("#filament-names option")).toHaveText(["Original", "Snapmaker", "Polymaker", "Generic"]);
  await expect(page.locator("#filament-names")).toHaveValue("original");
  const field = page.locator(".field").filter({ has: page.locator("#filament-names") });
  await expect(field.locator(".help").last()).toHaveText(FILAMENT_HELP);
  for (const choice of ["snapmaker", "generic", "original", "polymaker"] as const) {
    await page.selectOption("#filament-names", choice);
    await expect(page.locator("#filament-choice")).toHaveText(FILAMENT_CHOICES[choice].description);
    await expect.poll(async () => (await stored())?.filamentNames).toBe(choice);
  }
  await expect(page.locator("#filament-choice")).toHaveText("Switch PLA to Polymaker presets, with their own settings; other filaments as Snapmaker.");
  await expect(page.locator("#filament-names option[value=polymaker]")).toBeEnabled();
  await expect(page.locator("#polymaker-reason")).toBeHidden();

  const library = await convert(fixture(POLYMAKER), { profiles: bundledProfileSource(), filamentComplianceMode: "polymaker" });
  await page.setInputFiles("#file", { name: "six-filaments.3mf", mimeType: "model/3mf", buffer: fixture(POLYMAKER) });
  await expect(page.locator(".converted strong")).toHaveText("six-filaments_U1.3mf");
  const saved = await session.savedFile("six-filaments_U1.3mf");
  expect(sha256(saved)).toBe(sha256(library.output));
  expect(stampOf(saved).options.filamentComplianceMode).toBe("polymaker");
  const names = settingsOf(saved).filament_settings_id;
  expect([names[0], names[1], names[3]]).toEqual(Array(3).fill("Polymaker General PLA Family @U1"));
  expect(await page.locator(".converted .notes li").allTextContents()).toEqual(library.report.notes.map((each) => each.text));
  await expect(page.locator(".converted .notes li", { hasText: "Polymaker makes no U1 preset" })).toHaveText(
    "Polymaker makes no U1 preset for PETG, ABS and ASA at this nozzle size, so those get the preset the Snapmaker option gives them.",
  );
  expectOnlyThese(session.requests, session.origin);
});

test("Polymaker can't be chosen for a nozzle size it has no presets for, the page says why, and a change to such a size switches it to Snapmaker", async () => {
  const page = await session.open("settings.html");
  const polymaker = page.locator("#filament-names option[value=polymaker]");
  const reason = page.locator("#polymaker-reason");
  await page.selectOption("#filament-names", "polymaker");
  await expect.poll(async () => (await stored())?.filamentNames).toBe("polymaker");
  for (const size of ["0.2", "0.6", "0.8"]) {
    await page.selectOption("#nozzle-size", "0.4");
    await expect(polymaker).toBeEnabled();
    await expect(reason).toBeHidden();
    await page.selectOption("#filament-names", "polymaker");
    await expect.poll(async () => (await stored())?.filamentNames).toBe("polymaker");
    await page.selectOption("#nozzle-size", size);
    await expect(polymaker, size).toBeDisabled();
    await expect(reason, size).toHaveText("Snapmaker Orca has Polymaker presets for the 0.4 mm nozzle only.");
    await expect(page.locator("#filament-names"), size).toHaveValue("snapmaker");
    await expect(page.locator("#filament-choice")).toHaveText(FILAMENT_CHOICES.snapmaker.description);
    await expect.poll(stored).toMatchObject({ nozzle: size, filamentNames: "snapmaker" });
  }
  // Back at 0.4 mm it can be chosen again, and the choice made for it stays Snapmaker until changed.
  await page.selectOption("#nozzle-size", "0.4");
  await expect(polymaker).toBeEnabled();
  await expect(page.locator("#filament-names")).toHaveValue("snapmaker");
  // With Match the file the size isn't known until a file is read, so it stays a choice.
  await page.selectOption("#filament-names", "polymaker");
  await page.selectOption("#nozzle-size", "match");
  await expect(polymaker).toBeEnabled();
  await expect(reason).toBeHidden();
  await expect.poll(stored).toMatchObject({ nozzle: "match", filamentNames: "polymaker" });
});

test("Polymaker stored with a nozzle size it has no presets for reads as Snapmaker, is saved so, and the file is the library's for Snapmaker", async () => {
  await setSettings(session, { convert: { nozzle: "0.6", filamentNames: "polymaker" } });
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await expect(page.locator("#filament-names")).toHaveValue("snapmaker");
  await expect(page.locator("#filament-names option[value=polymaker]")).toBeDisabled();
  await expect(page.locator("#polymaker-reason")).toHaveText("Snapmaker Orca has Polymaker presets for the 0.4 mm nozzle only.");
  await expect.poll(async () => (await stored())?.filamentNames).toBe("snapmaker");
  await page.setInputFiles("#file", { name: "six-filaments.3mf", mimeType: "model/3mf", buffer: fixture(POLYMAKER) });
  await expect(page.locator(".converted strong")).toHaveText("six-filaments_U1.3mf");
  const library = await convert(fixture(POLYMAKER), { profiles: bundledProfileSource(), nozzle: "0.6", filamentComplianceMode: "snapmaker" });
  expect(sha256(await session.savedFile("six-filaments_U1.3mf"))).toBe(sha256(library.output));
});

test("the two new options read in the small window in light and dark, at every desktop size and font, with nothing to scroll sideways", async () => {
  await setSettings(session, { convert: { nozzle: "0.6", filamentNames: "snapmaker" } });
  const page = await session.open("convert.html?view=window");
  await page.locator("summary").click();
  await expect(page.locator("#polymaker-reason")).toBeVisible();
  for (const [index, selector] of ["#layer-height ~ .help", "#filament-choice", "#polymaker-reason"].entries()) await page.locator(selector).first().evaluate((element, mark) => element.setAttribute("data-read", String(mark)), index);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const layout of LAYOUTS) {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), layout.rootFont);
      expect(await noSidewaysScroll(page), `${layout.name}, ${colorScheme}`).toBe(true);
      for (const select of ["#layer-height", "#filament-names"]) {
        const box = await page.locator(select).boundingBox();
        expect(box !== null && box.x >= 0 && box.x + box.width <= layout.width, `${select} within ${layout.name}, ${colorScheme}`).toBe(true);
      }
    }
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    for (const mark of [0, 1, 2]) {
      const contrast = await page.evaluate<TextContrast>(textContrast(`[data-read="${mark}"]`));
      expect(contrast.ratio, `help ${mark} in ${colorScheme}: ${contrast.text} on ${contrast.behind}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
