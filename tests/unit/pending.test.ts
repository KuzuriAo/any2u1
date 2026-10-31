// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { MAX_PENDING } from "../../src/core/limits";
import { addPending, listPending, removePending, type SessionArea } from "../../src/core/pending";

function fakeArea(initial: Record<string, unknown> = {}): SessionArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async () => ({ ...data }),
    set: async (items) => void Object.assign(data, items),
    remove: async (keys) => {
      for (const key of [keys].flat()) delete data[key];
    },
  };
}

describe("pending downloads", () => {
  it("lists them oldest first", async () => {
    const area = fakeArea();
    await addPending(area, { id: 2, name: "b", site: null, at: 20 });
    await addPending(area, { id: 1, name: "a", site: "s.example", at: 10 });
    expect((await listPending(area)).map((entry) => entry.id)).toEqual([1, 2]);
  });
  it("removes one, and adding the same download twice leaves one", async () => {
    const area = fakeArea();
    await addPending(area, { id: 1, name: "a", site: null, at: 1 });
    await addPending(area, { id: 1, name: "a", site: null, at: 1 });
    await addPending(area, { id: 2, name: "b", site: null, at: 2 });
    await removePending(area, 1);
    expect((await listPending(area)).map((entry) => entry.id)).toEqual([2]);
  });
  it("drops the oldest past the limit", async () => {
    const area = fakeArea();
    for (let id = 0; id < MAX_PENDING + 5; id += 1) await addPending(area, { id, name: "x", site: null, at: id });
    const left = await listPending(area);
    expect(left.length).toBe(MAX_PENDING);
    expect(left[0]?.id).toBe(5);
  });
  it("ignores other keys and malformed entries", async () => {
    const area = fakeArea({ offerWindowId: 3, "pending:1": "junk", "pending:2": { id: "2", name: "x", at: 1 }, "pending:3": { id: 3, name: "ok", at: 1 } });
    expect(await listPending(area)).toEqual([{ id: 3, name: "ok", site: null, at: 1 }]);
  });
  it("keeps no address, since a signed link works as a credential", async () => {
    const area = fakeArea();
    await addPending(area, { id: 1, name: "a", site: "s.example", at: 1 });
    expect(JSON.stringify(area.data)).not.toContain("http");
  });
});
