// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { deliveryOf, hostsOf, is3mfDownload, isOwnDownload, siteOf } from "../../src/core/recognize";

describe("is3mfDownload", () => {
  it("goes by the file name first, since the browser's type is often wrong", () => {
    expect(is3mfDownload({ filename: "/d/a.3mf", mime: "text/plain" })).toBe(true);
    expect(is3mfDownload({ filename: "C:\\d\\A.3MF", mime: "application/octet-stream" })).toBe(true);
  });
  it("recognizes a file saved with no extension by its type", () => {
    expect(is3mfDownload({ filename: "/d/thing", mime: "model/3mf" })).toBe(true);
    expect(is3mfDownload({ filename: "/d/thing", mime: "MODEL/3MF" })).toBe(true);
  });
  it("recognizes one by its address when the name says nothing", () => {
    expect(is3mfDownload({ filename: "", url: "https://cdn.example/a/b.3mf?sig=1" })).toBe(true);
    expect(is3mfDownload({ filename: "x", url: "https://e.example/get", finalUrl: "https://cdn.example/b.3mf" })).toBe(true);
  });
  it("makes no offer on a zip or another kind of file, whatever the address says", () => {
    expect(is3mfDownload({ filename: "/d/a.zip", mime: "application/zip" })).toBe(false);
    expect(is3mfDownload({ filename: "/d/a.zip", url: "https://cdn.example/a.3mf" })).toBe(false);
    expect(is3mfDownload({ filename: "/d/a.stl", mime: "model/3mf" })).toBe(false);
    expect(is3mfDownload({ filename: "/d/a.3mf.zip" })).toBe(false);
  });
  it("isn't fooled by an address that only mentions .3mf", () => {
    expect(is3mfDownload({ filename: "x", url: "https://e.example/a?file=b.3mf" })).toBe(false);
    expect(is3mfDownload({ filename: "x", url: "not a url" })).toBe(false);
    expect(is3mfDownload({})).toBe(false);
  });
});

describe("isOwnDownload", () => {
  const id = "abc";
  const base = "chrome-extension://abc/";
  it("catches a save by the extension, by id or by address", () => {
    expect(isOwnDownload({ byExtensionId: id }, id, base)).toBe(true);
    expect(isOwnDownload({ url: "blob:chrome-extension://abc/1234" }, id, base)).toBe(true);
    expect(isOwnDownload({ finalUrl: "chrome-extension://abc/x.3mf" }, id, base)).toBe(true);
  });
  it("leaves everything else alone, including another extension's", () => {
    expect(isOwnDownload({ url: "https://e.example/a.3mf" }, id, base)).toBe(false);
    expect(isOwnDownload({ url: "blob:chrome-extension://zzz/1", byExtensionId: "zzz" }, id, base)).toBe(false);
    expect(isOwnDownload({ url: "blob:https://e.example/1" }, id, base)).toBe(false);
  });
});

describe("hostsOf and siteOf", () => {
  it("prefers the page, and falls back to the file's host when the browser reports no referrer", () => {
    expect(siteOf({ referrer: "https://www.site.example/m/1", url: "https://cdn.example/a.3mf" })).toBe("site.example");
    expect(siteOf({ url: "https://bucket.store.example/a.3mf" })).toBe("bucket.store.example");
    expect(hostsOf({ referrer: "https://site.example/", url: "https://cdn.example/a" })).toEqual(["site.example", "cdn.example"]);
  });
  it("reads the page out of a blob: address", () => {
    expect(siteOf({ url: "blob:https://www.site.example/1234" })).toBe("site.example");
  });
  it("gives nothing for what can't name a host", () => {
    expect(siteOf({ url: "data:application/zip;base64,AAAA" })).toBeNull();
    expect(siteOf({ url: "file:///etc/passwd", referrer: "garbage" })).toBeNull();
    expect(siteOf({})).toBeNull();
  });
});

describe("deliveryOf", () => {
  it("fetches https, asking only for the final host", () => {
    expect(deliveryOf({ url: "https://www.site.example/get", finalUrl: "https://dl.site.example/a.3mf?sig=x" })).toEqual({
      kind: "fetch",
      url: "https://dl.site.example/a.3mf?sig=x",
      host: "dl.site.example",
      origin: "https://dl.site.example/*",
    });
  });
  it("uses the address Firefox gives when there's no final one", () => {
    expect(deliveryOf({ url: "https://dl.site.example/a.3mf" })).toMatchObject({ kind: "fetch", host: "dl.site.example" });
  });
  it("sends everything else straight to the picker", () => {
    for (const url of ["blob:https://site.example/1", "data:application/zip;base64,AA", "http://site.example/a.3mf", "file:///a.3mf", "ftp://a/b", "", "junk"]) {
      expect(deliveryOf({ url })).toEqual({ kind: "pick" });
    }
  });
  it("can't be made to ask for more than one host", () => {
    for (const url of ["https://*.example/a.3mf", "https://*/a.3mf", "https://a.*.example/a.3mf"]) expect(deliveryOf({ url })).toEqual({ kind: "pick" });
    const trick = deliveryOf({ url: "https://site.example:444/a.3mf" });
    expect(trick).toMatchObject({ origin: "https://site.example/*" });
  });
  it("leaves out a user name and password, which a fetch refuses and access can't fix", () => {
    expect(deliveryOf({ url: "https://user:secret@dl.site.example:8443/a.3mf?sig=1" })).toEqual({
      kind: "fetch",
      url: "https://dl.site.example:8443/a.3mf?sig=1",
      host: "dl.site.example",
      origin: "https://dl.site.example/*",
    });
  });
});
