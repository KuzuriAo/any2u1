// SPDX-License-Identifier: AGPL-3.0-or-later
// The script that makes the release files, run as it is in folders made for the test.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** A folder laid out like the project, with a small build in `dist` and the real script and packages. */
function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "package-test-")));
  mkdirSync(join(root, "scripts"));
  cpSync(join(repo, "scripts/package.mjs"), join(root, "scripts/package.mjs"));
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "sample", version: "9.9.9", type: "module" }));
  for (const target of ["chrome", "firefox"]) {
    mkdirSync(join(root, "dist", target, "assets"), { recursive: true });
    writeFileSync(join(root, "dist", target, "manifest.json"), JSON.stringify({ name: target }));
    writeFileSync(join(root, "dist", target, "assets", "page.js"), "export {};\n".repeat(200));
    // A folder view's hidden file, which is never part of a build.
    writeFileSync(join(root, "dist", target, ".DS_Store"), String(Math.random()));
  }
  return root;
}

const run = (root: string, env: Record<string, string>) => execFileSync(process.execPath, [join(root, "scripts/package.mjs")], { cwd: root, encoding: "utf-8", env: { ...process.env, ...env } });
const zips = (root: string) => ["chrome", "firefox", "source"].map((name) => join(root, "dist", `any2u1-9.9.9-${name}.zip`));
const sumsOf = (root: string) => readFileSync(join(root, "dist/SHA256SUMS"), "utf-8");

describe("making the release files", () => {
  it("gives the same zips in any time zone, and SHA256SUMS holds each zip's hash", () => {
    const root = project();
    const perZone = ["America/New_York", "UTC", "Asia/Tokyo"].map((TZ) => {
      run(root, { TZ });
      const [chrome, firefox] = zips(root);
      expect(sumsOf(root)).toBe(`${sha256(chrome!)}  any2u1-9.9.9-chrome.zip\n${sha256(firefox!)}  any2u1-9.9.9-firefox.zip\n`);
      return sumsOf(root);
    });
    expect(new Set(perZone).size).toBe(1);
  });

  it("outside a git checkout, as in an unpacked source zip, says there's no source zip and ends without an error, with or without git installed", () => {
    for (const env of [{}, { PATH: "" }] as Array<Record<string, string>>) {
      const root = project();
      const output = run(root, env);
      expect(output).toContain("This folder isn't a git checkout, so no source zip was made.");
      const [chrome, firefox, source] = zips(root);
      expect([existsSync(chrome!), existsSync(firefox!), existsSync(source!)]).toEqual([true, true, false]);
      expect(sumsOf(root).split("\n").filter(Boolean)).toHaveLength(2);
    }
  });

  it("in a folder inside someone else's checkout, doesn't zip that checkout's source", () => {
    const outer = realpathSync(mkdtempSync(join(tmpdir(), "package-outer-")));
    execFileSync("git", ["init", "--quiet"], { cwd: outer });
    const root = project();
    const inner = join(outer, "unpacked");
    cpSync(root, inner, { recursive: true, verbatimSymlinks: true });
    expect(run(inner, {})).toContain("This folder isn't a git checkout, so no source zip was made.");
    expect(existsSync(zips(inner)[2]!)).toBe(false);
  });

  it("in a checkout, zips the committed source, the same in any time zone, and lists it in SHA256SUMS", () => {
    const root = project();
    writeFileSync(join(root, ".gitignore"), "dist/\nnode_modules\n");
    // A throwaway repository needs someone to commit as; nothing here is the project's own history.
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" } });
    git("init", "--quiet");
    git("add", ".gitignore", "package.json", "scripts/package.mjs");
    git("commit", "--quiet", "--no-gpg-sign", "-m", "A commit to zip");
    const perZone = ["America/New_York", "Asia/Tokyo"].map((TZ) => {
      const output = run(root, { TZ });
      expect(output).not.toContain("isn't a git checkout");
      const source = zips(root)[2]!;
      expect(sumsOf(root).split("\n")[2]).toBe(`${sha256(source)}  any2u1-9.9.9-source.zip`);
      return sha256(source);
    });
    expect(perZone[0]).toBe(perZone[1]);
  });
});
