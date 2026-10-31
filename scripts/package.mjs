#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Zips each build for a store upload: dist/any2u1-<version>-chrome.zip (also for Edge) and -firefox.zip. */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));

function collect(root, dir = root, files = {}) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(root, path, files);
    // A fixed date, so the same build makes the same zip.
    else files[relative(root, path).split(sep).join("/")] = [readFileSync(path), { mtime: new Date("2026-01-01T00:00:00Z") }];
  }
  return files;
}

for (const target of ["chrome", "firefox"]) {
  const out = join(dist, `any2u1-${version}-${target}.zip`);
  writeFileSync(out, zipSync(collect(join(dist, target))));
  console.log(`${relative(dist, out)}: ${(statSync(out).size / 1024 / 1024).toFixed(1)} MB`);
}
