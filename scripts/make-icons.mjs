#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Draws public/icons/*.png from assets/icon.svg. Run by hand after changing the icon; the PNGs are committed. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const svg = readFileSync(fileURLToPath(new URL("../assets/icon.svg", import.meta.url)), "utf-8");
const browser = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<!doctype html><style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: fileURLToPath(new URL(`../public/icons/icon-${size}.png`, import.meta.url)), omitBackground: true });
  await page.close();
}
await browser.close();
