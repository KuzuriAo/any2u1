// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { fetchFile } from "../../src/core/fetchFile";

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

function answering(body: BodyInit | null, init: ResponseInit = {}, url = "https://cdn.example/a.3mf"): typeof fetch {
  return (async () => {
    const response = new Response(body, init);
    Object.defineProperty(response, "url", { value: url });
    return response;
  }) as typeof fetch;
}

describe("fetchFile", () => {
  it("returns the bytes of a file the right size", async () => {
    const result = await fetchFile("https://cdn.example/a.3mf", ZIP.byteLength, {}, answering(ZIP));
    expect(result).toEqual({ ok: true, bytes: ZIP });
  });
  it("sends no cookies and no referrer", async () => {
    let seen: RequestInit | undefined;
    const fetcher = (async (_: unknown, init?: RequestInit) => {
      seen = init;
      return new Response(ZIP);
    }) as typeof fetch;
    await fetchFile("https://cdn.example/a.3mf", undefined, {}, fetcher);
    expect(seen).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  });
  it("skips the size check when the browser doesn't know the size", async () => {
    expect((await fetchFile("https://x.example/a", undefined, {}, answering(ZIP))).ok).toBe(true);
    expect((await fetchFile("https://x.example/a", -1, {}, answering(ZIP))).ok).toBe(true);
    expect((await fetchFile("https://x.example/a", 0, {}, answering(ZIP))).ok).toBe(true);
  });
  it("calls a refused request blocked, which is what access can fix", async () => {
    const fetcher = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await fetchFile("https://x.example/a", 8, {}, fetcher)).toEqual({ ok: false, failure: "blocked" });
  });
  it.each([
    ["an error status", answering(ZIP, { status: 403 })],
    ["a soft login wall", answering("<html>log in</html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["a cut-short copy that still starts like a zip", answering(ZIP.slice(0, 5))],
    ["an empty answer", answering(null)],
    ["a redirect off https", answering(ZIP, {}, "http://cdn.example/a.3mf")],
    ["a declared size over the limit", answering(ZIP, { headers: { "content-length": "99999" } })],
  ])("rejects %s as the wrong file", async (_, fetcher) => {
    expect(await fetchFile("https://x.example/a", ZIP.byteLength, { maxBytes: 1000 }, fetcher)).toEqual({ ok: false, failure: "wrong-file" });
  });
  it("stops reading once past the limit, even when no size is declared", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(ZIP);
      },
    });
    const result = await fetchFile("https://x.example/a", undefined, { maxBytes: 64 }, answering(endless));
    expect(result).toEqual({ ok: false, failure: "wrong-file" });
    expect(pulled).toBeLessThan(20);
  });
  it("stops reading once past the size the browser saved, well before the size limit", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(ZIP);
      },
    });
    expect(await fetchFile("https://x.example/a", ZIP.byteLength * 3, {}, answering(endless))).toEqual({ ok: false, failure: "wrong-file" });
    expect(pulled).toBeLessThan(10);
  });
  it("refuses a declared size over the saved size without reading", async () => {
    expect(await fetchFile("https://x.example/a", ZIP.byteLength, {}, answering(ZIP, { headers: { "content-length": "999999" } }))).toEqual({ ok: false, failure: "wrong-file" });
  });
  it("stops when the caller gives up, and says so", async () => {
    // Like a browser's fetch: the body stops with an error once the request's signal aborts.
    let aborted = false;
    const fetcher = (async (_: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(ZIP);
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            controller.error(new DOMException("The operation was aborted.", "AbortError"));
          });
        },
      });
      return new Response(body);
    }) as typeof fetch;
    const caller = new AbortController();
    const result = fetchFile("https://x.example/a", undefined, { idleMs: 60_000, signal: caller.signal }, fetcher);
    await new Promise((resolve) => setTimeout(resolve, 20));
    caller.abort();
    expect(await result).toEqual({ ok: false, failure: "stopped" });
    expect(aborted).toBe(true);
  });
  it("does nothing for a caller that already gave up", async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return new Response(ZIP);
    }) as typeof fetch;
    const caller = new AbortController();
    caller.abort();
    expect(await fetchFile("https://x.example/a", undefined, { signal: caller.signal }, fetcher)).toEqual({ ok: false, failure: "stopped" });
    expect(called).toBe(false);
  });
  it("reports what has arrived after each piece", async () => {
    const seen: number[] = [];
    const pieces = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(ZIP);
        controller.enqueue(new Uint8Array(3));
        controller.close();
      },
    });
    await fetchFile("https://x.example/a", undefined, { onProgress: (received) => seen.push(received) }, answering(pieces));
    expect(seen).toEqual([ZIP.byteLength, ZIP.byteLength + 3]);
  });
  it("gives up on a file that stops arriving", async () => {
    const stuck = new ReadableStream<Uint8Array>({ start: (controller) => controller.enqueue(ZIP) });
    expect(await fetchFile("https://x.example/a", undefined, { idleMs: 20 }, answering(stuck))).toEqual({ ok: false, failure: "wrong-file" });
  });
});
