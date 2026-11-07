// SPDX-License-Identifier: AGPL-3.0-or-later
/** The local HTTPS test site both browser suites download from. Each suite adds its own way to click a link on it. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { fixture, SAMPLE, superSlicerProject } from "./fixtures";

export type Logged = { path: string; headers: IncomingHttpHeaders };

export type SiteServer = {
  url: string;
  /** The port, for a browser that reaches the site through a proxy. */
  port: number;
  log: Logged[];
  close(): Promise<void>;
  countFor(path: string): number;
  /** Answers to /trickle/ still being sent: a server that starts a file and never finishes it. */
  trickling(): number;
};

/** A local HTTPS site that serves files the ways real sites do, with a throwaway self-signed certificate. */
export async function startSiteServer(sample: Buffer = fixture(SAMPLE)): Promise<SiteServer> {
  const dir = mkdtempSync(join(tmpdir(), "extension-cert-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "2", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
  const log: Logged[] = [];
  let trickling = 0;
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
    if (path === "/superslicer.3mf") return send(superSlicerProject(), "model/3mf", open);
    if (path === "/prusa.3mf") return send(fixture("prusaslicer-2.9.6-scene.3mf"), "model/3mf", open);
    // Starts like a zip, so the fetch accepts it, but isn't one.
    if (path === "/damaged.3mf") return send(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 1)]), "model/3mf", open);
    // The first answer is the real file; a second look gets a login page or something else.
    if (path === "/wall/desk.3mf") return seen === 1 ? send(sample, "model/3mf", open) : send("<html>Log in</html>", "text/html", open);
    if (path === "/changed/desk.3mf") return send(seen === 1 ? sample : Buffer.concat([sample, Buffer.from("x")]), "model/3mf", open);
    // The browser's download gets the file; a second look gets the start of a zip, then a byte a second, forever.
    if (path.startsWith("/trickle/")) {
      if (seen === 1) return send(sample, "model/3mf", open);
      response.writeHead(200, { "content-type": "model/3mf", ...open });
      response.write(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      trickling += 1;
      const timer = setInterval(() => response.write(Buffer.from([0])), 1000);
      response.on("close", () => {
        clearInterval(timer);
        trickling -= 1;
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `https://127.0.0.1:${port}`,
    port,
    log,
    countFor: (path) => log.filter((entry) => entry.path === path).length,
    trickling: () => trickling,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
