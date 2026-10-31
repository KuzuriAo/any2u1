// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";
import { fixture, launch, SAMPLE } from "./helpers";

test("a project over 100 MB converts in the tab", async () => {
  test.setTimeout(240_000);
  // Random bytes don't compress, so the file on disk really is this large.
  const entries = unzipSync(fixture(SAMPLE));
  entries["Metadata/padding.bin"] = randomBytes(120 * 1024 * 1024);
  const path = join(mkdtempSync(join(tmpdir(), "extension-large-")), "large.3mf");
  writeFileSync(path, zipSync(entries, { level: 0 }));

  const session = await launch();
  try {
    const page = await session.open("convert.html");
    const started = Date.now();
    await page.setInputFiles("#file", path);
    await expect(page.locator(".converted strong")).toHaveText("large_U1.3mf", { timeout: 200_000 });
    const saved = await session.savedFile("large_U1.3mf");
    console.log(`Converted in ${Date.now() - started} ms; output ${saved.byteLength} bytes.`);
    expect(saved.byteLength).toBeGreaterThan(1000);
  } finally {
    await session.close();
  }
});
