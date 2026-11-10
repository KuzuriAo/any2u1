// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { convert, filamentNotes } from "any2orca";
import { bundledProfileSource } from "any2orca/node";
import { describe, expect, it } from "vitest";
import { notesFor } from "../../src/core/notes";
import { FILAMENT_HELP } from "../../src/core/settings";

const sample = readFileSync(new URL("../fixtures/bambu-studio-2.8.4.57-beta.3mf", import.meta.url));
const h3cMixed = readFileSync(new URL("../fixtures/bambu-studio-2.9.1.70-h3c-mixed.3mf", import.meta.url));
const reportFor = async (mode?: "snapmaker" | "generic") => (await convert(sample, { profiles: bundledProfileSource(), ...(mode ? { filamentComplianceMode: mode } : {}) })).report;

describe("a result's notes", () => {
  it("are the library's warnings, then its filament sentences, unchanged, when a preset was applied", async () => {
    const report = await reportFor("snapmaker");
    expect(report.filamentPresets?.length).toBeGreaterThan(0);
    const sentences = filamentNotes(report);
    expect(sentences.length).toBeGreaterThan(0);
    expect(notesFor(report)).toEqual([...report.warnings, ...sentences]);
    expect(sentences[0]).toMatch(/^Filaments 1 and 2 use Snapmaker PLA Matte @U1's own settings/);
    expect(sentences).toContainEqual(expect.stringMatching(/^Filaments 3 and 4 use Snapmaker PLA SnapSpeed @U1's own settings instead of the creator's: nozzle temperature 225 °C → 220 °C/));
  });
  it("say nothing about filaments for Original", async () => {
    const report = await reportFor();
    expect(filamentNotes(report)).toEqual([]);
    expect(notesFor(report)).toEqual(report.warnings);
  });
  it("carry the library's sentence for a material no preset fits, Snapmaker Space's refusal included", () => {
    const report = { warnings: ["A warning."], filamentPresets: [], filamentComplianceFallback: [], filamentComplianceUnchanged: ["PC"] };
    expect(notesFor(report)).toEqual(["A warning.", "No Snapmaker or Generic preset fits PC at this nozzle size, so its name and settings stay as the creator had them. Snapmaker Space may refuse this file."]);
  });
  it("keep the library's order, so what needs doing comes first, and say why the profile was chosen among them", async () => {
    const { report } = await convert(h3cMixed, { profiles: bundledProfileSource() });
    const notes = notesFor(report);
    expect(notes).toEqual([...report.warnings, ...filamentNotes(report)]);
    expect(notes[0]).toMatch(/^Filament 3 was Bambu TPU 75A\(2\.85mm\) @BBL H3C/);
    // The result shows no list of its own for these: if the library stopped repeating them here, they'd be lost.
    expect(report.profileNotes.length).toBeGreaterThan(0);
    for (const note of report.profileNotes) expect(report.warnings).toContain(note);
  });
});

describe("the Filament option's help", () => {
  it("is the wording the any2orca web app uses", () => {
    expect(FILAMENT_HELP).toBe(
      "Original keeps the creator's filaments exactly: their names and their settings. Generic and Snapmaker switch each filament to a preset Snapmaker Orca ships, with that preset's own settings, for uploads to Snapmaker Space; colors and order stay. Snapmaker Orca would use the preset's settings anyway once a filament carries its name.",
    );
  });
});
