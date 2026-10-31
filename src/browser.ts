// SPDX-License-Identifier: AGPL-3.0-or-later
/** The extension API: `browser` in Firefox, `chrome` in Chrome and Edge. Both return promises in Manifest V3. */
const scope = globalThis as unknown as { browser?: typeof chrome; chrome: typeof chrome };

export const api: typeof chrome = scope.browser ?? scope.chrome;
