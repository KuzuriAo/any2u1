// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "vite";

export default defineConfig({
  // Relative URLs: the extension is served from its own origin, not from a site root.
  base: "./",
  publicDir: "public",
  worker: { format: "es" },
  build: {
    outDir: "dist/chrome",
    rollupOptions: { input: ["convert.html", "settings.html"] },
  },
});
