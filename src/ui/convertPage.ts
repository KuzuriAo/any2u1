// SPDX-License-Identifier: AGPL-3.0-or-later
/** One page, shown as a tab (by hand) or as the small window (after a download). */
import { api } from "../browser";
import { fetchFile, type FetchFailure } from "../core/fetchFile";
import { MAX_FILES_AT_ONCE, MAX_INPUT_BYTES } from "../core/limits";
import { isPendingKey, listPending, removePending, type PendingDownload } from "../core/pending";
import { deliveryOf, type Delivery } from "../core/recognize";
import { convertFile, listReleases, type Converted, type Outcome } from "./engine";
import { button, el, need } from "./dom";
import { renderOptions } from "./optionsForm";
import { pickFiles } from "./picker";
import { loadSettings, onSettingsChanged, updateSettings } from "./settingsStore";

const pendingList = need<HTMLUListElement>("#pending");
const pendingSection = need<HTMLElement>("#downloads");
const results = need<HTMLUListElement>("#results");
const resultsSection = need<HTMLElement>("#results-section");
const manualPicker = need<HTMLInputElement>("#file");
const rowPicker = need<HTMLInputElement>("#row-file");
const dropZone = need<HTMLElement>("#drop");
const status = need<HTMLElement>("#status");
const options = need<HTMLElement>("#options");

if (new URLSearchParams(location.search).get("view") === "window") document.body.classList.add("small");

/** What each waiting download is doing. A row's buttons depend on it, and it outlives a redraw. */
type RowState =
  | { phase: "ready" }
  | { phase: "working"; message: string }
  /** The no-access fetch was refused: the user chooses between access to the host and the saved file. */
  | { phase: "choice"; delivery: Extract<Delivery, { kind: "fetch" }>; size: number | undefined }
  | { phase: "pick"; message: string };
const rows = new Map<number, RowState>();

const PICK_ONLY = "This file can't be fetched again, so choose the copy you just saved. It's in your downloads folder.";

// One conversion at a time: a Web Worker holding two large files at once helps nobody.
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work);
  queue = next.catch(() => {});
  return next;
}

function say(message: string): void {
  status.textContent = message;
}

function setRow(id: number, state: RowState): void {
  rows.set(id, state);
  void drawPending();
}

/** Saves through the browser, then offers to show the file. The extension's own save never gets an offer. */
async function save(result: Converted, item: HTMLLIElement): Promise<void> {
  const url = URL.createObjectURL(new Blob([result.output as BlobPart], { type: "model/3mf" }));
  let id: number | undefined;
  let settled = false;
  const settle = (state: string | undefined) => {
    if (settled || id === undefined || state === undefined || state === "in_progress") return;
    settled = true;
    api.downloads.onChanged.removeListener(watch);
    URL.revokeObjectURL(url);
    const saved = id;
    if (state === "complete") item.querySelector(".saved")?.append(button("Show in folder", () => api.downloads.show(saved), "link show"));
  };
  const watch = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id === id) settle(delta.state?.current);
  };
  api.downloads.onChanged.addListener(watch);
  id = await api.downloads.download({ url, filename: result.name, conflictAction: "uniquify", saveAs: false });
  // A small file can finish before the id is known here.
  const [done] = await api.downloads.search({ id });
  settle(done?.state);
}

function showOutcome(outcome: Outcome): boolean {
  resultsSection.hidden = false;
  if ("error" in outcome) {
    results.append(el("li", { class: "failed" }, el("strong", {}, outcome.source), el("p", {}, outcome.error)));
    return false;
  }
  const item = el("li", { class: "converted" },
    el("strong", {}, outcome.name),
    el("p", { class: "saved" }, `Saved to your downloads, using ${outcome.profile}. `),
    outcome.notes.length > 0 && el("ul", { class: "notes" }, ...outcome.notes.map((note) => el("li", {}, note))));
  results.append(item);
  void save(outcome, item).catch((error: unknown) => {
    item.querySelector(".saved")!.textContent = `Couldn't save this file: ${error instanceof Error ? error.message : "the browser refused"}.`;
  });
  need("#open-tip").hidden = false;
  return true;
}

