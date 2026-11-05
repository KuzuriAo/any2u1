// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { elapsedText, receivedText, sizeText, stageText } from "../../src/core/progress";

describe("stageText", () => {
  it("names each stage the library reports", () => {
    expect(stageText("matching")).toBe("Matching the profile");
    expect(stageText("loading-profile")).toBe("Loading the profile");
    expect(stageText("merging")).toBe("Merging the settings");
    expect(stageText("writing")).toBe("Writing the file");
  });
  it("says something plain for a stage it doesn't know, whatever it is", () => {
    for (const stage of ["later-stage", "__proto__", "toString", "", 7, null, undefined, { writing: 1 }]) expect(stageText(stage)).toBe("Converting");
  });
});

describe("elapsedText", () => {
  it("counts seconds, then minutes", () => {
    expect(elapsedText(0)).toBe("0 s");
    expect(elapsedText(999)).toBe("0 s");
    expect(elapsedText(42_900)).toBe("42 s");
    expect(elapsedText(60_000)).toBe("1 min 00 s");
    expect(elapsedText(125_000)).toBe("2 min 05 s");
  });
  it("copes with nonsense", () => {
    expect(elapsedText(-5)).toBe("0 s");
    expect(elapsedText(Number.NaN)).toBe("0 s");
    expect(elapsedText(Infinity)).toBe("0 s");
  });
});

describe("sizes", () => {
  it("picks a unit", () => {
    expect(sizeText(5)).toBe("5 B");
    expect(sizeText(67_645)).toBe("66 KB");
    expect(sizeText(105_223_916)).toBe("100.3 MB");
    expect(sizeText(1_048_942_316)).toBe("1000.3 MB");
    expect(sizeText(1_610_612_736)).toBe("1.50 GB");
  });
  it("shows what has arrived against the total when it's known", () => {
    expect(receivedText(5, 67_645)).toBe("5 B of 66 KB");
    expect(receivedText(5)).toBe("5 B");
    expect(receivedText(5, 0)).toBe("5 B");
    expect(receivedText(5, undefined)).toBe("5 B");
  });
});
