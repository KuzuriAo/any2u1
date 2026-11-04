// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { browserOf, diagnosticsReport, failureReport } from "../../src/core/report";

describe("browserOf", () => {
  it("gives the browser and its major version, not the system", () => {
    expect(browserOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0")).toBe("Firefox 159");
    expect(browserOf("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0")).toBe("Edge 156");
    expect(browserOf("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36")).toBe("Chrome 156");
    expect(browserOf("something else")).toBe("unknown browser");
  });
});

describe("failureReport", () => {
  const facts = { code: "unsupported_slicer", slicer: "SuperSlicer", size: 19985, site: "site.example", browser: "Firefox 159", extensionVersion: "0.1.0", libraryVersion: "0.5.0" };
  it("holds the code, browser, site, size and versions", () => {
    expect(failureReport(facts)).toBe(
      "any2u1 failure report\nError: unsupported_slicer (SuperSlicer)\nBrowser: Firefox 159\nSite: site.example\nFile size: 19985 bytes\nany2u1 0.1.0, any2orca 0.5.0",
    );
  });
  it("leaves out what isn't known", () => {
    expect(failureReport({ browser: "Chrome 156", extensionVersion: "0.1.0", libraryVersion: "0.5.0" })).toBe(
      "any2u1 failure report\nError: unknown\nBrowser: Chrome 156\nany2u1 0.1.0, any2orca 0.5.0",
    );
  });
  it("can't carry a line break, markup or a long string from outside", () => {
    const text = failureReport({ ...facts, slicer: "A\nInjected: line <b>", site: "x".repeat(500) });
    expect(text.split("\n").length).toBe(6);
    expect(text).not.toContain("<");
    expect(Math.max(...text.split("\n").map((line) => line.length))).toBeLessThan(120);
  });
  it("names no file, address or message, since each can identify a model", () => {
    expect(Object.keys(facts)).not.toContain("name");
    expect(failureReport(facts)).not.toMatch(/\.3mf|https?:/i);
  });
});

describe("diagnosticsReport", () => {
  it("is just the environment", () => {
    expect(diagnosticsReport({ browser: "Edge 156", extensionVersion: "0.1.0", libraryVersion: "0.5.0" })).toBe("any2u1 diagnostics\nBrowser: Edge 156\nany2u1 0.1.0, any2orca 0.5.0");
  });
});
