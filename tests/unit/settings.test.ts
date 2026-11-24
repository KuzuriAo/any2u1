// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_NOZZLE, FILAMENT_COMPLIANCE_MODES, filamentModeHasPresets, filamentModeNozzleSizes, loadCatalog, NOZZLE_CHOICES } from "any2orca";
import { bundledProfileSource } from "any2orca/node";
import { describe, expect, it } from "vitest";
import {
  convertOptions,
  DEFAULT_NOZZLE_SIZE,
  defaultSettings,
  describePrinter,
  FILAMENT_CHOICES,
  FILAMENT_NAMES,
  isQuiet,
  KEEP_LAYERS,
  LAYER_HEIGHT_HELP,
  layerHeightsBySize,
  layerHeightsFor,
  layerHeightText,
  NOZZLE_HELP,
  NOZZLE_SIZES,
  parseSettings,
  polymakerOffered,
  polymakerReason,
  polymakerSizesFrom,
  settleConvert,
  type OptionChoices,
} from "../../src/core/settings";

describe("parseSettings", () => {
  it("defaults to on, with the small window", () => {
    expect(parseSettings(undefined)).toEqual(defaultSettings());
    expect(defaultSettings()).toMatchObject({ enabled: true, offerStyle: "window" });
  });
  it.each([null, 7, "x", [], { enabled: "yes", offerStyle: "<img>", quietSites: "all", convert: 3 }])("falls back on %j", (stored) => {
    expect(parseSettings(stored)).toEqual(defaultSettings());
  });
  it("keeps what's valid and drops what isn't", () => {
    const parsed = parseSettings({
      enabled: false,
      offerStyle: "badge",
      quietSites: ["a.example", "a.example", 4, "", "x".repeat(300)],
      convert: { snapmakerOrcaVersion: "../../x", nozzle: "0.5", layerHeight: "0.2", highFlowToolheads: [true, false], hardenedNozzles: 1, filamentNames: "other" },
    });
    expect(parsed).toEqual({ ...defaultSettings(), enabled: false, offerStyle: "badge", quietSites: ["a.example"] });
  });
  it("keeps a well-formed choice", () => {
    const convert = { snapmakerOrcaVersion: "2.4.0", nozzle: "0.6", layerHeight: 0.18, highFlowToolheads: [true, false, false, true], hardenedNozzles: true, filamentNames: "snapmaker" };
    expect(parseSettings({ convert }).convert).toEqual(convert);
    for (const filamentNames of FILAMENT_NAMES) expect(parseSettings({ convert: { filamentNames } }).convert.filamentNames).toBe(filamentNames);
  });
  it("bounds the list of sites, keeping the newest", () => {
    const quietSites = Array.from({ length: 2000 }, (_, index) => `s${index}.example`);
    const kept = parseSettings({ quietSites }).quietSites;
    expect(kept.length).toBe(500);
    expect(kept.at(-1)).toBe("s1999.example");
  });
  it("is a fixed point, so what's stored after a change is what's read back", () => {
    const parsed = parseSettings({ quietSites: ["a.example", "a.example", "b.example"], offerStyle: "badge", askWhereToSave: true });
    expect(parseSettings(parsed)).toEqual(parsed);
  });
  it("asks where to save only when that was chosen, as a plain true", () => {
    expect(defaultSettings().askWhereToSave).toBe(false);
    expect(parseSettings({ askWhereToSave: true }).askWhereToSave).toBe(true);
    for (const stored of [false, "true", 1, {}, null]) expect(parseSettings({ askWhereToSave: stored }).askWhereToSave).toBe(false);
  });
});

