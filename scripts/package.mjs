#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Zips each build for a store upload, dist/any2u1-<version>-chrome.zip (also for Edge) and -firefox.zip, plus
 * dist/any2u1-<version>-source.zip of the committed source, which Firefox's reviewers rebuild and compare.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

function collect(base, dir = base, files = {}) {
  for (const name of readdirSync(dir).sort()) {
    // Hidden files (a folder view's .DS_Store, say) aren't part of the build and would break a comparison.
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(base, path, files);
    // A fixed date, so the same build makes the same zip.
    else files[relative(base, path).split(sep).join("/")] = [readFileSync(path), { mtime: new Date("2026-01-01T00:00:00Z") }];
  }
  return files;
}

const sizeOf = (path) => `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`;

for (const target of ["chrome", "firefox"]) {
  const out = join(dist, `any2u1-${version}-${target}.zip`);
  writeFileSync(out, zipSync(collect(join(dist, target))));
  console.log(`${relative(dist, out)}: ${sizeOf(out)}`);
}

// The source as committed. Uncommitted changes aren't in it, so say so rather than ship a mismatch.
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf-8" }).trim();
if (dirty !== "") console.warn("Warning: uncommitted changes aren't in the source zip, so it may not rebuild into these extension zips.");
const source = join(dist, `any2u1-${version}-source.zip`);
execFileSync("git", ["archive", "--format=zip", `--output=${source}`, "HEAD"], { cwd: root });
console.log(`${relative(dist, source)}: ${sizeOf(source)}`);
