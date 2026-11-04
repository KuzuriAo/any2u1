// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page } from "@playwright/test";
import { fixture, fixturePath, launch, SAMPLE, type Session } from "./helpers";

let session: Session;
test.beforeEach(async () => {
  session = await launch();
});
test.afterEach(async () => {
  await session.close();
});

/** Opens the convert page with a hook on its workers: one can be told to swallow requests, or made to fail. */
async function openWithWorkerHook(): Promise<Page> {
  const page = await session.context.newPage();
  await page.addInitScript(() => {
    const scope = window as unknown as { Worker: typeof Worker; workers: Worker[]; swallow: boolean };
    const Real = scope.Worker;
    scope.workers = [];
    scope.swallow = false;
    scope.Worker = class extends Real {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        scope.workers.push(this);
      }
      override postMessage(message: unknown, transfer?: unknown) {
        if (scope.swallow && (message as { op?: string }).op === "open") return;
        super.postMessage(message, transfer as Transferable[]);
      }
    };
  });
  await page.goto(`${session.origin}/convert.html`);
  await expect(page.locator("#options-version")).toContainText("Snapmaker Orca");
  return page;
}

/** What a worker that runs out of memory looks like from the page. */
const failLatestWorker = (page: Page) =>
  page.evaluate(() => {
    const workers = (window as unknown as { workers: Worker[] }).workers;
    const worker = workers[workers.length - 1]!;
    worker.dispatchEvent(new ErrorEvent("error", { message: "out of memory" }));
    worker.terminate();
    return workers.length;
  });

test("a worker that fails mid-conversion: the file gets a message, and the next file converts in a new worker", async () => {
  const page = await openWithWorkerHook();
  await page.evaluate(() => ((window as unknown as { swallow: boolean }).swallow = true));
  await page.setInputFiles("#file", { name: "stuck.3mf", mimeType: "model/3mf", buffer: fixture(SAMPLE) });
  await expect(page.locator("#status")).toContainText("Converting stuck.3mf");
  expect(await failLatestWorker(page)).toBe(1);
  await expect(page.locator(".failed strong")).toHaveText("stuck.3mf");
  await expect(page.locator(".failed p")).toContainText("ran out of memory");
  await page.locator(".failed .report-text summary").click();
  await expect(page.locator(".failed .report-text pre")).toContainText("Error: worker_stopped");

  await page.evaluate(() => ((window as unknown as { swallow: boolean }).swallow = false));
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".converted strong")).toHaveText(SAMPLE.replace(/\.3mf$/, "_U1.3mf"));
  expect(await page.evaluate(() => (window as unknown as { workers: Worker[] }).workers.length)).toBe(2);
});

test("a worker that fails while idle: the next file still converts", async () => {
  const page = await openWithWorkerHook();
  await failLatestWorker(page);
  await page.setInputFiles("#file", fixturePath(SAMPLE));
  await expect(page.locator(".converted strong")).toHaveText(SAMPLE.replace(/\.3mf$/, "_U1.3mf"));
});