async function convertAndShow(name: string, bytes: Uint8Array): Promise<boolean> {
  return inTurn(async () => {
    say(`Converting ${name}...`);
    const settings = await loadSettings();
    const outcomes = await convertFile(name, bytes, settings.convert);
    const converted = outcomes.map(showOutcome).some(Boolean);
    say("");
    if (outcomes.length === 0) showOutcome({ source: name, error: "This zip has no 3MF file inside." });
    return converted;
  });
}

/** Files handed over by the user. Sizes are checked before a large file is read into memory. */
async function convertPicked(files: File[]): Promise<boolean> {
  let converted = false;
  for (const file of files.slice(0, MAX_FILES_AT_ONCE)) {
    if (file.size > MAX_INPUT_BYTES) {
      showOutcome({ source: file.name, error: "This file is too large to convert in a browser: the limit is 1 GB." });
      continue;
    }
    if (await convertAndShow(file.name, new Uint8Array(await file.arrayBuffer()))) converted = true;
  }
  if (files.length > MAX_FILES_AT_ONCE) say(`Only the first ${MAX_FILES_AT_ONCE} files were converted.`);
  return converted;
}

async function finish(id: number): Promise<void> {
  rows.delete(id);
  await removePending(api.storage.session, id);
}

async function fetchAndConvert(entry: PendingDownload, url: string, size: number | undefined, onRefused: (failure: FetchFailure) => void): Promise<void> {
  setRow(entry.id, { phase: "working", message: "Getting the file..." });
  const fetched = await fetchFile(url, size);
  if (!fetched.ok) {
    onRefused(fetched.failure);
    return;
  }
  setRow(entry.id, { phase: "working", message: "Converting..." });
  if (await convertAndShow(entry.name, fetched.bytes)) await finish(entry.id);
  else setRow(entry.id, { phase: "pick", message: "If the file was damaged on the way here, try the copy you saved." });
}

/** Yes on a waiting download whose file has a web address. No prompt yet: many servers allow this with no access at all. */
async function startConvert(entry: PendingDownload): Promise<void> {
  const [item] = await api.downloads.search({ id: entry.id });
  const delivery: Delivery = item ? deliveryOf(item) : { kind: "pick" };
  if (delivery.kind === "pick") {
    setRow(entry.id, { phase: "pick", message: PICK_ONLY });
    return;
  }
  const size = item && item.fileSize > 0 ? item.fileSize : undefined;
  await fetchAndConvert(entry, delivery.url, size, (failure) => {
    void (async () => {
      const hasAccess = await api.permissions.contains({ origins: [delivery.origin] });
      if (failure === "blocked" && !hasAccess) setRow(entry.id, { phase: "choice", delivery, size });
      else setRow(entry.id, { phase: "pick", message: "That address didn't return the same file. Choose the copy you saved." });
    })();
  });
}

function allowHost(entry: PendingDownload, delivery: Extract<Delivery, { kind: "fetch" }>, size: number | undefined): void {
  // Firefox only allows this as the first thing a click does: nothing may wait before it.
  api.permissions.request({ origins: [delivery.origin] }).then(
    async (granted) => {
      if (!granted) {
        setRow(entry.id, { phase: "pick", message: "No access was given. Choose the copy you saved." });
        return;
      }
      await fetchAndConvert(entry, delivery.url, size, () => {
        setRow(entry.id, { phase: "pick", message: "The file still couldn't be read from there. Choose the copy you saved." });
      });
    },
    () => setRow(entry.id, { phase: "pick", message: "The browser refused the request. Choose the copy you saved." }),
  );
}

