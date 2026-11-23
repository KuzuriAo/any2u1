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

    test("never runs in private windows, so nothing from one reaches a normal window or the downloads list", () => {
      expect(manifestOf(target).incognito).toBe("not_allowed");
    });

    test("is named for store search, short enough for every store", () => {
      const name = manifestOf(target).name as string;
      expect(name).toBe("any2u1: 3MF to Snapmaker U1");
      expect(name.length).toBeLessThanOrEqual(45);
    });

    test("has a description short enough for the stores", () => {
      const description = manifestOf(target).description as string;
      expect(description.length).toBeLessThanOrEqual(132);
      expect(description.endsWith(".")).toBe(true);
    });

    test("the listing summary leads with any site and names at most five slicer makers, the rest as others", () => {
      const description = manifestOf(target).description as string;
      expect(description).toMatch(/^Turn a 3MF from any site/);
      // The Chrome Web Store's spam rules: "do not list more than five" brands in the description.
      const named = ["Bambu", "Creality", "Anycubic", "Elegoo", "Flash Studio", "Prusa", "QIDI"].filter((slicer) => description.includes(slicer));
      expect(named).toEqual(["Bambu", "Creality", "Anycubic", "Elegoo", "Prusa"]);
      expect(description).toMatch(/ and others\.$/);
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

test("the two builds differ only in how the manifest declares the background script and the oldest browser", () => {
  const { background: chromeBackground, minimum_chrome_version: oldestChrome, ...chrome } = manifestOf("chrome");
  const { background: firefoxBackground, browser_specific_settings: gecko, ...firefox } = manifestOf("firefox");
  expect(chrome).toEqual(firefox);
  expect(chromeBackground).toEqual({ service_worker: "background.js" });
  expect(oldestChrome).toBe("111");
  expect(firefoxBackground).toEqual({ scripts: ["background.js"] });
  expect(gecko).toMatchObject({ gecko: { id: expect.any(String), data_collection_permissions: { required: ["none"] } } });
});

test("Firefox needs a supported desktop release, and nothing claims Firefox for Android", () => {
  const settings = manifestOf("firefox").browser_specific_settings as { gecko: { strict_min_version?: string } };
  // 153 is the oldest supported ESR. Firefox for Android has had no downloads API since 79, so the extension can't run there.
  expect(settings.gecko.strict_min_version).toBe("153.0");
  expect(settings).not.toHaveProperty("gecko_android");
});

test("Chrome and Edge need a release the build is written for, with every API the background script calls", async () => {
  // The browsers the build tool writes code for, as this project's own configuration resolves; a change there has to
  // change the manifest too.
  const { resolveConfig } = await import("vite");
  const targets = (await resolveConfig({ root: fileURLToPath(new URL("../..", import.meta.url)), logLevel: "silent" }, "build")).build.target;
  const chromeTarget = (Array.isArray(targets) ? targets : [targets]).find((target): target is string => typeof target === "string" && target.startsWith("chrome"));
  const written = Number(chromeTarget!.slice("chrome".length));
  const oldest = Number(manifestOf("chrome").minimum_chrome_version);
  expect(oldest).toBeGreaterThanOrEqual(written);
  // action.setBadgeTextColor is in Chrome 110 and newer; storage.session in 102.
  expect(oldest).toBeGreaterThanOrEqual(110);
  expect(manifestOf("firefox")).not.toHaveProperty("minimum_chrome_version");
});
