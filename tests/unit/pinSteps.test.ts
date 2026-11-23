// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { browserFamily, pinSteps } from "../../src/core/pinSteps";

const EDGE_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36 Edg/158.0.0.0";
const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";

describe("the pin steps", () => {
  it("follow each family's own menu", () => {
    expect(pinSteps("chromium")).toBe("Click the Extensions button (the puzzle piece) in the toolbar, then the pin beside any2u1.");
    expect(pinSteps("edge")).toBe("Click the Extensions button (the puzzle piece) in the toolbar, then the eye beside any2u1.");
    expect(pinSteps("firefox")).toBe("Click the Extensions button (the puzzle piece) in the toolbar, then the gear beside any2u1, and choose Pin to Toolbar.");
  });
  it("name no browser, in any family", () => {
    for (const family of ["chromium", "edge", "firefox"] as const) expect(pinSteps(family)).not.toMatch(/\b(Chrome|Chromium|Edge|Firefox|Safari|Opera|Brave)\b/);
  });
  it("pick the family from what the page can see", () => {
    expect(browserFamily({ hasGetBrowserInfo: true, brands: [], userAgent: "Mozilla/5.0 (Macintosh; rv:160.0) Gecko/20100101 Firefox/160.0" })).toBe("firefox");
    expect(browserFamily({ hasGetBrowserInfo: false, brands: ["Chromium", "Microsoft Edge", "Not.A/Brand"], userAgent: EDGE_UA })).toBe("edge");
    // Without the brands (a page that can't read them), the user agent still says.
    expect(browserFamily({ hasGetBrowserInfo: false, brands: [], userAgent: EDGE_UA })).toBe("edge");
    expect(browserFamily({ hasGetBrowserInfo: false, brands: ["Chromium", "Google Chrome", "Not.A/Brand"], userAgent: CHROME_UA })).toBe("chromium");
    expect(browserFamily({ hasGetBrowserInfo: false, brands: ["Brave", "Chromium", "Not.A/Brand"], userAgent: CHROME_UA })).toBe("chromium");
  });
});
