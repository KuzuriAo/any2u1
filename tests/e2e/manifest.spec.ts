// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
const manifestOf = (target: string) => JSON.parse(readFileSync(join(dist, target, "manifest.json"), "utf-8")) as Record<string, unknown>;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

for (const target of ["chrome", "firefox"]) {
  test.describe(`${target} build`, () => {
    test("asks for exactly these permissions and no more", () => {
      const manifest = manifestOf(target);
      expect(manifest.permissions).toEqual(["downloads", "storage"]);
      expect(manifest.optional_host_permissions).toEqual(["https://*/*"]);
      for (const key of ["host_permissions", "optional_permissions", "content_scripts", "web_accessible_resources", "externally_connectable", "declarative_net_request", "content_security_policy"]) {
        expect(manifest, key).not.toHaveProperty(key);
      }
    });

    test("has a description short enough for the stores", () => {
      const description = manifestOf(target).description as string;
      expect(description.length).toBeLessThanOrEqual(132);
      expect(description.endsWith(".")).toBe(true);
    });

    test("the listing summary names the six slicers and leads with any site", () => {
      const description = manifestOf(target).description as string;
      expect(description).toMatch(/^Turn a 3MF from any site/);
      for (const slicer of ["Bambu", "Creality", "Anycubic", "Elegoo", "Flash Studio", "PrusaSlicer"]) expect(description).toContain(slicer);
    });

    test("the background script makes no request", () => {
      const code = readFileSync(join(dist, target, "background.js"), "utf-8");
      expect(code).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
    });

    test("opens no popup, which would close on the file dialog in Firefox", () => {
      expect(manifestOf(target).action).not.toHaveProperty("default_popup");
    });

    test("ships the catalog and every license notice", () => {
      const names = filesUnder(join(dist, target)).map((path) => path.slice(join(dist, target).length + 1));
      expect(names).toContain("profiles/index.json");
      for (const notice of ["licenses/any2u1-LICENSE.txt", "licenses/any2orca-LICENSE.txt", "licenses/any2orca-profiles-LICENSE.txt", "licenses/fflate-LICENSE.txt", "licenses/zod-LICENSE.txt"]) {
        expect(names).toContain(notice);
      }
    });

    test("every file is readable by anyone rebuilding it to compare", () => {
      for (const path of filesUnder(join(dist, target))) expect((statSync(path).mode & 0o777).toString(8), path).toBe("644");
    });

    test("has no code that loads from or reports to anywhere else", () => {
      for (const path of filesUnder(join(dist, target))) {
        if (!/\.(js|html)$/.test(path)) continue;
        const text = readFileSync(path, "utf-8");
        expect(text, path).not.toMatch(/<script[^>]+src="https?:/);
        expect(text, path).not.toMatch(/\beval\(|new Function\(/);
        expect(text, path).not.toContain("sendBeacon");
      }
    });
  });
}

test("the two builds differ only in how the manifest declares the background script", () => {
  const { background: chromeBackground, ...chrome } = manifestOf("chrome");
  const { background: firefoxBackground, browser_specific_settings: gecko, ...firefox } = manifestOf("firefox");
  expect(chrome).toEqual(firefox);
  expect(chromeBackground).toEqual({ service_worker: "background.js" });
  expect(firefoxBackground).toEqual({ scripts: ["background.js"] });
  expect(gecko).toMatchObject({ gecko: { id: expect.any(String), data_collection_permissions: { required: ["none"] } } });
});
