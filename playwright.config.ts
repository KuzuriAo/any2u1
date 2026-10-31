// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
});
