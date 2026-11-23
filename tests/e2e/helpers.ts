// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { SMALL_WINDOW } from "../shared/layout";
import { startSiteServer, type SiteServer } from "../shared/site";

export { fixture, fixturePath, libraryVersion, longNamesProject, plateNotesProject, POLYMAKER, PRUSA_FIXTURES, SAMPLE, sha256, sharedToolheadProject, superSlicerProject } from "../shared/fixtures";

export const extensionPath = fileURLToPath(new URL("../../dist/chrome", import.meta.url));

/** A real browser with the built extension loaded, saving downloads under their real names. */
export type Session = {
  context: BrowserContext;
  worker: Worker;
  origin: string;
  downloads: string;
  requests: string[];
  close(): Promise<void>;
  open(path: string): Promise<Page>;
  offerWindow(): Promise<Page>;
  savedFile(name: string): Promise<Buffer>;
  pendingCount(): Promise<number>;
  /** The tab the install opened (`convert.html?view=welcome`), when launched with `keepWelcome`; otherwise closed at launch. */
  welcome?: Page;
};

/**
 * Starts a browser with the built extension, or with the copy of it at `extension`. Installing it opens the first-run
 * tab; launch waits for it and closes it, so no test sees a tab appear partway through, unless `keepWelcome` is set.
 */
export async function launch(extension: string = extensionPath, { keepWelcome = false }: { keepWelcome?: boolean } = {}): Promise<Session> {
  const downloads = mkdtempSync(join(tmpdir(), "extension-downloads-"));
  const profile = mkdtempSync(join(tmpdir(), "extension-profile-"));
  mkdirSync(join(profile, "Default"));
  writeFileSync(join(profile, "Default", "Preferences"), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
  });
  // The test framework's download override ignores the names the extension reads and asks for, so downloads go back to the browser's own handling.
  const first = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(first);
  await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  const isWelcome = (page: Page) => page.url().includes("view=welcome");
  const welcome = context.pages().find(isWelcome) ?? (await context.waitForEvent("page", { predicate: isWelcome, timeout: 15_000 }));
  if (!keepWelcome) await welcome.close();
  const requests: string[] = [];
  context.on("request", (request) => requests.push(request.url()));

  const session: Session = {
    context,
    worker,
    origin,
    ...(keepWelcome ? { welcome } : {}),
    downloads,
    requests,
    close: () => context.close(),
    open: async (path) => {
      const page = await context.newPage();
      await page.goto(`${origin}/${path}`);
      return page;
    },
    offerWindow: async () => {
      const existing = context.pages().find((page) => page.url().includes("view=window"));
      const page = existing ?? (await context.waitForEvent("page", { predicate: (p) => p.url().includes("view=window"), timeout: 15_000 }));
      // The test browser makes every window 1280 × 720, this one too, so it gets the size the extension opens it at.
      await page.setViewportSize(SMALL_WINDOW);
      // The file dialog goes through the plain input, which a test can answer.
      await page.evaluate(() => {
        (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = undefined;
      });
      return page;
    },
    savedFile: async (name) => {
      await expect.poll(() => readdirSync(downloads), { timeout: 15_000 }).toContain(name);
      await expect.poll(() => statSync(join(downloads, name)).size).toBeGreaterThan(0);
      return readFileSync(join(downloads, name));
    },
    pendingCount: () =>
      worker.evaluate(async () => {
        const all = await chrome.storage.session.get(null);
        return Object.keys(all).filter((key) => key.startsWith("pending:")).length;
      }),
  };
  return session;
}

export const offerWindows = (session: Session) => session.context.pages().filter((page) => page.url().includes("view=window"));
export const savedNames = (session: Session) => readdirSync(session.downloads).filter((name) => !name.endsWith(".crdownload"));

/** Sets the extension's settings as the settings page would store them. */
export async function setSettings(session: Session, settings: Record<string, unknown>): Promise<void> {
  await session.worker.evaluate((value) => chrome.storage.local.set({ settings: value }), settings);
}

export type TestSite = SiteServer & {
  /** Clicks a link on a page of this site to that path or address, and returns once this site has been asked for it. */
  download(session: Session, path: string): Promise<void>;
};

/** The shared test site, with a link click in this suite's browser. */
export async function startSite(sample?: Buffer): Promise<TestSite> {
  const server = await startSiteServer(sample);
  const site: TestSite = {
    ...server,
    download: async (session, path) => {
      const page = await session.context.newPage();
      await page.goto(`${server.url}/`);
      await page.evaluate((href) => {
        const link = document.createElement("a");
        link.href = href;
        link.download = "";
        document.body.append(link);
        link.click();
      }, path);
      await expect.poll(() => server.countFor(new URL(path, server.url).pathname)).toBeGreaterThan(0);
    },
  };
  return site;
}

/** Downloads bytes the page builds itself, the way a site makes a `blob:` download, and revokes the link. */
export async function downloadBlob(session: Session, site: TestSite, name: string, bytes: Buffer): Promise<void> {
  const page = await session.context.newPage();
  await page.goto(`${site.url}/`);
  await page.evaluate(({ name: fileName, base64 }) => {
    const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([data], { type: "text/plain" }));
    link.download = fileName;
    document.body.append(link);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 200);
  }, { name, base64: bytes.toString("base64") });
}

/** Every request must be the extension's own file, or one of the given addresses. */
export function expectOnlyThese(requests: string[], origin: string, allowed: string[] = []): void {
  expect(requests.length).toBeGreaterThan(0);
  for (const url of requests) {
    if (url.startsWith("blob:") || url.startsWith("data:") || url === "about:blank") continue;
    expect(url.startsWith(`${origin}/`) || allowed.some((prefix) => url.startsWith(prefix)), url).toBe(true);
  }
}
