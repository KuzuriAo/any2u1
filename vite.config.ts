// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
// Local files imported from here, directly or through another file, need their .ts extension: Vite's native config loader requires it.
import { withoutZodEvalProbe } from "./withoutZodEvalProbe.ts";

// The version shown in a failure report. Read here so there is one source: the installed package.
const libraryVersion = (JSON.parse(readFileSync("node_modules/any2orca/package.json", "utf-8")) as { version: string }).version;

export default defineConfig({
  define: { __LIBRARY_VERSION__: JSON.stringify(libraryVersion) },
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
