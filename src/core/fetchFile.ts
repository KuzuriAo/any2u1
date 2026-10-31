// SPDX-License-Identifier: AGPL-3.0-or-later
/** Fetches the one file the user chose to convert. No cookies, no referrer, a bounded read, and a check of what came back. */
import { FETCH_IDLE_MS, MAX_INPUT_BYTES } from "./limits";

export type FetchFailure =
  /** The browser refused to let the extension read it: access to the host may fix that. */
  | "blocked"
  /** It answered with an error, a web page, the wrong size or something too large: access won't help. */
  | "wrong-file";

export type FetchResult = { ok: true; bytes: Uint8Array } | { ok: false; failure: FetchFailure };

export type FetchLimits = { maxBytes?: number; idleMs?: number };

const ZIP_START = [0x50, 0x4b, 0x03, 0x04];

function startsLikeZip(bytes: Uint8Array): boolean {
  return ZIP_START.every((byte, index) => bytes[index] === byte);
}

/** Joins chunks, stopping at `maxBytes`. Null if the file is larger, or stops arriving. */
async function readAll(response: Response, controller: AbortController, maxBytes: number, idleMs: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), idleMs);
    });
    const next = await Promise.race([reader.read(), idle]);
    clearTimeout(timer);
    if (next === null) {
      controller.abort();
      return null;
    }
    if (next.done) break;
    total += next.value.byteLength;
    // A web page or an unrelated file shows in its first bytes, so there's no need to read the rest.
    if (total > maxBytes || (chunks.length === 0 && next.value.byteLength >= 4 && !startsLikeZip(next.value))) {
      controller.abort();
      return null;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * `expectedSize` is the size the browser saved, when it knows it: a mismatch means a different file,
 * a cut-short address or a soft login wall, none of which `response.ok` shows.
 */
export async function fetchFile(url: string, expectedSize: number | undefined, limits: FetchLimits = {}, fetcher: typeof fetch = fetch): Promise<FetchResult> {
  const maxBytes = limits.maxBytes ?? MAX_INPUT_BYTES;
  const controller = new AbortController();
  let response: Response;
  try {
    response = await fetcher(url, {
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
  } catch {
    return { ok: false, failure: "blocked" };
  }
  try {
    if (!response.ok || (response.url !== "" && !response.url.startsWith("https:"))) {
      controller.abort();
      return { ok: false, failure: "wrong-file" };
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      controller.abort();
      return { ok: false, failure: "wrong-file" };
    }
    const bytes = await readAll(response, controller, maxBytes, limits.idleMs ?? FETCH_IDLE_MS);
    if (bytes === null || !startsLikeZip(bytes)) return { ok: false, failure: "wrong-file" };
    if (expectedSize !== undefined && expectedSize > 0 && bytes.byteLength !== expectedSize) return { ok: false, failure: "wrong-file" };
    return { ok: true, bytes };
  } catch {
    return { ok: false, failure: "wrong-file" };
  }
}
