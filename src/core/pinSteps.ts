// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * How to pin the extension's button, in the words of each browser family's own extensions menu. No browser lets an
 * extension pin itself, so the first-run page gives these steps. The steps name no browser: one store's policy forbids
 * naming other browsers in the extension.
 */

export type BrowserFamily = "firefox" | "edge" | "chromium";

/** What a page knows about the browser it runs in. Only used to choose wording, never for anything that matters. */
export type BrowserHints = { hasGetBrowserInfo: boolean; brands: readonly string[]; userAgent: string };

export function browserFamily({ hasGetBrowserInfo, brands, userAgent }: BrowserHints): BrowserFamily {
  if (hasGetBrowserInfo) return "firefox";
  if (brands.includes("Microsoft Edge") || /\bEdg\//.test(userAgent)) return "edge";
  return "chromium";
}

export function pinSteps(family: BrowserFamily): string {
  const start = "Click the Extensions button (the puzzle piece) in the toolbar, then";
  if (family === "firefox") return `${start} the gear beside any2u1, and choose Pin to Toolbar.`;
  if (family === "edge") return `${start} the eye beside any2u1.`;
  return `${start} the pin beside any2u1.`;
}