describe("the Snapmaker Orca version", () => {
  it("is null (Newest) or an exact release number, and anything else falls back to Newest", () => {
    expect(parseSettings({ convert: {} }).convert.snapmakerOrcaVersion).toBeNull();
    expect(parseSettings({ convert: { snapmakerOrcaVersion: null } }).convert.snapmakerOrcaVersion).toBeNull();
    expect(parseSettings({ convert: { snapmakerOrcaVersion: "2.4.1" } }).convert.snapmakerOrcaVersion).toBe("2.4.1");
    for (const stored of ["newest", "", "2", "2.4.1 ", "v2.4.1", 2.4, true, ["2.4.1"], { version: "2.4.1" }]) {
      expect(parseSettings({ convert: { snapmakerOrcaVersion: stored } }).convert.snapmakerOrcaVersion).toBeNull();
    }
  });
  it("sends the exact newest when it was chosen by number, and nothing for Newest", () => {
    expect(convertOptions({ ...defaultSettings().convert, snapmakerOrcaVersion: "2.4.2" }, ["2.4.2", "2.4.1"]).snapmakerOrcaVersion).toBe("2.4.2");
    expect(convertOptions({ ...defaultSettings().convert, snapmakerOrcaVersion: "2.4.1" }, ["2.4.2", "2.4.1"]).snapmakerOrcaVersion).toBe("2.4.1");
    expect(convertOptions(defaultSettings().convert, ["2.4.2", "2.4.1"])).not.toHaveProperty("snapmakerOrcaVersion");
  });
});

