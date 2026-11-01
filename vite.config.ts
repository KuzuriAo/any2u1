// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "vite";
import { withoutZodEvalProbe } from "./withoutZodEvalProbe.ts";

export default defineConfig({
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
