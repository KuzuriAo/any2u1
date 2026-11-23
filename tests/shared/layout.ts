// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * How a result's filament rows are laid out, checked the same way in every browser. Nothing here imports anything, so a
 * plain Node script can load it too.
 */

/** The window an offer opens: 480 × 640 (`WINDOW_SIZE` in background.ts), less a 28 px title bar. */
export const SMALL_WINDOW = { width: 480, height: 640 - 28 };

/**
 * The desktop sizes a result is read at: the small window; the small window at 200% zoom, which halves the room in CSS
 * pixels; a wide page, where the content stops at its own width; and the small window with a 24 px default font (the
 * browsers' "very large"), which every rem size follows.
 */
export const LAYOUTS = [
  { name: "the small window", ...SMALL_WINDOW, rootFont: "" },
  { name: "the small window at 200% zoom", width: SMALL_WINDOW.width / 2, height: SMALL_WINDOW.height / 2, rootFont: "" },
  { name: "a wide page", width: 1280, height: 800, rootFont: "" },
  { name: "the small window with a 24 px default font", ...SMALL_WINDOW, rootFont: "24px" },
] as const;

export type FilamentRows = { problems: string[]; wrapped: number[] };

/**
 * What is wrong with a document's filament rows, and which rows' "was" wrapped. Nothing may reach outside its card or
 * make the page scroll sideways; a type as short as a material's name (12 characters or fewer) stays on one line; a "was"
 * that wraps starts under its name, and one that doesn't comes after it; each color sits on its name's first line. Reading a box makes the browser apply a size or font just set, so there's no
 * waiting.
 */
const CHECK = `(document) => {
  const problems = [];
  const wrapped = [];
  const page = document.documentElement;
  if (page.scrollWidth > page.clientWidth) problems.push("the page scrolls sideways: " + page.scrollWidth + " > " + page.clientWidth);
  for (const row of document.querySelectorAll(".converted .filaments li")) {
    const slot = row.querySelector(".slot").textContent;
    const card = row.closest(".converted").getBoundingClientRect();
    for (const part of row.querySelectorAll("*")) {
      const box = part.getBoundingClientRect();
      if (box.left < card.left - 0.5 || box.right > card.right + 0.5) problems.push("filament " + slot + ": its " + part.className + " reaches outside the card");
    }
    const type = row.querySelector(".type");
    const typeText = document.createRange();
    typeText.selectNodeContents(type);
    const typeLines = new Set([...typeText.getClientRects()].map((line) => Math.round(line.top))).size;
    if (typeLines > 1 && type.textContent.length <= 12) problems.push("filament " + slot + ": its type, " + type.textContent + ", is broken over " + typeLines + " lines");
    const name = row.querySelector(".fname");
    const range = document.createRange();
    range.selectNodeContents(name);
    const firstLine = range.getClientRects()[0];
    if (!firstLine) { problems.push("filament " + slot + ": no name"); continue; }
    const color = row.querySelector(".swatch").getBoundingClientRect();
    const off = (color.top + color.bottom) / 2 - (firstLine.top + firstLine.bottom) / 2;
    if (Math.abs(off) > 2) problems.push("filament " + slot + ": the color is " + off.toFixed(1) + " px off the middle of the name's first line");
    const was = row.querySelector(".was");
    if (!was) continue;
    const nameBox = name.getBoundingClientRect();
    const wasBox = was.getBoundingClientRect();
    if (wasBox.top >= nameBox.bottom - 1) {
      wrapped.push(Number(slot));
      if (Math.abs(wasBox.left - nameBox.left) > 0.5) problems.push("filament " + slot + ": the wrapped 'was' starts " + (nameBox.left - wasBox.left).toFixed(1) + " px left of its name");
    } else if (wasBox.left < nameBox.right) problems.push("filament " + slot + ": the 'was' overlaps its name");
  }
  return { problems, wrapped };
}`;

/** Run in the page after a conversion, at the size and font to check. */
export const FILAMENT_ROWS = `(${CHECK})(document)`;

/** The same, run in a page on the frame `selector` in it, for a browser that can't size the page itself. */
export const filamentRowsInFrame = (selector: string) => `(() => { const frame = document.querySelector(${JSON.stringify(selector)}); return (${CHECK})(frame.contentDocument); })()`;
