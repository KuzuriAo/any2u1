// SPDX-License-Identifier: AGPL-3.0-or-later
/** What one browser tab is asked to hold. The library's own 2 GB limit on an unpacked project still applies. */
export const MAX_INPUT_BYTES = 1024 * 1024 * 1024;
/** The most 3MF files converted from one zip. */
export const MAX_FILES_IN_ZIP = 50;
/** The most files taken in one pick or drop. */
export const MAX_FILES_AT_ONCE = 20;
/** The most downloads waiting at once; the oldest goes first. */
export const MAX_PENDING = 20;
/** A fetch that receives nothing for this long is given up on. */
export const FETCH_IDLE_MS = 60_000;
