// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Stock Firefox with the built extension, driven over WebDriver BiDi, which Firefox speaks itself, so no driver
 * program is needed. Firefox treats extension pages as privileged, and there it reports no requests, runs no preload
 * scripts and (in recent releases) won't set a file input, so:
 * - every request goes through a local proxy that logs it, and Firefox's own background requests are switched off,
 *   so whatever reaches the proxy came from a page, the extension's background page or its worker;
 * - a file goes into an input from script, after a click that starts the page's own picker;
 * - a hook on a page's workers goes on the prototype after the page has loaded.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import type { SiteServer } from "../shared/site";

export const extensionPath = fileURLToPath(new URL("../../dist/firefox", import.meta.url));
const EXTENSION_ID = "any2u1@kuzuriao.com";
const UUID = "5a1c7e0e-3f55-4b7e-9d21-0c9a7b1e2f10";
export const ORIGIN = `moz-extension://${UUID}`;

/** The Firefox to test, from FIREFOX_BINARY. The config checks it before any test runs. */
export function firefoxBinary(): string {
  const binary = process.env.FIREFOX_BINARY;
  if (!binary || !existsSync(binary) || !statSync(binary).isFile()) {
    throw new Error(`Set FIREFOX_BINARY to the Firefox program to test (it is now ${binary ? `"${binary}", which isn't a file` : "unset"}). On macOS that's for example "/Applications/Firefox.app/Contents/MacOS/firefox".`);
  }
  return binary;
}

/** Firefox's own background requests, off as in Mozilla's test profiles, so the proxy sees only what pages ask for. */
const QUIET = {
  "services.settings.server": "data:,#remote-settings-dummy/v1",
  "app.update.disabledForTesting": true,
  "app.normandy.enabled": false,
  "browser.region.update.enabled": false,
  "browser.region.network.url": "",
  "browser.safebrowsing.malware.enabled": false,
  "browser.safebrowsing.phishing.enabled": false,
  "browser.safebrowsing.downloads.enabled": false,
  "browser.safebrowsing.downloads.remote.enabled": false,
  "browser.safebrowsing.blockedURIs.enabled": false,
  "browser.safebrowsing.provider.mozilla.updateURL": "",
  "browser.safebrowsing.provider.google4.updateURL": "",
  "browser.safebrowsing.provider.google.updateURL": "",
  "browser.safebrowsing.provider.google5.updateURL": "",
  "extensions.blocklist.enabled": false,
  "extensions.getAddons.cache.enabled": false,
  "extensions.update.enabled": false,
  "extensions.systemAddon.update.enabled": false,
  "extensions.systemAddon.update.url": "",
  "media.gmp-manager.url": "",
  "media.gmp-manager.chromium-update-url": "",
  "media.gmp-gmpopenh264.autoupdate": false,
  "media.gmp-gmpopenh264.enabled": false,
  "media.gmp-widevinecdm.enabled": false,
  "network.connectivity-service.enabled": false,
  "network.captive-portal-service.enabled": false,
  "network.predictor.enabled": false,
  "network.prefetch-next": false,
  "network.dns.disablePrefetch": true,
  "network.http.speculative-parallel-limit": 0,
  "network.trr.mode": 5,
  "dom.push.connection.enabled": false,
  "toolkit.telemetry.enabled": false,
  "toolkit.telemetry.reportingpolicy.firstRun": false,
  "datareporting.healthreport.uploadEnabled": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "browser.newtabpage.enabled": false,
  "browser.startup.homepage": "about:blank",
  "browser.startup.page": 0,
  "browser.topsites.contile.enabled": false,
  "browser.shell.checkDefaultBrowser": false,
  "browser.aboutwelcome.enabled": false,
  "geo.provider.network.url": "",
  "identity.fxaccounts.enabled": false,
  "browser.translations.enable": false,
  "browser.ml.enable": false,
  "security.OCSP.enabled": 0,
  "security.remote_settings.crlite_filters.enabled": false,
  "security.remote_settings.intermediates.enabled": false,
};

/** One tab or window, by its BiDi browsing context. */
export type Tab = {
  context: string;
  /** Runs an expression in the page, with a user gesture, and returns its value through JSON. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /** Waits until an expression is true in the page. */
  until(expression: string, timeout?: number): Promise<void>;
  /** A real click with the pointer, which counts as the user's own. */
  click(selector: string): Promise<void>;
  /** Clicks `button` first if given, which starts the page's picker, then puts the files in the input. */
  setFiles(selector: string, files: Array<{ name: string; bytes: Buffer }>, button?: string): Promise<void>;
  navigate(url: string): Promise<void>;
};

export type Session = {
  downloads: string;
  /** Every request that left the browser, as the proxy saw it: "CONNECT host:port" or "HTTP url". */
  proxied: string[];
  open(path: string): Promise<Tab>;
  /** A new tab at an address outside the extension. */
  visit(url: string): Promise<Tab>;
  /** The URLs of every open tab and window. */
  urls(): Promise<string[]>;
  offerWindow(): Promise<Tab>;
  /** The frame in `parent` whose address contains `url`, once it has loaded. */
  frame(parent: Tab, url: string): Promise<Tab>;
  savedFile(name: string): Promise<Buffer>;
  /** Clicks a link on the site to that path, as a visitor would, and waits until the site has been asked for it. */
  download(site: SiteServer, path: string): Promise<void>;
  close(): Promise<void>;
};

type Remote = { type: string; value?: unknown };
type Waiter = { resolve(value: unknown): void; reject(error: Error): void; method: string };

/** A proxy that logs every request and lets through only the ones to the test site. */
async function startProxy(sitePort: number): Promise<{ close(): Promise<void>; port: number; log: string[] }> {
  const log: string[] = [];
  const tunnels = new Set<Socket>();
  const server = createServer((request, response) => {
    log.push(`HTTP ${request.url}`);
    response.writeHead(403);
    response.end();
  });
  server.on("connect", (request, socket: Socket) => {
    log.push(`CONNECT ${request.url}`);
    tunnels.add(socket);
    socket.on("close", () => tunnels.delete(socket));
    socket.on("error", () => socket.destroy());
    if (request.url !== `127.0.0.1:${sitePort}`) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = connect(sitePort, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    log,
    close: () => {
      for (const tunnel of tunnels) tunnel.destroy();
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function launch(site: SiteServer, extension: string = extensionPath): Promise<Session> {
  const binary = firefoxBinary();
  const profile = mkdtempSync(join(tmpdir(), "firefox-profile-"));
  const downloads = mkdtempSync(join(tmpdir(), "firefox-downloads-"));
  const proxy = await startProxy(site.port);
  const prefs: Record<string, string | number | boolean> = {
    ...QUIET,
    "browser.download.dir": downloads,
    "browser.download.folderList": 2,
    "browser.download.useDownloadDir": true,
    "browser.download.always_ask_before_handling_new_types": false,
    "browser.download.manager.showWhenStarting": false,
    // A known address for the extension's pages.
    "extensions.webextensions.uuids": JSON.stringify({ [EXTENSION_ID]: UUID }),
    // Accepts the host access prompt, which a driver can't reach. It only answers a request made from a real click.
    "extensions.webextOptionalPermissionPrompts": false,
    "network.proxy.type": 1,
    "network.proxy.http": "127.0.0.1",
    "network.proxy.http_port": proxy.port,
    "network.proxy.ssl": "127.0.0.1",
    "network.proxy.ssl_port": proxy.port,
    "network.proxy.no_proxies_on": "",
    "network.proxy.allow_hijacking_localhost": true,
  };
  writeFileSync(join(profile, "user.js"), Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join("\n"));

  const child: ChildProcess = spawn(binary, ["-profile", profile, "-headless", "-no-remote", "--remote-debugging-port", "0"], {
    stdio: ["ignore", "pipe", "pipe"],
    // Scripting an extension page needs system access, and release builds take the remote settings address above only
    // with the second. Only this throwaway headless browser gets them.
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1", MOZ_REMOTE_SETTINGS_DEVTOOLS: "1" },
  });
  const address = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Firefox didn't start its WebDriver BiDi server within 60 seconds")), 60_000);
    const scan = (chunk: Buffer) => {
      const match = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(String(chunk));
      if (match) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    };
    child.stdout?.on("data", scan);
    child.stderr?.on("data", scan);
    child.on("exit", (code) => reject(new Error(`Firefox exited with ${code} before it started`)));
  });

  const socket = new WebSocket(`${address}/session`);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("The WebDriver BiDi connection failed")));
  });
  let nextId = 1;
  const waiting = new Map<number, Waiter>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; type: string; result?: unknown; error?: string; message?: string };
    const waiter = message.id === undefined ? undefined : waiting.get(message.id);
    if (!waiter) return;
    waiting.delete(message.id!);
    if (message.type === "error") waiter.reject(new Error(`${waiter.method}: ${message.error} ${message.message}`));
    else waiter.resolve(message.result);
  });
  const send = <T>(method: string, params: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`${method} got no answer within 60 seconds`));
      }, 60_000);
      waiting.set(id, { method, resolve: (value) => (clearTimeout(timer), resolve(value as T)), reject: (error) => (clearTimeout(timer), reject(error)) });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send("session.new", { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  await send("webExtension.install", { extensionData: { type: "path", path: extension } });

  const tab = (context: string): Tab => {
    const evaluate = async <T>(expression: string): Promise<T> => {
      const result = await send<{ type: string; result?: Remote; exceptionDetails?: { text?: string } }>("script.evaluate", {
        expression: `(async () => JSON.stringify(await (${expression})))()`,
        target: { context },
        awaitPromise: true,
        userActivation: true,
      });
      if (result.type === "exception") throw new Error(`${result.exceptionDetails?.text ?? "script error"} in: ${expression}`);
      const text = result.result?.value;
      return (typeof text === "string" ? JSON.parse(text) : undefined) as T;
    };
    return {
      context,
      evaluate,
      until: async (expression, timeout = 30_000) => {
        await expect.poll(() => evaluate<boolean>(`!!(${expression})`).catch(() => false), { message: expression, timeout }).toBe(true);
      },
      click: async (selector) => {
        const [x, y] = await evaluate<[number, number]>(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({ block: "center" }); const r = element.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
        await send("input.performActions", {
          context,
          actions: [{ type: "pointer", id: "mouse", actions: [{ type: "pointerMove", x: Math.round(x), y: Math.round(y) }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }] }],
        });
        await send("input.releaseActions", { context });
      },
      setFiles: async (selector, files, button) => {
        const encoded = files.map((file) => ({ name: file.name, data: file.bytes.toString("base64") }));
        await evaluate(`(() => {
          ${button ? `document.querySelector(${JSON.stringify(button)}).click();` : ""}
          const transfer = new DataTransfer();
          for (const file of ${JSON.stringify(encoded)}) transfer.items.add(new File([Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))], file.name));
          const input = document.querySelector(${JSON.stringify(selector)});
          input.files = transfer.files;
          input.dispatchEvent(new Event("change"));
          return true;
        })()`);
      },
      navigate: async (url) => {
        await send("browsingContext.navigate", { context, url, wait: "complete" });
      },
    };
  };
  const tree = async () => (await send<{ contexts: Array<{ context: string; url: string }> }>("browsingContext.getTree", { maxDepth: 0 })).contexts;
  const newTab = async (url: string) => {
    const { context } = await send<{ context: string }>("browsingContext.create", { type: "tab" });
    const created = tab(context);
    await created.navigate(url);
    return created;
  };

  return {
    downloads,
    proxied: proxy.log,
    open: (path) => newTab(`${ORIGIN}/${path}`),
    visit: newTab,
    urls: async () => (await tree()).map((context) => context.url),
    offerWindow: async () => {
      let found: string | undefined;
      await expect.poll(async () => (found = (await tree()).find((context) => context.url.includes("view=window"))?.context), { message: "the offer window", timeout: 15_000 }).toBeTruthy();
      const window = tab(found!);
      await window.until(`document.readyState === "complete"`);
      return window;
    },
    frame: async (parent, url) => {
      type Tree = { contexts: Array<{ children?: Array<{ context: string; url: string }> }> };
      let found: string | undefined;
      const children = async () => (await send<Tree>("browsingContext.getTree", { root: parent.context })).contexts[0]?.children ?? [];
      await expect.poll(async () => (found = (await children()).find((child) => child.url.includes(url))?.context), { message: `the frame at ${url}`, timeout: 15_000 }).toBeTruthy();
      const frame = tab(found!);
      await frame.until(`document.readyState === "complete"`);
      return frame;
    },
    savedFile: async (name) => {
      // Firefox writes to "<name>.part" and renames it when the download is done.
      await expect.poll(() => readdirSync(downloads), { message: `${name} saved`, timeout: 30_000 }).toContain(name);
      await expect.poll(() => readdirSync(downloads).includes(`${name}.part`) || statSync(join(downloads, name)).size === 0, { timeout: 30_000 }).toBe(false);
      return readFileSync(join(downloads, name));
    },
    download: async (site, path) => {
      const page = await newTab(`${site.url}/`);
      await page.evaluate(`(() => { const link = document.createElement("a"); link.href = ${JSON.stringify(path)}; link.download = ""; document.body.append(link); link.click(); return true; })()`);
      await expect.poll(() => site.countFor(new URL(path, site.url).pathname), { message: `${path} asked for` }).toBeGreaterThan(0);
    },
    close: async () => {
      await send("session.end").catch(() => undefined);
      socket.close();
      child.kill();
      await proxy.close();
    },
  };
}
