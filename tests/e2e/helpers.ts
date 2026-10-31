// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { zipSync } from "fflate";

export const extensionPath = fileURLToPath(new URL("../../dist/chrome", import.meta.url));
const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

export const fixturePath = (name: string) => join(fixtures, name);
export const fixture = (name: string) => readFileSync(fixturePath(name));
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const SAMPLE = "bambu-studio-2.8.4.57-beta.3mf";

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
};

export async function launch(): Promise<Session> {
  const downloads = mkdtempSync(join(tmpdir(), "extension-downloads-"));
  const profile = mkdtempSync(join(tmpdir(), "extension-profile-"));
  mkdirSync(join(profile, "Default"));
  writeFileSync(join(profile, "Default", "Preferences"), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
  });
  // The test framework's download override ignores the names the extension reads and asks for, so downloads go back to the browser's own handling.
  const first = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(first);
  await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  const requests: string[] = [];
  context.on("request", (request) => requests.push(request.url()));

  const session: Session = {
    context,
    worker,
    origin,
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

type Logged = { path: string; headers: IncomingHttpHeaders };

export type TestSite = {
  url: string;
  log: Logged[];
  close(): Promise<void>;
  /** Clicks a link on a page of this site, downloading that path, and returns when the file is saved. */
  download(session: Session, path: string): Promise<void>;
  countFor(path: string): number;
};

/** A local HTTPS site that serves files the ways real sites do. */
export async function startSite(sample: Buffer = fixture(SAMPLE)): Promise<TestSite> {
  const dir = mkdtempSync(join(tmpdir(), "extension-cert-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "2", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
  const log: Logged[] = [];
  const zip = Buffer.from(zipSync({ "a/one.3mf": sample, "b/two.3mf": sample }));
  const server: Server = createServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (request, response) => {
    const path = new URL(request.url ?? "/", "https://x").pathname;
    log.push({ path, headers: request.headers });
    const seen = log.filter((entry) => entry.path === path).length;
    const send = (body: Buffer | string, type: string, extra: Record<string, string> = {}) => {
      response.writeHead(200, { "content-type": type, ...extra });
      response.end(body);
    };
    const open = { "access-control-allow-origin": "*" };
    if (path === "/") return send("<!doctype html><title>Test site</title><link rel=\"icon\" href=\"data:,\">", "text/html");
    if (path === "/open/desk.3mf") return send(sample, "application/octet-stream", open);
    if (path === "/open/other.3mf") return send(sample, "application/octet-stream", open);
    if (path === "/closed/desk.3mf") return send(sample, "application/octet-stream");
    if (path === "/type-only/thing") return send(sample, "model/3mf", open);
    if (path === "/bundle.zip") return send(zip, "application/zip", open);
    if (path === "/prusa.3mf") return send(fixture("prusaslicer-2.9.6.3mf"), "model/3mf", open);
    // The first answer is the real file; a second look gets a login page or something else.
    if (path === "/wall/desk.3mf") return seen === 1 ? send(sample, "model/3mf", open) : send("<html>Log in</html>", "text/html", open);
    if (path === "/changed/desk.3mf") return send(seen === 1 ? sample : Buffer.concat([sample, Buffer.from("x")]), "model/3mf", open);
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const site: TestSite = {
    url,
    log,
    countFor: (path) => log.filter((entry) => entry.path === path).length,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    download: async (session, path) => {
      const page = await session.context.newPage();
      await page.goto(`${url}/`);
      await page.evaluate((href) => {
        const link = document.createElement("a");
        link.href = href;
        link.download = "";
        document.body.append(link);
        link.click();
      }, path);
      await expect.poll(() => site.countFor(path)).toBeGreaterThan(0);
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
