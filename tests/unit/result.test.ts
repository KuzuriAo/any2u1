// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { madeForText, profileText } from "../../src/core/result";

describe("what a result says the file is made for", () => {
  it("names the profile without the catalog's printer and nozzle part, then the size in words", () => {
    expect(profileText("0.20mm Standard @Snapmaker U1 (0.4 nozzle)", "0.4")).toBe("0.20mm Standard, for 0.4 mm nozzles");
    expect(profileText("0.30mm Standard @Snapmaker U1 (0.6 nozzle)", "0.6")).toBe("0.30mm Standard, for 0.6 mm nozzles");
  });
  it("shows a name without that part whole", () => {
    expect(profileText("Custom", "0.4")).toBe("Custom, for 0.4 mm nozzles");
    expect(profileText(" @odd", "0.4")).toBe(" @odd, for 0.4 mm nozzles");
  });
  it("adds the Snapmaker Orca version and the printer options that applied", () => {
    expect(madeForText({ profile: "0.20mm Standard @Snapmaker U1 (0.4 nozzle)", nozzle: "0.4", orcaVersion: "2.4.1", printer: ["high-flow on T1", "hardened steel nozzles"] }))
      .toBe("using 0.20mm Standard, for 0.4 mm nozzles and Snapmaker Orca 2.4.1, high-flow on T1, hardened steel nozzles");
    expect(madeForText({ profile: "0.30mm Standard @Snapmaker U1 (0.6 nozzle)", nozzle: "0.6", orcaVersion: undefined, printer: [] }))
      .toBe("using 0.30mm Standard, for 0.6 mm nozzles");
  });
});
