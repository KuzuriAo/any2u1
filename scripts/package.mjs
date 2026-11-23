#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Zips each build for a store upload, dist/any2u1-<version>-chrome.zip (also for Edge) and -firefox.zip, plus
 * dist/any2u1-<version>-source.zip of the committed source, which Firefox's reviewers rebuild and compare, and
 * dist/SHA256SUMS with the SHA-256 of each zip. Outside a git checkout, as in an unpacked source zip, there is no
 * committed source to zip, so the source zip is left out.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
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
    // A fixed date, so the same build makes the same zip. A zip stores local time, so the date is given in local
    // time: every machine then writes 2026-01-01 00:00, whatever its time zone.
    else files[relative(base, path).split(sep).join("/")] = [readFileSync(path), { mtime: new Date(2026, 0, 1) }];
  }
  return files;
}

const sizeOf = (path) => `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`;
const made = [];

for (const target of ["chrome", "firefox"]) {
  const out = join(dist, `any2u1-${version}-${target}.zip`);
  writeFileSync(out, zipSync(collect(join(dist, target))));
  made.push(out);
  console.log(`${relative(dist, out)}: ${sizeOf(out)}`);
}

/** Whether this folder is a git checkout of its own: git is installed, and the checkout's top folder is this one, not one around it. */
function ownCheckout() {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return realpathSync(top) === realpathSync(root);
  } catch {
    return false;
  }
}

if (ownCheckout()) {
  // The source as committed. Uncommitted changes aren't in it, so say so rather than ship a mismatch.
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf-8" }).trim();
  if (dirty !== "") console.warn("Warning: uncommitted changes aren't in the source zip, so it may not rebuild into these extension zips.");
  const source = join(dist, `any2u1-${version}-source.zip`);
  // git writes the commit's time into the zip as local time too, so it gets one time zone.
  execFileSync("git", ["archive", "--format=zip", `--output=${source}`, "HEAD"], { cwd: root, env: { ...process.env, TZ: "UTC" } });
  made.push(source);
  console.log(`${relative(dist, source)}: ${sizeOf(source)}`);
} else {
  console.log("This folder isn't a git checkout, so no source zip was made.");
}

// One line per zip, in the form `sha256sum --check` reads.
const sums = made.map((path) => `${createHash("sha256").update(readFileSync(path)).digest("hex")}  ${relative(dist, path)}\n`).join("");
writeFileSync(join(dist, "SHA256SUMS"), sums);
process.stdout.write(`SHA256SUMS:\n${sums}`);
