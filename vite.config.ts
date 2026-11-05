// SPDX-License-Identifier: AGPL-3.0-or-later
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
// Local files imported from here, directly or through another file, need their .ts extension: Vite's native config loader requires it.
import { withoutZodEvalProbe } from "./withoutZodEvalProbe.ts";

// The version shown in a failure report. Read here so there is one source: the installed package.
const libraryVersion = (JSON.parse(readFileSync("node_modules/any2orca/package.json", "utf-8")) as { version: string }).version;

/** The commit this was built from, so that a browser still running an older build can be told from the latest. A "+" means uncommitted changes. */
function buildId(): string {
  try {
    const run = (command: string) => execSync(command, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return `${run("git rev-parse --short HEAD")}${run("git status --porcelain") === "" ? "" : "+"}`;
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  define: { __LIBRARY_VERSION__: JSON.stringify(libraryVersion), __BUILD_ID__: JSON.stringify(buildId()) },
  // Relative URLs: the extension is served from its own origin, not from a site root.
  base: "./",
  publicDir: "public",
  // The converter's worker is built separately, so the plugin goes in both lists.
  plugins: [withoutZodEvalProbe()],
  worker: { format: "es", plugins: () => [withoutZodEvalProbe()] },
  build: {
    outDir: "dist/chrome",
    rollupOptions: { input: ["convert.html", "settings.html"] },
  },
});
