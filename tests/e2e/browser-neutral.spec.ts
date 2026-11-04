// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));

// One store's rules say the extension must not name other browsers, so nothing a user sees does.
test("the pages and their scripts name no browser", () => {
  const files = ["convert.html", "settings.html", ...readdirSync(join(root, "src/ui")).map((name) => `src/ui/${name}`)];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf-8")
      // Comments are for developers, not users.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(text, file).not.toMatch(/\b(Chrome|Chromium|Edge|Firefox|Safari|Opera|Brave)\b/);
  }
});
