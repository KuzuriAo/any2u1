// SPDX-License-Identifier: AGPL-3.0-or-later
/** Which downloads get an offer, and where each one's bytes can come from. Every field here comes from a site. */
import { baseName, is3mfName } from "./names";

export type DownloadFacts = {
  url?: string;
  finalUrl?: string;
  filename?: string;
  mime?: string;
  referrer?: string;
  byExtensionId?: string;
};

const THREE_MF_TYPES = new Set(["model/3mf", "application/vnd.ms-package.3dmanufacturing-3dmodel+xml"]);
/** A name with one of these is that kind of file, whatever its address or type says. No offer on a zip: a download alone doesn't show what it holds. */
const OTHER_FILE = /\.(zip|rar|7z|tar|gz|stl|step|stp|obj|amf|gcode|png|jpe?g|pdf|html?|txt)$/i;

function parse(address: unknown): URL | null {
  if (typeof address !== "string" || address === "") return null;
  try {
    return new URL(address);
  } catch {
    return null;
  }
}

function pathIs3mf(address: unknown): boolean {
  const url = parse(address);
  return url !== null && (url.protocol === "https:" || url.protocol === "http:") && /\.3mf$/i.test(url.pathname);
}

/** The browser's type is often generic or wrong, so the name decides first. */
export function is3mfDownload(item: DownloadFacts): boolean {
  const name = baseName(item.filename);
  if (is3mfName(name)) return true;
  if (OTHER_FILE.test(name)) return false;
  return THREE_MF_TYPES.has(String(item.mime ?? "").toLowerCase()) || pathIs3mf(item.finalUrl) || pathIs3mf(item.url);
}

/** A save made by this extension. `byExtensionId` alone misses some of them in Chrome and Edge, so the address counts too. */
export function isOwnDownload(item: DownloadFacts, extensionId: string, extensionBase: string): boolean {
  if (item.byExtensionId === extensionId) return true;
  return [item.url, item.finalUrl].some((address) => typeof address === "string" && address.replace(/^blob:/, "").startsWith(extensionBase));
}

/** The address the file came from last: Firefox has no `finalUrl`, and its `url` is already past any redirect. */
function fileAddress(item: DownloadFacts): string | undefined {
  return item.finalUrl || item.url;
}

function hostOf(address: unknown): string | null {
  const url = parse(address);
  if (url === null) return null;
  // A blob: address names the page that made it.
  const inner = url.protocol === "blob:" ? parse(url.pathname) : url;
  if (inner === null || (inner.protocol !== "https:" && inner.protocol !== "http:")) return null;
  return inner.hostname.replace(/^www\./, "").toLowerCase() || null;
}

/** Every host this download can be known by. The browser doesn't always report a referrer, and that varies by browser. */
export function hostsOf(item: DownloadFacts): string[] {
  return [hostOf(item.referrer), hostOf(fileAddress(item))].filter((host): host is string => host !== null);
}

/** The name to show for where a download came from: the page if the browser says, otherwise the file's host. */
export function siteOf(item: DownloadFacts): string | null {
  return hostsOf(item)[0] ?? null;
}

export type Delivery =
  /** A web address the extension can try to fetch. `origin` is the access to ask for: this one host only. */
  | { kind: "fetch"; url: string; host: string; origin: string }
  /** Built in the page, or otherwise impossible to fetch again: the user hands over the saved file. */
  | { kind: "pick" };

export function deliveryOf(item: DownloadFacts): Delivery {
  const url = parse(fileAddress(item));
  if (url === null || url.protocol !== "https:" || url.hostname === "") return { kind: "pick" };
  return { kind: "fetch", url: url.href, host: url.hostname, origin: `https://${url.hostname}/*` };
}
