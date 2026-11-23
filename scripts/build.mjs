#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Builds the extension from one source: dist/chrome (also for Edge) and dist/firefox.
 * The two differ only in their manifest. The catalog and the license notices ship inside.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const dist = join(root, "dist");
const chrome = join(dist, "chrome");
const firefox = join(dist, "firefox");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

rmSync(dist, { recursive: true, force: true });

await build({ root, logLevel: "warn" });

// One classic script with nothing to import, for a service worker and a Firefox background script alike.
await build({
  root,
  configFile: false,
  logLevel: "warn",
  publicDir: false,
  build: {
    outDir: chrome,
    emptyOutDir: false,
    lib: { entry: join(root, "src/background.ts"), formats: ["iife"], name: "any2u1Background", fileName: () => "background.js" },
  },
});

const packageDir = (name) => dirname(require.resolve(`${name}/package.json`));
cpSync(join(packageDir("any2orca-profiles"), "data"), join(chrome, "profiles"), { recursive: true });

// Every package bundled into the extension, with its license notices.
const licenses = join(chrome, "licenses");
mkdirSync(licenses, { recursive: true });
cpSync(join(root, "LICENSE"), join(licenses, "any2u1-LICENSE.txt"));
const bundled = ["any2orca", "any2orca-profiles", "fflate", "zod"];
for (const name of bundled) {
  for (const file of ["LICENSE", "LICENSE.md", "NOTICE"]) {
    const source = join(packageDir(name), file);
    if (existsSync(source)) cpSync(source, join(licenses, `${name}-${file.replace(".md", "")}.txt`));
  }
}
writeFileSync(join(licenses, "README.txt"), [
  `any2u1 ${version} is licensed under the GNU Affero General Public License, version 3 or later (any2u1-LICENSE.txt).`,
  "Its source code is at https://github.com/KuzuriAo/any2u1.",
  "",
  "It bundles these packages, whose license notices are in this folder:",
  ...bundled.map((name) => {
    const info = JSON.parse(readFileSync(join(packageDir(name), "package.json"), "utf-8"));
    return `- ${name} ${info.version} (${info.license})`;
  }),
  "",
].join("\n"));

const base = {
  manifest_version: 3,
  // The stores' listing title: the brand, then what it does, for store search (45 characters at most, Edge's and Firefox's limit).
  name: "any2u1: 3MF to Snapmaker U1",
  version,
  description: "Turn a 3MF from any site into a Snapmaker U1 file, on your device. Bambu, Creality, Anycubic, Elegoo, Flash Studio, Prusa, QIDI.",
  permissions: ["downloads", "storage"],
  optional_host_permissions: ["https://*/*"],
  action: {
    default_title: "Convert for Snapmaker U1",
    default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png" },
  },
  icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
  options_ui: { page: "settings.html", open_in_tab: true },
  // Never in private windows: one copy of the extension serves both kinds of window, so a private download's offer would
  // open in a normal window and its converted file would stay in the normal downloads list after the private window closed.
  incognito: "not_allowed",
};

// The oldest Chrome (and Edge, by its Chromium version) this works in, so a store offers it to no older one: the build
// tool writes code for Chrome 111 and newer by default, and the badge's text color (action.setBadgeTextColor) needs 110.
writeFileSync(join(chrome, "manifest.json"), `${JSON.stringify({ ...base, minimum_chrome_version: "111", background: { service_worker: "background.js" } }, null, 2)}\n`);

cpSync(chrome, firefox, { recursive: true });
writeFileSync(join(firefox, "manifest.json"), `${JSON.stringify({
  ...base,
  background: { scripts: ["background.js"] },
  browser_specific_settings: {
    gecko: { id: "any2u1@kuzuriao.com", strict_min_version: "153.0", data_collection_permissions: { required: ["none"] } },
  },
}, null, 2)}\n`);

// Plain modes on everything, whatever the copies inherited, so anyone rebuilding this can read and compare every file.
function plainModes(dir) {
  chmodSync(dir, 0o755);
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) plainModes(path);
    else chmodSync(path, 0o644);
  }
}
plainModes(dist);

console.log(`Built any2u1 ${version}: dist/chrome (Chrome, Edge) and dist/firefox.`);
