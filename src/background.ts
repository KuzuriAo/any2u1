// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Watches for a 3MF finishing its download and offers to convert it. Runs as a service worker in
 * Chrome and Edge and as a background script in Firefox, so it keeps nothing in memory that matters.
 * It reads no file and makes no request: the conversion, and any fetch, happen on the extension's page.
 */
import { api } from "./browser";
import { displayName } from "./core/names";
import { addPending, isPendingKey, listPending } from "./core/pending";
import { hostsOf, is3mfDownload, isOwnDownload, siteOf } from "./core/recognize";
import { isQuiet, parseSettings, type Settings } from "./core/settings";

const WINDOW_KEY = "offerWindowId";
const WINDOW_SIZE = { width: 480, height: 640 };

// One thing at a time, so that two downloads finishing together can't open two windows.
let chain: Promise<unknown> = Promise.resolve();
function enqueue(work: () => Promise<void>): void {
  chain = chain.then(work).catch((error: unknown) => console.error(error));
}

async function loadSettings(): Promise<Settings> {
  const { settings } = await api.storage.local.get("settings");
  return parseSettings(settings);
}

/** Reuses the one small window if it's still open. */
async function openOfferWindow(): Promise<void> {
  const stored = (await api.storage.session.get(WINDOW_KEY))[WINDOW_KEY];
  if (typeof stored === "number") {
    try {
      await api.windows.update(stored, { focused: true });
      return;
    } catch {
      await api.storage.session.remove(WINDOW_KEY);
    }
  }
  const created = await api.windows.create({
    url: api.runtime.getURL("convert.html?view=window"),
    type: "popup",
    focused: true,
    ...WINDOW_SIZE,
  });
  if (created?.id !== undefined) await api.storage.session.set({ [WINDOW_KEY]: created.id });
}

async function showBadge(): Promise<void> {
  const count = (await listPending(api.storage.session)).length;
  await api.action.setBadgeBackgroundColor({ color: "#0b6e4f" });
  await api.action.setBadgeText({ text: count === 0 ? "" : String(count) });
}

async function downloadFinished(id: number): Promise<void> {
  const [item] = await api.downloads.search({ id });
  if (!item || !is3mfDownload(item)) return;
  if (isOwnDownload(item, api.runtime.id, api.runtime.getURL(""))) return;
  const settings = await loadSettings();
  if (!settings.enabled || isQuiet(hostsOf(item), settings.quietSites)) return;
  await addPending(api.storage.session, { id, name: displayName(item.filename) || "Unnamed file", site: siteOf(item), at: Date.now() });
  if (settings.offerStyle === "window") await openOfferWindow();
}

api.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === "complete") enqueue(() => downloadFinished(delta.id));
});

// A popup would close when the file dialog opens in Firefox, taking the chosen file with it, so the button opens a window or a tab.
api.action.onClicked.addListener(() => {
  enqueue(async () => {
    if ((await listPending(api.storage.session)).length > 0) await openOfferWindow();
    else await api.tabs.create({ url: api.runtime.getURL("convert.html") });
  });
});

api.windows.onRemoved.addListener((windowId) => {
  enqueue(async () => {
    if ((await api.storage.session.get(WINDOW_KEY))[WINDOW_KEY] === windowId) await api.storage.session.remove(WINDOW_KEY);
  });
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && Object.keys(changes).some(isPendingKey)) enqueue(showBadge);
});
