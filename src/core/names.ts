// SPDX-License-Identifier: AGPL-3.0-or-later
/** File names come from sites and from inside zips, so they are untrusted. */

const MAX_NAME = 200;

/** The last part of a path, for display. Never used as a path. */
export function baseName(path: unknown): string {
  if (typeof path !== "string") return "";
  return (path.split(/[\\/]/).pop() ?? "").slice(-MAX_NAME);
}

/** A name safe to hand to the browser's download API: no folders, control characters or direction overrides. */
export function safeFileName(name: string): string {
  return baseName(name)
    .replace(/[<>:"|?*\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 150);
}

/** `thing.3mf` and `thing` both become `thing_U1.3mf`. */
export function outputName(name: string): string {
  const stem = safeFileName(baseName(name).replace(/\.3mf$/i, ""));
  return `${stem || "model"}_U1.3mf`;
}

export function is3mfName(name: string): boolean {
  return /\.3mf$/i.test(name);
}
