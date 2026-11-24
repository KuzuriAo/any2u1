// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { convert, filamentNotes, NOTE_TOPICS, type ConvertNote } from "any2orca";
import { bundledProfileSource } from "any2orca/node";
import { describe, expect, it } from "vitest";
import { noteGroups, OTHER_TITLE, TOPIC_TITLES } from "../../src/core/notes";
import { FILAMENT_HELP, FILAMENT_NAMES } from "../../src/core/settings";
import { fixture, plateNotesProject, POLYMAKER, sharedToolheadProject, silkAndToughProject } from "../shared/fixtures";

const sample = readFileSync(new URL("../fixtures/bambu-studio-2.8.4.57-beta.3mf", import.meta.url));
const h3cMixed = readFileSync(new URL("../fixtures/bambu-studio-2.9.1.70-h3c-mixed.3mf", import.meta.url));
const reportOf = async (file: Buffer, options: { nozzle?: "0.6"; filamentComplianceMode?: "snapmaker" | "polymaker" | "generic" } = {}) => (await convert(file, { profiles: bundledProfileSource(), ...options })).report;
const note = (topic: string, text: string): ConvertNote => ({ topic, text });
/** The same sentence in the older lists' style: a lower-case start and no final period are allowed there. */
const plain = (text: string) => text.replace(/\.$/, "").replace(/^./, (first) => first.toLowerCase());

