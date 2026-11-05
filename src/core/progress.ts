// SPDX-License-Identifier: AGPL-3.0-or-later
/** Words for what a conversion is doing. The stage names come from the library, so an unknown one is shown plainly. */

const STAGES: Record<string, string> = {
  matching: "Matching the profile",
  "loading-profile": "Loading the profile",
  merging: "Merging the settings",
  writing: "Writing the file",
};

export function stageText(stage: unknown): string {
  return typeof stage === "string" && Object.hasOwn(STAGES, stage) ? STAGES[stage]! : "Converting";
}

/** "42 s", "1 min 05 s": time since a conversion started, so a long one is seen to be alive. */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

export function sizeText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** "45.2 of 102.6 MB" when the browser said how big the file is, otherwise just what has arrived. */
export function receivedText(received: number, total?: number): string {
  return total !== undefined && total > 0 ? `${sizeText(received)} of ${sizeText(total)}` : sizeText(received);
}
