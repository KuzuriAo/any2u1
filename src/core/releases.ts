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

/** The release a conversion uses: the user's choice while the catalog holds it, otherwise the newest (listed first). */
export function activeRelease(chosen: string | null, releases: readonly string[]): string | undefined {
  return chosen !== null && releases.includes(chosen) ? chosen : releases[0];
}

/** What to tell the user, or null if nothing changed for them. */
export function releaseNoticeText(change: ReleaseChange, releases: readonly string[], chosen: string | null): string | null {
  const newest = releases[0];
  if (newest === undefined) return null;
  const parts: string[] = [];
  if (change.droppedChoice !== null) parts.push(`Snapmaker Orca ${change.droppedChoice} is no longer available here, so conversions now use ${newest}, the newest.`);
  if (change.added.length > 0) {
    parts.push(`Snapmaker Orca ${change.added.join(", ")} ${change.added.length === 1 ? "is" : "are"} now available here.`);
    if (chosen !== null && change.droppedChoice === null) parts.push(`You're still converting for ${chosen}; you can change that in the options.`);
    else parts.push(`Conversions now use ${newest}. If you still run an older version, choose it in the options: a file made for a newer version may not open cleanly in an older one.`);
  } else if (change.droppedChoice !== null) {
    parts.push("If you still run an older version, choose it in the options.");
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
