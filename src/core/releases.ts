// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which Snapmaker Orca releases the bundled catalog holds. New ones arrive with an update of the
 * extension, so comparing the catalog with the list saved last time needs no request.
 */

export type ReleaseChange = { added: string[]; droppedChoice: string | null };

/** A list from storage, or null if there's nothing usable: a first run, which has nothing to announce. */
export function parseKnownReleases(stored: unknown): string[] | null {
  if (!Array.isArray(stored)) return null;
  return stored.filter((release): release is string => typeof release === "string");
}

export function releaseChange(known: readonly string[], releases: readonly string[], chosen: string | null): ReleaseChange {
  return {
    added: releases.filter((release) => !known.includes(release)),
    droppedChoice: chosen !== null && !releases.includes(chosen) ? chosen : null,
  };
}

/**
 * Release numbers compared part by part, so 2.10.0 comes after 2.9.1. A saved choice is checked as plain numbers on the
 * way in; anything else in a part counts as 0, so the comparison can't fail.
 */
export function compareReleases(a: string, b: string): number {
  const parts = (release: string) => release.split(".").map((part) => (/^\d{1,9}$/.test(part) ? Number(part) : 0));
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The release a conversion uses: the user's choice while the catalog holds it, and the newest (listed first) for
 * "Newest". A choice the catalog no longer holds goes to the next release up, the smallest step from what the user runs
 * and the safe direction, since an older file opens in a newer Snapmaker Orca; with none newer, to the newest.
 */
export function activeRelease(chosen: string | null, releases: readonly string[]): string | undefined {
  if (chosen === null) return releases[0];
  if (releases.includes(chosen)) return chosen;
  const newer = releases.filter((release) => compareReleases(release, chosen) > 0).sort(compareReleases);
  return newer[0] ?? releases[0];
}

/**
 * The choice to keep after an update is checked. A first run pins the newest, so a later update never moves anyone to a
 * release they may not run without asking; a choice the catalog dropped moves to the next release up, pinned the same
 * way. Null ("Newest", chosen in the options) otherwise stays null and follows the catalog.
 */
export function settledChoice(known: readonly string[] | null, releases: readonly string[], chosen: string | null): string | null {
  const newest = releases[0];
  if (newest === undefined) return chosen;
  if (chosen !== null && !releases.includes(chosen)) return activeRelease(chosen, releases) ?? newest;
  return known === null ? (chosen ?? newest) : chosen;
}

/** What to tell the user, or null if nothing changed for them. */
export function releaseNoticeText(change: ReleaseChange, releases: readonly string[], chosen: string | null): string | null {
  const newest = releases[0];
  if (newest === undefined) return null;
  const parts: string[] = [];
  const dropped = change.droppedChoice;
  let movedUp = false;
  if (dropped !== null) {
    const replacement = activeRelease(dropped, releases) ?? newest;
    movedUp = compareReleases(replacement, dropped) > 0;
    parts.push(`Snapmaker Orca ${dropped} is no longer available here, so files are now converted for ${replacement}, ${movedUp ? "the next version up" : "the newest it holds"}.`);
  }
  if (change.added.length > 0) parts.push(`Snapmaker Orca ${change.added.join(", ")} ${change.added.length === 1 ? "is" : "are"} now available here.`);
  if (dropped !== null) {
    parts.push(movedUp ? "If you've updated Snapmaker Orca, choose your version in the options." : "If you run an older version, choose it in the options.");
  } else if (change.added.length > 0) {
    if (chosen !== null) {
      parts.push(`You're still converting for ${chosen}.`);
      if (chosen !== newest) parts.push(`If you've updated Snapmaker Orca, choose ${newest} in the options.`);
    } else {
      parts.push(`Conversions now use ${newest}. If you still run an older version, choose it in the options: a file made for a newer version may not open cleanly in an older one.`);
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
