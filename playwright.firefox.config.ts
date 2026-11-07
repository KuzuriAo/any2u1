// SPDX-License-Identifier: AGPL-3.0-or-later
// The Firefox suite: stock Firefox from FIREFOX_BINARY, driven over WebDriver BiDi. Only the test runner comes from
// Playwright, not its browsers.
import { defineConfig } from "@playwright/test";
import { firefoxBinary } from "./tests/firefox/firefox";

firefoxBinary();

export default defineConfig({
  testDir: "tests/firefox",
  testMatch: "*.spec.ts",
  timeout: 90_000,
  workers: 1,
  reporter: "list",
});
