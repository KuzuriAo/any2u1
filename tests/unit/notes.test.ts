// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { convert, filamentNotes, NOTE_TOPICS, type ConvertNote } from "any2orca";
import { bundledProfileSource } from "any2orca/node";
import { describe, expect, it } from "vitest";
import { noteGroups, OTHER_TITLE, TOPIC_TITLES } from "../../src/core/notes";
import { FILAMENT_HELP } from "../../src/core/settings";
import { plateNotesProject } from "../shared/fixtures";

const sample = readFileSync(new URL("../fixtures/bambu-studio-2.8.4.57-beta.3mf", import.meta.url));
const h3cMixed = readFileSync(new URL("../fixtures/bambu-studio-2.9.1.70-h3c-mixed.3mf", import.meta.url));
const reportOf = async (file: Buffer, options: { nozzle?: "0.6"; filamentComplianceMode?: "snapmaker" } = {}) => (await convert(file, { profiles: bundledProfileSource(), ...options })).report;
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
  it("is the wording the any2orca web app uses", () => {
    expect(FILAMENT_HELP).toBe(
      "Original keeps the creator's filaments exactly: their names and their settings. Generic and Snapmaker switch each filament to a preset Snapmaker Orca ships, with that preset's own settings, for uploads to Snapmaker Space; colors and order stay. Snapmaker Orca would use the preset's settings anyway once a filament carries its name.",
    );
  });
});
