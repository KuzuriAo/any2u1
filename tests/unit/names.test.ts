// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { baseName, outputName, safeFileName } from "../../src/core/names";

describe("baseName", () => {
  it("takes the last part of either kind of path", () => {
    expect(baseName("/mnt/data/Downloads/a.3mf")).toBe("a.3mf");
    expect(baseName("C:\\Users\\someone\\a.3mf")).toBe("a.3mf");
  });
  it("gives nothing for a value that isn't a string", () => {
    expect(baseName(undefined)).toBe("");
    expect(baseName({ toString: () => "x" })).toBe("");
  });
});

describe("outputName", () => {
  it("adds the suffix, stripping .3mf only if it's there", () => {
    expect(outputName("desk.3mf")).toBe("desk_U1.3mf");
    expect(outputName("DESK.3MF")).toBe("DESK_U1.3mf");
    expect(outputName("thing")).toBe("thing_U1.3mf");
    expect(outputName("a.gcode.3mf")).toBe("a.gcode_U1.3mf");
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
    expect(safeFileName("safe\u202Egnp.exe")).toBe("safe_gnp.exe");
    expect(safeFileName("  .hidden. ")).toBe("hidden");
  });
  it("bounds the length", () => {
    expect(outputName(`${"x".repeat(5000)}.3mf`).length).toBeLessThan(170);
  });
});
