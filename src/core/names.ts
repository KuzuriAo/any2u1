// SPDX-License-Identifier: AGPL-3.0-or-later
/** File names come from sites and from inside zips, so they are untrusted. */

const MAX_NAME = 200;
/** Leaves room for `_U1.3mf` and a browser's ` (99)` under the 244 bytes Chrome keeps and the 255 most file systems allow. */
const MAX_STEM_BYTES = 200;

/** Can turn what follows around on screen: a name could show as `report.pdf` and be `report<U+202E>fdp.3mf`. */
const DIRECTION = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
/** Characters a file system or the browsers' download APIs refuse. */
const RESERVED = /[<>:"|?*]/g;
/** Controls, and line and paragraph separators. */
const BREAKS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
/** Invisible format characters (zero-width spaces and joiners, direction marks, byte-order marks, soft hyphens) and half a character. */
const INVISIBLE = /\p{Cf}|\p{Cs}/gu;
/** Spaces other than the plain one, such as the no-break space. */
const SPACES = /\p{Zs}/gu;

const encoder = new TextEncoder();

/** The end of a string, cut at `MAX_NAME` code units without leaving half a character at the front. */
function tail(text: string): string {
  return text.slice(-MAX_NAME).replace(/^[\udc00-\udfff]/, "");
}

/** The last part of a path, for display. Never used as a path. */
export function baseName(path: unknown): string {
  if (typeof path !== "string") return "";
  return tail(path.split(/[\\/]/).pop() ?? "");
}

/** A name to show: what's in it, with nothing that could reorder it on screen or break the line. */
export function displayName(name: unknown): string {
  return baseName(name).replace(DIRECTION, "").replace(BREAKS, "_");
}

/** At most `maxBytes` of UTF-8, cut between characters. */
function withinBytes(text: string, maxBytes: number): string {
  let kept = "";
  let bytes = 0;
  for (const character of text) {
    bytes += encoder.encode(character).byteLength;
    if (bytes > maxBytes) break;
    kept += character;
  }
  return kept;
}

/**
 * A name safe to hand to the browser's download API: no folders, and nothing any of the browsers refuses or changes.
 * Firefox refuses any name its own cleaning would change, which is stricter than the others, so this cleans first.
 */
export function safeFileName(name: string): string {
  const cleaned = baseName(name)
    .replace(RESERVED, "_")
    .replace(BREAKS, "_")
    .replace(INVISIBLE, "")
    .replace(SPACES, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return withinBytes(cleaned, MAX_STEM_BYTES).replace(/[.\s]+$/, "");
}

/** `thing.3mf` and `thing` both become `thing_U1.3mf`. */
export function outputName(name: string): string {
  const stem = safeFileName(baseName(name).replace(/\.3mf$/i, ""));
  return `${stem || "model"}_U1.3mf`;
}

export function is3mfName(name: string): boolean {
  return /\.3mf$/i.test(name);
}