describe("the nozzle size", () => {
  it("offers the library's choices, with its default", () => {
    expect(NOZZLE_SIZES).toEqual(NOZZLE_CHOICES);
    expect(DEFAULT_NOZZLE_SIZE).toBe(DEFAULT_NOZZLE);
  });
  it("is 0.4 mm by default", () => {
    expect(defaultSettings().convert.nozzle).toBe("0.4");
    expect(parseSettings({ convert: {} }).convert.nozzle).toBe("0.4");
  });
  it("keeps each size and Match the file, through a store and read back", () => {
    for (const nozzle of NOZZLE_SIZES) {
      const parsed = parseSettings({ convert: { nozzle } });
      expect(parsed.convert.nozzle).toBe(nozzle);
      expect(parseSettings(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    }
  });
  it("falls back to 0.4 mm on anything else stored", () => {
    for (const stored of ["0.5", "0.40", " 0.4", "0.4 mm", "Match", "MATCH", "", "1.0", "../0.6", 0.6, 0.4, true, null, ["0.6"], { size: "0.6" }]) {
      expect(parseSettings({ convert: { nozzle: stored } }).convert.nozzle).toBe("0.4");
    }
  });
  it("has one sentence of help, saying what it changes", () => {
    expect(NOZZLE_HELP).toBe(
      "The converted file is made for this nozzle size. The U1's stock nozzles are 0.4 mm, and Snapmaker Orca uses one size for all four toolheads. A project made for another size is converted anyway and you're told; 'Match the file' converts for the size the creator used.",
    );
  });
});

describe("convertOptions", () => {
  const releases = ["2.4.1", "2.4.0"];
  it("asks for nothing extra by default, and for 0.4 mm nozzles", () => {
    expect(convertOptions(defaultSettings().convert, releases)).toEqual({ nozzle: "0.4", highFlowHotends: false, hardenedNozzles: false });
  });
  it("passes each choice on", () => {
    expect(
      convertOptions({ snapmakerOrcaVersion: "2.4.0", nozzle: "0.6", layerHeight: 0.18, highFlowToolheads: [true, false, false, false], hardenedNozzles: true, filamentNames: "generic" }, releases, true, [0.18, 0.24, 0.3]),
    ).toEqual({ snapmakerOrcaVersion: "2.4.0", nozzle: "0.6", layerHeight: 0.18, highFlowHotends: [true, false, false, false], hardenedNozzles: true, filamentComplianceMode: "generic" });
    expect(convertOptions({ ...defaultSettings().convert, filamentNames: "polymaker" }, releases).filamentComplianceMode).toBe("polymaker");
    expect(convertOptions({ ...defaultSettings().convert, nozzle: "match" }, releases).nozzle).toBe("match");
  });
  it("sends the next release up when a saved one is gone, so the result names what was used", () => {
    expect(convertOptions({ ...defaultSettings().convert, snapmakerOrcaVersion: "1.0.0" }, releases).snapmakerOrcaVersion).toBe("2.4.0");
    expect(convertOptions({ ...defaultSettings().convert, snapmakerOrcaVersion: "9.0.0" }, releases).snapmakerOrcaVersion).toBe("2.4.1");
    expect(convertOptions({ ...defaultSettings().convert, snapmakerOrcaVersion: "1.0.0" }, [])).not.toHaveProperty("snapmakerOrcaVersion");
  });
});

describe("isQuiet", () => {
  it("matches exact hosts only", () => {
    expect(isQuiet(["site.example"], ["site.example"])).toBe(true);
    expect(isQuiet(["cdn.example", "site.example"], ["site.example"])).toBe(true);
    expect(isQuiet(["other.store.example"], ["bucket.store.example"])).toBe(false);
    expect(isQuiet([], ["site.example"])).toBe(false);
  });
});

describe("high-flow only where the size the file is made for supports it", () => {
  const convert = { ...defaultSettings().convert, highFlowToolheads: [true, false, true, false] as [boolean, boolean, boolean, boolean], hardenedNozzles: true };
  it("is sent when the nozzle supports it, and left out when it doesn't", () => {
    expect(convertOptions(convert, ["2.4.1"], true).highFlowHotends).toEqual([true, false, true, false]);
    expect(convertOptions(convert, ["2.4.1"], false).highFlowHotends).toBe(false);
    expect(convertOptions(convert, ["2.4.1"]).highFlowHotends).toEqual([true, false, true, false]);
  });
  it("is described only where it applied", () => {
    expect(describePrinter(convert, "0.4", true)).toEqual(["high-flow on T1, T3", "hardened steel nozzles"]);
    expect(describePrinter(convert, "0.6", false)).toEqual([]);
    expect(describePrinter(convert, "0.2", false)).toEqual([]);
    expect(describePrinter(defaultSettings().convert, "0.4", true)).toEqual([]);
  });
});

/** What the bundled catalog offers one release's options, read the way the page reads it. */
async function catalogChoices(release?: string): Promise<OptionChoices> {
  const newest = await loadCatalog(bundledProfileSource());
  const catalog = release === undefined ? newest : await newest.forRelease(release);
  // The converter's listing gives, for each filament option, what `filamentModeNozzleSizes` gives; a browser test asks the real one.
  const filamentModes = Object.fromEntries(FILAMENT_COMPLIANCE_MODES.map((mode) => [mode, filamentModeNozzleSizes(catalog.index.filamentNames, mode)]));
  return { layerHeights: layerHeightsBySize(catalog.list()), polymakerSizes: polymakerSizesFrom(filamentModes) };
}

describe("the layer height", () => {
  const sizes = { layerHeights: { "0.4": [0.08, 0.2, 0.28], "0.6": [0.18, 0.24, 0.3] }, polymakerSizes: ["0.4"] };
  it("keeps the creator's layers by default, and says so in the web app's words", () => {
    expect(defaultSettings().convert.layerHeight).toBeNull();
    expect(KEEP_LAYERS).toBe("Keep the creator's layers");
    expect(LAYER_HEIGHT_HELP).toBe(
      "Converts the project with one layer height for every layer, from your nozzle's U1 profiles. It replaces the creator's variable layer heights and any layer heights set for part of the model.",
    );
  });
  it("keeps a height through a store and read back, and nothing that isn't one", () => {
    const parsed = parseSettings({ convert: { nozzle: "0.6", layerHeight: 0.18 } });
    expect(parsed.convert.layerHeight).toBe(0.18);
    expect(parseSettings(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    for (const stored of ["0.18", 0, -0.2, 11, Number.NaN, Number.POSITIVE_INFINITY, true, null, [0.18], { mm: 0.18 }, "../0.18", "<img>"]) {
      expect(parseSettings({ convert: { nozzle: "0.6", layerHeight: stored } }).convert.layerHeight).toBeNull();
    }
  });
  it("has none with Match the file, where the nozzle size differs from file to file", () => {
    expect(parseSettings({ convert: { nozzle: "match", layerHeight: 0.2 } }).convert.layerHeight).toBeNull();
    expect(layerHeightsFor(sizes, "match")).toEqual([]);
  });
  it("is written in mm with no trailing zeros", () => {
    expect([0.3, 0.18, 0.08, 0.2, 0.30000000000000004].map(layerHeightText)).toEqual(["0.3 mm", "0.18 mm", "0.08 mm", "0.2 mm", "0.3 mm"]);
  });
  it("lists each nozzle size's heights once, lowest first, and leaves out what isn't a profile's size or height", () => {
    const listed = layerHeightsBySize([
      { nozzleDiameter: "0.4", layerHeight: 0.2 },
      { nozzleDiameter: "0.4", layerHeight: 0.08 },
      { nozzleDiameter: "0.4", layerHeight: 0.2 },
      { nozzleDiameter: "0.6", layerHeight: 0.3 },
      { nozzleDiameter: "match", layerHeight: 0.2 },
      { nozzleDiameter: "__proto__", layerHeight: 0.2 },
      { nozzleDiameter: "0.5", layerHeight: 0.2 },
      { nozzleDiameter: "0.6", layerHeight: "0.18" },
      { nozzleDiameter: "0.6", layerHeight: -1 },
      { nozzleDiameter: "0.6", layerHeight: Number.NaN },
      { nozzleDiameter: 0.6, layerHeight: 0.24 },
      {},
    ]);
    expect(listed).toEqual({ "0.4": [0.08, 0.2], "0.6": [0.3] });
    expect(layerHeightsFor({ layerHeights: listed, polymakerSizes: null }, "0.4")).toEqual([0.08, 0.2]);
    expect(layerHeightsFor({ layerHeights: listed, polymakerSizes: null }, "0.8")).toEqual([]);
    expect(layerHeightsFor(undefined, "0.4")).toEqual([]);
  });
  it("is the catalog's heights for each nozzle size, in every release", async () => {
    const catalog = await loadCatalog(bundledProfileSource());
    for (const release of catalog.releases().map((each) => each.version)) {
      const { layerHeights } = await catalogChoices(release);
      expect(Object.keys(layerHeights).sort()).toEqual(["0.2", "0.4", "0.6", "0.8"]);
      expect(layerHeights["0.6"]).toEqual([0.18, 0.24, 0.3]);
      expect(layerHeights["0.4"]).toEqual([0.08, 0.1, 0.12, 0.16, 0.2, 0.24, 0.28]);
      for (const heights of Object.values(layerHeights)) expect(heights).toEqual([...new Set(heights)].sort((a, b) => a - b));
    }
  });
  it("is sent only when the size the file is made for has it, so a stored height the catalog lacks can't fail a file", () => {
    const convert = { ...defaultSettings().convert, nozzle: "0.6" as const, layerHeight: 0.18 };
    expect(convertOptions(convert, ["2.4.1"], true, [0.18, 0.24, 0.3]).layerHeight).toBe(0.18);
    expect(convertOptions(convert, ["2.4.1"], true, [0.08, 0.2])).not.toHaveProperty("layerHeight");
    expect(convertOptions(convert, ["2.4.1"])).not.toHaveProperty("layerHeight");
    expect(convertOptions({ ...convert, layerHeight: null }, ["2.4.1"], true, [0.18])).not.toHaveProperty("layerHeight");
  });
  it("goes back to the creator's layers when the nozzle size chosen doesn't have it", () => {
    const convert = { ...defaultSettings().convert, nozzle: "0.6" as const, layerHeight: 0.18 };
    expect(settleConvert(convert, sizes)).toBe(convert);
    expect(settleConvert({ ...convert, nozzle: "0.4" }, sizes).layerHeight).toBeNull();
    expect(settleConvert({ ...convert, nozzle: "0.8" }, sizes).layerHeight).toBeNull();
    expect(settleConvert({ ...convert, nozzle: "match" }, sizes).layerHeight).toBeNull();
    expect(settleConvert({ ...convert, layerHeight: 0.24 }, sizes).layerHeight).toBe(0.24);
    // Without the catalog's list, nothing is taken away: the conversion checks the height again.
    expect(settleConvert({ ...convert, nozzle: "0.4" }, undefined).layerHeight).toBe(0.18);
  });
});

describe("the Filament choices", () => {
  const sizes = { layerHeights: {}, polymakerSizes: ["0.4"] };
  it("are Original and then the library's, in its order, each with the web app's words", () => {
    expect(FILAMENT_NAMES).toEqual(["original", ...FILAMENT_COMPLIANCE_MODES]);
    expect(FILAMENT_NAMES.map((choice) => FILAMENT_CHOICES[choice].label)).toEqual(["Original", "Snapmaker", "Polymaker", "Generic"]);
    expect(FILAMENT_CHOICES.polymaker.description).toBe("Switch PLA to Polymaker presets, with their own settings; other filaments as Snapmaker.");
    expect(FILAMENT_CHOICES.original.description).toBe("Keep the creator's filaments: names and settings as in the file.");
    expect(FILAMENT_CHOICES.snapmaker.description).toBe("Switch to Snapmaker presets, with their own settings, for Snapmaker Space.");
    expect(FILAMENT_CHOICES.generic.description).toBe("Switch to Generic presets, with their own settings.");
  });
  it("offer Polymaker only for a nozzle size that has its presets, and say why not", () => {
    expect(NOZZLE_SIZES.filter((size) => polymakerOffered(sizes, size))).toEqual(["0.4", "match"]);
    expect(polymakerReason(["0.4"])).toBe("Snapmaker Orca has Polymaker presets for the 0.4 mm nozzle only.");
    expect(polymakerReason(["0.4", "0.6"])).toBe("Snapmaker Orca has Polymaker presets for the 0.4 and 0.6 mm nozzles only.");
    // When the catalog couldn't say, it stays a choice: the library converts it as Snapmaker where it has no presets.
    for (const unknown of [undefined, { layerHeights: {}, polymakerSizes: null }]) expect(NOZZLE_SIZES.every((size) => polymakerOffered(unknown, size))).toBe(true);
  });
  it("take Polymaker's nozzle sizes from the converter's listing, and keep Polymaker a choice everywhere when the listing doesn't say", () => {
    expect(polymakerSizesFrom({ snapmaker: ["0.2", "0.4", "0.6", "0.8"], polymaker: ["0.4"], generic: ["0.2", "0.4", "0.6", "0.8"] })).toEqual(["0.4"]);
    expect(polymakerSizesFrom({ polymaker: ["0.6", "0.4"] })).toEqual(["0.4", "0.6"]);
    expect(polymakerSizesFrom({ polymaker: [] })).toEqual([]);
    // Sizes the options don't offer, and anything that isn't a size, are left out.
    expect(polymakerSizesFrom({ polymaker: ["0.4", "1.0", "match", 0.6, null, "<b>"] })).toEqual(["0.4"]);
    // No listing of the filament options, none for Polymaker, or a shape this doesn't know: it can be chosen for every size.
    for (const absent of [undefined, null, {}, { snapmaker: ["0.4"] }, { polymaker: "0.4" }, { polymaker: null }, "polymaker", 4, []]) {
      const sizes = polymakerSizesFrom(absent);
      expect(sizes, JSON.stringify(absent)).toBeNull();
      expect(NOZZLE_SIZES.every((size) => polymakerOffered({ layerHeights: {}, polymakerSizes: sizes }, size))).toBe(true);
      // And nothing stored is changed for it.
      const convert = { ...defaultSettings().convert, nozzle: "0.6" as const, filamentNames: "polymaker" as const };
      expect(settleConvert(convert, { layerHeights: {}, polymakerSizes: sizes }).filamentNames).toBe("polymaker");
    }
  });
  it("agree with the catalog, in every release: Polymaker presets for the 0.4 mm nozzle only", async () => {
    const catalog = await loadCatalog(bundledProfileSource());
    for (const release of catalog.releases().map((each) => each.version)) {
      const choices = await catalogChoices(release);
      expect(choices.polymakerSizes).toEqual(["0.4"]);
      const table = (await catalog.forRelease(release)).index.filamentNames;
      for (const size of ["0.2", "0.4", "0.6", "0.8"] as const) expect(polymakerOffered(choices, size)).toBe(filamentModeHasPresets(table, "polymaker", size));
    }
  });
  it("switch Polymaker to Snapmaker when the nozzle size chosen has no Polymaker presets, and leave the others alone", () => {
    const convert = { ...defaultSettings().convert, filamentNames: "polymaker" as const };
    expect(settleConvert(convert, sizes)).toBe(convert);
    expect(settleConvert({ ...convert, nozzle: "0.6" }, sizes).filamentNames).toBe("snapmaker");
    expect(settleConvert({ ...convert, nozzle: "match" }, sizes).filamentNames).toBe("polymaker");
    for (const filamentNames of ["original", "snapmaker", "generic"] as const) expect(settleConvert({ ...convert, nozzle: "0.6", filamentNames }, sizes).filamentNames).toBe(filamentNames);
  });
});
