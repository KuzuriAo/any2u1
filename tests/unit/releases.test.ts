// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { activeRelease, parseKnownReleases, releaseChange, releaseNoticeText, settledChoice } from "../../src/core/releases";

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

describe("settledChoice", () => {
  it("pins the newest on a first run, so a later update doesn't move anyone", () => {
    expect(settledChoice(null, now, null)).toBe("2.4.2");
    expect(settledChoice(null, now, "2.4.0")).toBe("2.4.0");
  });
  it("leaves Newest following the catalog after the first run", () => {
    expect(settledChoice(["2.4.1", "2.4.0"], now, null)).toBeNull();
  });
  it("keeps an exact choice of the newest when a newer release arrives", () => {
    expect(settledChoice(["2.4.1", "2.4.0"], now, "2.4.1")).toBe("2.4.1");
    expect(activeRelease("2.4.1", now)).toBe("2.4.1");
    expect(releaseChange(["2.4.1", "2.4.0"], now, "2.4.1")).toEqual({ added: ["2.4.2"], droppedChoice: null });
  });
  it("moves a dropped choice to the newest, pinned", () => {
    expect(settledChoice(["2.4.1", "2.4.0", "2.3.9"], ["2.4.1", "2.4.0"], "2.3.9")).toBe("2.4.1");
    expect(settledChoice(null, ["2.4.1", "2.4.0"], "2.3.9")).toBe("2.4.1");
  });
  it("changes nothing when the catalog is empty", () => {
    expect(settledChoice(null, [], null)).toBeNull();
    expect(settledChoice(["2.4.1"], [], "2.4.1")).toBe("2.4.1");
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
  it("tells someone with a choice that it stands, and what to pick after updating", () => {
    const notice = text(["2.4.1", "2.4.0"], "2.4.1");
    expect(notice).toContain("Snapmaker Orca 2.4.2 is now available");
    expect(notice).toContain("You're still converting for 2.4.1.");
    expect(notice).toContain("If you've updated Snapmaker Orca, choose 2.4.2 in the options.");
    expect(notice).not.toContain("Conversions now use");
  });
  it("comes back with each new release for a choice that stands", () => {
    expect(text(["2.4.2", "2.4.1", "2.4.0"], "2.4.1", ["2.4.3", "2.4.2", "2.4.1"])).toContain("2.4.3 is now available here. You're still converting for 2.4.1.");
  });
  it("doesn't suggest the release already chosen", () => {
    expect(text(["2.4.2", "2.4.1"], "2.4.2")).not.toContain("If you've updated");
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
