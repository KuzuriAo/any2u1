// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { activeRelease, parseKnownReleases, releaseChange, releaseNoticeText } from "../../src/core/releases";

const now = ["2.4.2", "2.4.1", "2.4.0"];

describe("parseKnownReleases", () => {
  it("treats anything but a list as a first run", () => {
    expect(parseKnownReleases(undefined)).toBeNull();
    expect(parseKnownReleases("2.4.1")).toBeNull();
    expect(parseKnownReleases(["2.4.1", 7, null])).toEqual(["2.4.1"]);
  });
});

describe("activeRelease", () => {
  it("is the choice while the catalog holds it, otherwise the newest", () => {
    expect(activeRelease(null, now)).toBe("2.4.2");
    expect(activeRelease("2.4.0", now)).toBe("2.4.0");
    expect(activeRelease("2.3.0", now)).toBe("2.4.2");
    expect(activeRelease(null, [])).toBeUndefined();
  });
});

describe("the notice", () => {
  const text = (known: string[], chosen: string | null, releases = now) => releaseNoticeText(releaseChange(known, releases, chosen), releases, chosen);

  it("says nothing when nothing changed", () => {
    expect(text(now, null)).toBeNull();
    expect(text(now, "2.4.0")).toBeNull();
  });
  it("warns someone on the default that conversions moved up", () => {
    const notice = text(["2.4.1", "2.4.0"], null);
    expect(notice).toContain("Snapmaker Orca 2.4.2 is now available");
    expect(notice).toContain("Conversions now use 2.4.2");
    expect(notice).toContain("older version");
  });
  it("tells someone with a choice that it stands", () => {
    const notice = text(["2.4.1", "2.4.0"], "2.4.1");
    expect(notice).toContain("You're still converting for 2.4.1");
    expect(notice).not.toContain("Conversions now use");
  });
  it("says when a chosen release was dropped, and what's used instead", () => {
    const notice = text(["2.4.1", "2.4.0", "2.3.9"], "2.3.9", ["2.4.1", "2.4.0"]);
    expect(notice).toContain("2.3.9 is no longer available");
    expect(notice).toContain("now use 2.4.1");
  });
  it("covers both at once", () => {
    const notice = text(["2.4.1", "2.4.0", "2.3.9"], "2.3.9");
    expect(notice).toContain("2.3.9 is no longer available");
    expect(notice).toContain("2.4.2 is now available");
    expect(notice).not.toContain("still converting for");
  });
  it("says nothing about a dropped release nobody chose", () => {
    expect(text(["2.4.1", "2.4.0", "2.3.9"], null, ["2.4.1", "2.4.0"])).toBeNull();
  });
  it("names several new releases", () => {
    expect(text(["2.4.0"], null)).toContain("2.4.2, 2.4.1 are now available");
  });
});
