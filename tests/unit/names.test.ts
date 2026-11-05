// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { baseName, displayName, outputName, safeFileName } from "../../src/core/names";

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const halfCharacter = /\p{Cs}/u;

describe("baseName", () => {
  it("takes the last part of either kind of path", () => {
    expect(baseName("/mnt/data/Downloads/a.3mf")).toBe("a.3mf");
    expect(baseName("C:\\Users\\someone\\a.3mf")).toBe("a.3mf");
  });
  it("gives nothing for a value that isn't a string", () => {
    expect(baseName(undefined)).toBe("");
    expect(baseName({ toString: () => "x" })).toBe("");
  });
  it("never starts with half a character", () => {
    for (let count = 95; count < 105; count += 1) {
      const name = baseName(`x${"😀".repeat(count)}.3mf`);
      expect(halfCharacter.test(name), String(count)).toBe(false);
      expect(name.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("displayName", () => {
  it("drops what could turn a name around on screen, and keeps the rest as it is", () => {
    expect(displayName("report\u202Efdp.3mf")).toBe("reportfdp.3mf");
    expect(displayName("a\u2066b\u2069\u200f.3mf")).toBe("ab.3mf");
    expect(displayName("line\nbreak.3mf")).toBe("line_break.3mf");
    expect(displayName("family👨\u200d👩\u200d👧.3mf")).toBe("family👨\u200d👩\u200d👧.3mf");
  });
});

describe("outputName", () => {
  it("adds the suffix, stripping .3mf only if it's there", () => {
    expect(outputName("desk.3mf")).toBe("desk_U1.3mf");
    expect(outputName("DESK.3MF")).toBe("DESK_U1.3mf");
    expect(outputName("thing")).toBe("thing_U1.3mf");
    expect(outputName("a.gcode.3mf")).toBe("a.gcode_U1.3mf");
  });
  it("doesn't pile a second _U1 on a file this extension already made", () => {
    expect(outputName("0042 Desk Lamp AMS_U1.3mf")).toBe("0042 Desk Lamp AMS_U1.3mf");
    expect(outputName("desk_U1")).toBe("desk_U1.3mf");
    expect(outputName("_U1.3mf")).toBe("model_U1.3mf");
    expect(outputName("desk_U1_copy.3mf")).toBe("desk_U1_copy_U1.3mf");
    expect(outputName("desk_u1.3mf")).toBe("desk_u1_U1.3mf");
  });
  it("can't be steered out of the downloads folder", () => {
    expect(outputName("../../etc/passwd.3mf")).toBe("passwd_U1.3mf");
    expect(outputName("..\\..\\evil.3mf")).toBe("evil_U1.3mf");
    expect(outputName("..")).toBe("model_U1.3mf");
    expect(outputName("")).toBe("model_U1.3mf");
  });
  it("removes what a file system or a reader could be fooled by", () => {
    expect(safeFileName('a<b>c:d"e|f?g*h')).toBe("a_b_c_d_e_f_g_h");
    expect(safeFileName("bad\u0000name\n")).toBe("bad_name_");
    expect(safeFileName("safe\u202Egnp.exe")).toBe("safegnp.exe");
    expect(safeFileName("  .hidden. ")).toBe("hidden");
  });

  // Each of these was refused by a browser's download API, or saved under a different name (measured 2026-11-05).
  it.each([
    ["a zero-width space", "my\u200bmodel.3mf", "mymodel_U1.3mf"],
    ["an emoji built with joiners", "family👨\u200d👩\u200d👧.3mf", "family👨👩👧_U1.3mf"],
    ["a soft hyphen", "soft\u00adhyphen.3mf", "softhyphen_U1.3mf"],
    ["a byte-order mark", "bom\ufeffx.3mf", "bomx_U1.3mf"],
    ["a C1 control", "x\u0085y.3mf", "x_y_U1.3mf"],
    ["a no-break space", "nbsp\u00a0x.3mf", "nbsp x_U1.3mf"],
    ["a line separator", "sep\u2028x.3mf", "sep_x_U1.3mf"],
    ["a word joiner and an Arabic letter mark", "x\u2060y\u061cz.3mf", "xyz_U1.3mf"],
    ["nothing but zero-width characters", "\u200b\u200b\u200b.3mf", "model_U1.3mf"],
    ["half a character", "abc\ud800.3mf", "abc_U1.3mf"],
  ])("cleans %s", (_, name, expected) => {
    expect(outputName(name)).toBe(expected);
  });

  it("keeps what every browser accepts", () => {
    expect(outputName("Ünïcödé 漢字 x\u0301.3mf")).toBe("Ünïcödé 漢字 x\u0301_U1.3mf");
    expect(outputName("CON.3mf")).toBe("CON_U1.3mf");
  });

  it("bounds the stem in bytes, cut between characters, so the browser never shortens it and drops _U1", () => {
    for (const name of ["x".repeat(5000), "漢".repeat(150), `x${"😀".repeat(90)}`, "é".repeat(300)]) {
      const output = outputName(`${name}.3mf`);
      expect(output.endsWith("_U1.3mf"), name.slice(0, 10)).toBe(true);
      expect(bytes(output.replace(/_U1\.3mf$/, ""))).toBeLessThanOrEqual(200);
      expect(halfCharacter.test(output)).toBe(false);
    }
  });
});
