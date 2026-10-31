// SPDX-License-Identifier: AGPL-3.0-or-later
import { convert } from "any2orca";
import { bundledProfileSource } from "any2orca/node";
import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { expectOnlyThese, fixture, fixturePath, launch, SAMPLE, savedNames, sha256, type Session } from "./helpers";

let session: Session;
test.beforeEach(async () => {
  session = await launch();
});
test.afterEach(async () => {
  await session.close();
});

const zipFile = (name: string, entries: Record<string, Uint8Array>) => ({ name, mimeType: "application/zip", buffer: Buffer.from(zipSync(entries)) });

test("the file picker hides nothing, since a 3MF can be saved with no extension", async () => {
  const page = await session.open("convert.html");
  await expect(page.locator("#file")).not.toHaveAttribute("accept");
  await expect(page.locator("#row-file")).not.toHaveAttribute("accept");
});

for (const name of [
  "bambu-studio-2.8.4.57-beta.3mf",
  "creality-print-7.3.0.6157-scene.3mf",
  "anycubic-slicer-next-2.0.0.3-scene.3mf",
  "elegoo-slicer-1.5.3.5-scene.3mf",
  "flash-studio-1.7.20-scene.3mf",
]) {
  test(`${name}: same bytes as the library, with nothing but the extension's own files requested`, async () => {
    const page = await session.open("convert.html");
    await page.setInputFiles("#file", fixturePath(name));
    const outputName = name.replace(/\.3mf$/, "_U1.3mf");
    await expect(page.locator(".converted strong")).toHaveText(outputName);
    const saved = await session.savedFile(outputName);
    const library = await convert(fixture(name), { profiles: bundledProfileSource(), highFlowHotends: false, hardenedNozzles: false });
    expect(sha256(saved)).toBe(sha256(library.output));
    expectOnlyThese(session.requests, session.origin);
  });
}

test("each option reaches the library: same bytes as asking it directly", async () => {
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  const versions = await page.locator("#orca-version option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  expect(versions.length).toBeGreaterThan(1);
  const older = versions[1]!;
  await page.selectOption("#orca-version", older);
  await page.check("#high-flow-1");
  await page.check("#high-flow-3");
  await page.check("#hardened");
  await page.selectOption("#filament-names", "snapmaker");
  await expect.poll(() => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { convert?: { filamentNames?: string } } | undefined)?.convert?.filamentNames)).toBe("snapmaker");

  await page.setInputFiles("#file", fixturePath(SAMPLE));
  const saved = await session.savedFile(SAMPLE.replace(/\.3mf$/, "_U1.3mf"));
  const library = await convert(fixture(SAMPLE), {
    profiles: bundledProfileSource(),
    snapmakerOrcaVersion: older,
    highFlowHotends: [true, false, true, false],
    hardenedNozzles: true,
    filamentComplianceMode: "snapmaker",
  });
  expect(sha256(saved)).toBe(sha256(library.output));
  // And it's different from the default, or this test would prove nothing.
  const plain = await convert(fixture(SAMPLE), { profiles: bundledProfileSource() });
  expect(sha256(saved)).not.toBe(sha256(plain.output));
});

test("options survive a reload", async () => {
  const page = await session.open("convert.html");
  await page.locator("summary").click();
  await page.check("#hardened");
  await expect.poll(() => session.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { convert?: { hardenedNozzles?: boolean } } | undefined)?.convert?.hardenedNozzles)).toBe(true);
  await page.reload();
  await page.locator("summary").click();
  await expect(page.locator("#hardened")).toBeChecked();
});

test("a zip by hand converts the 3MF files inside and skips the rest", async () => {
  const page = await session.open("convert.html");
  const sample = fixture(SAMPLE);
  await page.setInputFiles("#file", zipFile("models.zip", {
    "models/one.3mf": sample,
    "models/parts/two.3mf": sample,
    "models/stl/part.stl": strToU8("solid x"),
    "__MACOSX/models/._one.3mf": strToU8("junk"),
  }));
  await expect(page.locator(".converted strong")).toHaveText(["one_U1.3mf", "two_U1.3mf"]);
  await expect(page.locator(".failed")).toHaveCount(0);
  await session.savedFile("one_U1.3mf");
  await session.savedFile("two_U1.3mf");
  expect(savedNames(session).sort()).toEqual(["one_U1.3mf", "two_U1.3mf"]);
});

test("a damaged 3MF in a zip gets a clear message and doesn't stop the others", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", zipFile("models.zip", { "bad.3mf": strToU8("not a zip at all"), "good.3mf": fixture(SAMPLE) }));
  await expect(page.locator(".converted strong")).toHaveText("good_U1.3mf");
  await expect(page.locator(".failed strong")).toHaveText("bad.3mf");
  await expect(page.locator(".failed p")).not.toBeEmpty();
});

test("a zip with no 3MF says so, in words about a zip", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", zipFile("stl-only.zip", { "part.stl": strToU8("solid x"), "readme.txt": strToU8("hi") }));
  await expect(page.locator(".failed p")).toHaveText("This zip has no 3MF file inside, or it is damaged.");
  expect(savedNames(session)).toEqual([]);
});

test("a project from a slicer that isn't supported gets a message that names it, and saves nothing", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", fixturePath("prusaslicer-2.9.6.3mf"));
  await expect(page.locator(".failed p")).toContainText("PrusaSlicer");
  await expect(page.locator(".failed p")).toContainText("this extension");
  await expect(page.locator(".failed p")).not.toContainText("any2orca");
  expect(savedNames(session)).toEqual([]);
});

test("a file that isn't a 3MF at all gets a message", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", { name: "a.3mf", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator(".failed p")).not.toBeEmpty();
});

test("a hostile name stays text, and can't choose where the file goes", async () => {
  const page = await session.open("convert.html");
  const hostile = '<img src=x onerror=alert(1)>.3mf';
  await page.setInputFiles("#file", { name: hostile, mimeType: "model/3mf", buffer: fixture(SAMPLE) });
  await expect(page.locator(".converted strong")).toHaveText("_img src=x onerror=alert(1)__U1.3mf");
  await expect(page.locator(".converted img")).toHaveCount(0);
  await session.savedFile("_img src=x onerror=alert(1)__U1.3mf");
});

test("after saving: show in folder, and the warning about how to open the file", async () => {
  const page = await session.open("convert.html");
  await expect(page.locator("#open-tip")).toBeHidden();
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator("button.show")).toBeVisible();
  await expect(page.locator("#open-tip")).toContainText("Open as project");
});

test("the extension's own save gets no offer", async () => {
  const page = await session.open("convert.html");
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await session.savedFile(SAMPLE.replace(/\.3mf$/, "_U1.3mf"));
  await page.waitForTimeout(1000);
  expect(await session.pendingCount()).toBe(0);
  expect(session.context.pages().filter((p) => p.url().includes("view=window"))).toEqual([]);
});