describe("a result's notes", () => {
  it("have a heading for every topic the library names, in its order", () => {
    expect(Object.keys(TOPIC_TITLES)).toEqual([...NOTE_TOPICS]);
  });
  it("keep the order given, each run of one topic under one heading, and a topic that comes back gets its heading again", () => {
    const groups = noteGroups([note("nozzle", "A."), note("nozzle", "B."), note("settings", "C."), note("nozzle", "D.")]);
    expect(groups).toEqual([
      { title: "Nozzle size", notes: ["A.", "B."] },
      { title: "Settings", notes: ["C."] },
      { title: "Nozzle size", notes: ["D."] },
    ]);
  });
  it("put a topic from a later library under one heading of their own, text unchanged", () => {
    const groups = noteGroups([note("plates", "A."), note("print-time", "B."), note("constructor", "C."), note("__proto__", "D.")]);
    expect(groups).toEqual([{ title: "Plates", notes: ["A."] }, { title: OTHER_TITLE, notes: ["B.", "C.", "D."] }]);
  });
  it("are none for a file with nothing to say", async () => {
    const report = await reportOf(sample);
    expect(report.notes).toEqual([]);
    expect(noteGroups(report.notes)).toEqual([]);
  });
  it("put the 2.85 mm filament first, then the nozzle sizes, then the settings, every note once", async () => {
    const report = await reportOf(h3cMixed);
    expect(report.notes[0]).toMatchObject({ topic: "filament-diameter", slots: [3] });
    expect(report.notes[0]!.text).toMatch(/^Filament 3 was Bambu TPU 75A\(2\.85mm\) @BBL H3C/);
    const groups = noteGroups(report.notes);
    expect(groups.map((group) => group.title)).toEqual(["Filament diameter", "Nozzle size", "Settings"]);
    expect(groups.flatMap((group) => group.notes)).toEqual(report.notes.map((n) => n.text));
  });
  it("put what a plate's filaments mean for printing it under a heading of its own, ahead of the plain line for a plate", async () => {
    const report = await reportOf(plateNotesProject());
    expect(report.notes.map((n) => n.topic)).toEqual(["plate-filaments", "plate-filaments", "plates"]);
    // Filament 17 with filament 1 on plate 1, then plate 2's five filaments, two at a time.
    expect(report.notes[0]!.slots).toEqual([1, 17]);
    expect(report.notes[1]!.slots).toEqual([1, 2, 3, 4, 5]);
    expect(noteGroups(report.notes)).toEqual([
      { title: "Filaments per plate", notes: [report.notes[0]!.text, report.notes[1]!.text] },
      { title: "Plates", notes: [report.notes[2]!.text] },
    ]);
  });
  /** The library's note for publishing on Snapmaker Space, up to the sentence that names the plates. */
  const SPACE = "To publish on Snapmaker Space: its review rules list more than four colors on one plate as a reason to turn a file down, unless the print pauses at filament changes or uses Full Spectrum.";
  const spaceNotes = (notes: readonly ConvertNote[]) => notes.filter((n) => n.text.includes("Snapmaker Space"));
  it.each(["snapmaker", "polymaker", "generic"] as const)("say what Snapmaker Space's rules list about a plate with five colors with the %s presets, after what the plate needs to print at all; Original says only the second", async (option) => {
    const space = `${SPACE} Plate 6 uses 5.`;
    const needs = /^Plate 6 needs 5 filaments at the same height /;
    const report = await reportOf(fixture(POLYMAKER), { filamentComplianceMode: option });
    expect(report.notes[0]).toMatchObject({ topic: "plate-filaments", slots: [1, 2, 3, 5, 6] });
    expect(report.notes[0]!.text).toMatch(needs);
    expect(spaceNotes(report.notes)).toEqual([{ topic: "filament-presets", text: space }]);
    const groups = noteGroups(report.notes);
    expect(groups.map((group) => group.title)).toEqual(["Filaments per plate", "Filament presets", "Plates"]);
    // The last of the presets' notes, so it reads after which filaments took which preset.
    expect(groups[1]!.notes.at(-1)).toBe(space);
    const original = await reportOf(fixture(POLYMAKER));
    expect(original.notes[0]!.text).toMatch(needs);
    expect(spaceNotes(original.notes)).toEqual([]);
    expect(noteGroups(original.notes).map((group) => group.title)).toEqual(["Filaments per plate", "Plates"]);
  });
  it("leave a plate out of the Snapmaker Space note once every filament change on it has a pause: the rules' own exception", async () => {
    const without = await reportOf(sharedToolheadProject({ pause: false }), { filamentComplianceMode: "snapmaker" });
    expect(spaceNotes(without.notes).map((n) => n.text)).toEqual([`${SPACE} Plates 2 and 6 use more than four.`]);
    const paused = await reportOf(sharedToolheadProject({ pause: true }), { filamentComplianceMode: "snapmaker" });
    expect(spaceNotes(paused.notes).map((n) => n.text)).toEqual([`${SPACE} Plate 6 uses 5.`]);
    // Plate 2 still has its own note, which says the pause is there.
    expect(paused.notes.find((n) => n.text.startsWith("Plate 2 "))!.text).toContain("the project already has a pause at layer 60, between the two");
    expect(noteGroups(paused.notes).map((group) => group.title)).toEqual(["Filaments per plate", "Filament presets", "Plates"]);
  });
  it("say of a plate printed object by object that Snapmaker Orca sets no pauses then, under the plates' filaments, with no plan", async () => {
    const report = await reportOf(sharedToolheadProject({ pause: false, byObject: true }));
    const plate = report.notes.find((n) => n.text.startsWith("Plate 2 "))!;
    expect(plate.topic).toBe("plate-filaments");
    expect(plate.text).toBe(
      "Plate 2 uses 5 filaments (filaments 1, 2, 3, 4 and 5), no more than 2 at the same height. The U1 prints with 4 at a time, so this plate needs filament changes at pauses. It prints object by object, and Snapmaker Orca sets no pauses then: to use them, set the print sequence to by layer in Snapmaker Orca.",
    );
    expect(report.swapPlans).toBeUndefined();
    expect(noteGroups(report.notes)[0]).toMatchObject({ title: "Filaments per plate" });
    expect(noteGroups(report.notes)[0]!.notes).toContain(plate.text);
  });
  it.each(["snapmaker", "polymaker"] as const)("name Polymaker's silk and tough presets for a silk and a tough PLA of Polymaker's, with the %s presets", async (option) => {
    const report = await reportOf(silkAndToughProject(), { filamentComplianceMode: option });
    expect(report.filaments.slice(0, 3).map((filament) => filament.outputName)).toEqual(["Polymaker Silk PLA Family @U1", "Polymaker Tough PLA Family @U1", "Generic PETG"]);
    const presets = noteGroups(report.notes).find((group) => group.title === "Filament presets")!;
    for (const name of ["Polymaker Silk PLA Family @U1", "Polymaker Tough PLA Family @U1"]) expect(presets.notes.some((text) => text.includes(name))).toBe(true);
  });
  it("keep a filament the U1 can't take as it is ahead of the plates' filaments", async () => {
    const report = await reportOf(plateNotesProject("bambu-studio-2.9.1.70-h3c-mixed.3mf", "Cylinder"));
    expect(report.notes[0]).toMatchObject({ topic: "filament-diameter", slots: [3] });
    expect(noteGroups(report.notes).map((group) => group.title).slice(0, 3)).toEqual(["Filament diameter", "Filaments per plate", "Nozzle size"]);
  });
  it.each([
    ["the H3C project", () => reportOf(h3cMixed)],
    ["a 0.4 mm project made for 0.6 mm nozzles", () => reportOf(sample, { nozzle: "0.6" })],
  ])("say why the profile was chosen once, under the nozzle size, before the filaments tuned for another size: %s", async (_, make) => {
    const report = await make();
    expect(report.profileNotes).toHaveLength(1);
    const why = report.notes.filter((n) => plain(n.text) === plain(report.profileNotes[0]!));
    expect(why).toHaveLength(1);
    expect(why[0]!.topic).toBe("nozzle");
    expect(why[0]!.slots).toBeUndefined();
    const calibration = report.notes.findIndex((n) => n.topic === "nozzle" && / tuned for a [\d.]+ mm nozzle /.test(n.text));
    expect(calibration).toBeGreaterThan(-1);
    expect(report.notes.indexOf(why[0]!)).toBeLessThan(calibration);
  });
  it.each([
    ["the H3C project", () => reportOf(h3cMixed)],
    ["the H3C project with Snapmaker filaments", () => reportOf(h3cMixed, { filamentComplianceMode: "snapmaker" })],
    ["a project with Snapmaker filaments", () => reportOf(sample, { filamentComplianceMode: "snapmaker" })],
    ["a 0.4 mm project made for 0.6 mm nozzles", () => reportOf(sample, { nozzle: "0.6" })],
  ])("hold every sentence of the library's older lists, once, so nothing is lost by showing only them: %s", async (_, make) => {
    const report = await make();
    const older = [...new Set([...report.warnings, ...report.profileNotes, ...filamentNotes(report)])];
    expect(older.length).toBeGreaterThan(0);
    for (const sentence of older) expect(report.notes.filter((n) => plain(n.text) === plain(sentence)), sentence).toHaveLength(1);
    expect(report.notes).toHaveLength(older.length);
  });
});

describe("the Filament option's help", () => {
  it("is one line for each choice, in the any2orca web app's words (its tooltip for each)", () => {
    expect(FILAMENT_HELP).toEqual({
      original: "Keeps the creator's filament names and settings.",
      snapmaker: "Sets each filament to a Snapmaker preset Snapmaker Orca ships, with that preset's settings, where Snapmaker makes one, and Generic otherwise. Colors and order stay.",
      polymaker: "Sets each PLA to the Polymaker preset Snapmaker Orca ships for its kind (General, Silk or Tough PLA Family), with that preset's settings, and every other filament as the Snapmaker option does. Colors and order stay.",
      generic: "Sets each filament to a Generic preset Snapmaker Orca ships, with that preset's settings. Colors and order stay.",
    });
    expect(Object.keys(FILAMENT_HELP)).toEqual([...FILAMENT_NAMES]);
  });
});

