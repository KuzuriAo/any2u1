// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Downloads waiting for an answer. Each has its own key in session storage, so the background script
 * and a page never overwrite each other's changes. Only the name and the site are kept: the address
 * can be a signed link that works as a credential, so it stays with the browser and is looked up by id.
 */
import { MAX_PENDING } from "./limits";

export type PendingDownload = { id: number; name: string; site: string | null; at: number };

export type SessionArea = {
  get(keys: null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

const PREFIX = "pending:";

function parseEntry(value: unknown): PendingDownload | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, name, site, at } = value as Record<string, unknown>;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || typeof name !== "string" || typeof at !== "number") return null;
  return { id, name, site: typeof site === "string" ? site : null, at };
}

export async function listPending(area: SessionArea): Promise<PendingDownload[]> {
  const all = await area.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(PREFIX))
    .map(([, value]) => parseEntry(value))
    .filter((entry): entry is PendingDownload => entry !== null)
    .sort((a, b) => a.at - b.at || a.id - b.id);
}

export async function addPending(area: SessionArea, entry: PendingDownload): Promise<void> {
  await area.set({ [PREFIX + entry.id]: entry });
  const waiting = await listPending(area);
  const extra = waiting.length - MAX_PENDING;
  if (extra > 0) await area.remove(waiting.slice(0, extra).map((old) => PREFIX + old.id));
}

export function removePending(area: SessionArea, id: number): Promise<void> {
  return area.remove(PREFIX + id);
}

export function isPendingKey(key: string): boolean {
  return key.startsWith(PREFIX);
}