function pickForRow(entry: PendingDownload): void {
  void pickFiles(rowPicker).then(async (files) => {
    if (files.length === 0) return;
    setRow(entry.id, { phase: "working", message: "Converting..." });
    if (await convertPicked(files)) await finish(entry.id);
    else setRow(entry.id, { phase: "pick", message: "That file didn't convert. You can choose another." });
  });
}

function pickButton(entry: PendingDownload): HTMLButtonElement {
  return button("Choose the saved file", () => pickForRow(entry), "pick");
}

function rowActions(entry: PendingDownload, state: RowState): Array<Node> {
  switch (state.phase) {
    case "ready":
      return [button("Convert for Snapmaker U1", () => void startConvert(entry), "primary")];
    case "working":
      return [el("p", { class: "working" }, state.message)];
    case "pick":
      return [el("p", { class: "explain" }, state.message), pickButton(entry)];
    case "choice":
      return [
        el("p", { class: "explain" }, `The server at ${state.delivery.host} doesn't let extensions read this file. You can allow access to that one host, or choose the copy you saved; both work the same.`),
        el("p", { class: "explain" }, "The browser's prompt will sound broader than this: the extension only uses the access to fetch a file you chose to convert."),
        el("div", { class: "actions" }, button(`Allow access to ${state.delivery.host}`, () => allowHost(entry, state.delivery, state.size), "allow"), pickButton(entry)),
      ];
  }
}

async function quietSite(entry: PendingDownload): Promise<void> {
  const site = entry.site;
  if (site !== null) await updateSettings((settings) => void settings.quietSites.push(site));
  await finish(entry.id);
}

/** A file built in the page can only come from the user, so that's the first thing to offer, with no prompt. */
async function firstState(entry: PendingDownload): Promise<RowState> {
  const [item] = await api.downloads.search({ id: entry.id });
  return !item || deliveryOf(item).kind === "pick" ? { phase: "pick", message: PICK_ONLY } : { phase: "ready" };
}

async function drawPending(): Promise<void> {
  const waiting = await listPending(api.storage.session);
  const live = new Set(waiting.map((entry) => entry.id));
  for (const id of rows.keys()) if (!live.has(id)) rows.delete(id);
  for (const entry of waiting) if (!rows.has(entry.id)) rows.set(entry.id, await firstState(entry));
  pendingSection.hidden = waiting.length === 0;
  dropZone.classList.toggle("secondary", waiting.length > 0);
  pendingList.replaceChildren(...waiting.map((entry) => {
    const state = rows.get(entry.id) ?? { phase: "ready" as const };
    return el("li", { class: "row", "data-id": String(entry.id) },
      el("strong", { class: "name" }, entry.name),
      entry.site !== null && el("span", { class: "site" }, entry.site),
      el("div", { class: "row-body" }, ...rowActions(entry, state)),
      state.phase !== "working" && el("div", { class: "row-foot" },
        button("Dismiss", () => void finish(entry.id), "link dismiss"),
        entry.site !== null && button(`Not on ${entry.site}`, () => void quietSite(entry), "link quiet")));
  }));
}

manualPicker.addEventListener("change", () => {
  const files = [...(manualPicker.files ?? [])];
  manualPicker.value = "";
  void convertPicked(files);
});

need("#choose").addEventListener("click", () => void pickFiles(manualPicker).then(convertPicked));

for (const type of ["dragenter", "dragover"]) {
  dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.add("over");
  });
}
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("over"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("over");
  void convertPicked([...(event.dataTransfer?.files ?? [])]);
});

need("#open-settings").addEventListener("click", () => void api.runtime.openOptionsPage());

api.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && Object.keys(changes).some(isPendingKey)) void drawPending();
});

async function drawOptions(): Promise<void> {
  const [settings, releases] = await Promise.all([loadSettings(), listReleases()]);
  renderOptions(options, settings.convert, releases);
}

// Redrawing options another page changed is fine; redrawing under the user's own click isn't needed, since the values match.
onSettingsChanged(() => {
  if (!options.contains(document.activeElement)) void drawOptions();
});

void drawOptions();
void drawPending();
