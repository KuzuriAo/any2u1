// SPDX-License-Identifier: AGPL-3.0-or-later
/** One page, shown as a tab (by hand) or as the small window (after a download). */
import { api } from "../browser";
import { fetchFile, type FetchFailure } from "../core/fetchFile";
import { MAX_FILES_AT_ONCE, MAX_INPUT_BYTES } from "../core/limits";
import { displayName } from "../core/names";
import { elapsedText, receivedText } from "../core/progress";
import { isPendingKey, listPending, removePending, type PendingDownload } from "../core/pending";
import { deliveryOf, type Delivery } from "../core/recognize";
import { activeRelease } from "../core/releases";
import { convertFile, listReleases, stopConverting, type Converted, type Outcome } from "./engine";
import { button, el, need } from "./dom";
import { renderOptions } from "./optionsForm";
import { pickFiles } from "./picker";
import { failureReport } from "../core/report";
import { environment, reportBlock } from "./report";
import { showReleaseNotice } from "./releaseNotice";
import { loadSettings, onSettingsChanged, updateSettings } from "./settingsStore";

const pendingList = need<HTMLUListElement>("#pending");
const pendingSection = need<HTMLElement>("#downloads");
const results = need<HTMLUListElement>("#results");
const resultsSection = need<HTMLElement>("#results-section");
const manualPicker = need<HTMLInputElement>("#file");
const rowPicker = need<HTMLInputElement>("#row-file");
const dropZone = need<HTMLElement>("#drop");
const status = need<HTMLElement>("#status");
const stop = need<HTMLButtonElement>("#stop");
const activity = need<HTMLElement>("#activity");
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
/** A row's fetch, so that dismissing the row ends it instead of leaving it running. */
const fetches = new Map<number, AbortController>();

const PICK_ONLY = "This file can't be fetched again, so choose the copy you just saved. It's in your downloads folder.";
/** How long the next save waits for one the browser hasn't finished. A save the user paused shouldn't hold up every other. */
const SAVE_WAIT_MS = 60_000;

// One file at a time, fetched or converting: a page holding several large files at once helps nobody.
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

/** Changes the words on a row that's working, in place: redrawing the list every second would take a button from under a click. */
function sayOnRow(id: number, message: string): void {
  const state = rows.get(id);
  if (state?.phase !== "working") return;
  state.message = message;
  const line = pendingList.querySelector(`[data-id="${id}"] .working`);
  if (line) line.textContent = message;
}

/** Waits until the browser is done with a download, whether it was saved or not. */
function settled(id: number): Promise<chrome.downloads.DownloadItem | undefined> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (found: chrome.downloads.DownloadItem | undefined) => {
      if (done) return;
      done = true;
      api.downloads.onChanged.removeListener(watch);
      resolve(found);
    };
    const check = () =>
      api.downloads.search({ id }).then(
        ([found]) => {
          if (!found || found.state !== "in_progress") finish(found);
        },
        () => finish(undefined),
      );
    const watch = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id === id && delta.state && delta.state.current !== "in_progress") void check();
    };
    api.downloads.onChanged.addListener(watch);
    // A small file can finish before the listener is in place.
    void check();
  });
}

/** What the result says once the browser is done: where the file is, or that it isn't there. */
function showSaved(item: HTMLLIElement, id: number, asked: string, download: chrome.downloads.DownloadItem | undefined): void {
  const line = item.querySelector<HTMLElement>(".saved");
  if (!line) return;
  if (download?.state === "complete") {
    // The browser may have changed the name, for example to avoid a file already there; say the one it used.
    const savedAs = displayName(download.filename);
    const title = item.querySelector("strong");
    if (savedAs !== "" && savedAs !== asked && title) title.textContent = savedAs;
    line.append(button("Show in folder", () => api.downloads.show(id), "link show"));
    return;
  }
  item.classList.add("unsaved");
  line.textContent = `This file wasn't saved: ${whyUnsaved(download?.error)}. Convert it again to save it.`;
}

/** The browser's reason in words. Chrome also says "canceled" when it couldn't write to the folder, so that isn't blamed on the user. */
function whyUnsaved(error: string | undefined): string {
  if (error === "FILE_NO_SPACE") return "there isn't enough space on the disk";
  if (error === "USER_CANCELED" || error?.startsWith("FILE_")) return "the browser couldn't write it to the downloads folder, or the save was canceled";
  return "the browser stopped the download";
}

async function saveNow(result: Converted, item: HTMLLIElement): Promise<void> {
  const url = URL.createObjectURL(new Blob([result.output as BlobPart], { type: "model/3mf" }));
  let id: number;
  try {
    id = await api.downloads.download({ url, filename: result.name, conflictAction: "uniquify", saveAs: false });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  const done = settled(id).then((download) => {
    URL.revokeObjectURL(url);
    showSaved(item, id, result.name, download);
  });
  await Promise.race([done, new Promise((resolve) => setTimeout(resolve, SAVE_WAIT_MS))]);
}

// One save at a time. Two started together under one name can both fail in one browser, and the first file goes with them.
let saving: Promise<unknown> = Promise.resolve();

/** Saves through the browser, then offers to show the file. The extension's own save never gets an offer. */
function save(result: Converted, item: HTMLLIElement): void {
  const next = saving.then(() => saveNow(result, item));
  saving = next.catch(() => {});
  next.catch((error: unknown) => {
    item.classList.add("unsaved");
    item.querySelector(".saved")!.textContent = `Couldn't save this file: ${error instanceof Error ? error.message : "the browser refused"}.`;
  });
}

/** A color from the file, used only if it's a plain hex color. */
function swatch(color: string): HTMLSpanElement {
  const element = el("span", { class: "swatch", "aria-hidden": "true" });
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) element.style.backgroundColor = color;
  return element;
}

/** Every filament as the file has it, in its order. Nothing here can change the list. */
function filamentList(filaments: Converted["filaments"]): HTMLElement | null {
  if (filaments.length === 0) return null;
  return el("ol", { class: "filaments", "aria-label": "Filaments" }, ...filaments.map((filament) => {
    const renamed = filament.outputName !== filament.sourceName;
    return el("li", {},
      swatch(filament.color),
      el("span", { class: "slot" }, String(filament.slot)),
      el("span", { class: "type" }, filament.type),
      el("span", { class: "fname" }, renamed ? filament.outputName : filament.outputName || "(no name)"),
      renamed && filament.sourceName !== "" && el("span", { class: "was" }, `was ${filament.sourceName}`));
  }));
}

function showOutcome(outcome: Outcome, site: string | null = null): boolean {
  resultsSection.hidden = false;
  if ("error" in outcome) {
    // Stopping is the user's own choice, so there's nothing to report.
    const report = outcome.code === "stopped" ? null : reportBlock(failureReport({ code: outcome.code, slicer: outcome.slicer, size: outcome.size, site, ...environment() }), "Copy a report");
    results.append(el("li", { class: "failed" }, el("strong", {}, displayName(outcome.source)), el("p", {}, outcome.error), report));
    return false;
  }
  const item = el("li", { class: "converted" },
    el("strong", {}, outcome.name),
    outcome.alreadyU1 && el("p", { class: "already" }, "This file was already set up for the Snapmaker U1. It has still been converted, and saved as a new file."),
    el("p", { class: "saved" }, `Saved to your downloads, using ${outcome.profile}${[outcome.orcaVersion ? `for Snapmaker Orca ${outcome.orcaVersion}` : "", ...outcome.printer].filter(Boolean).map((part) => `, ${part}`).join("")}. `),
    // The library's sentences can start in lower case; only the first letter changes.
    outcome.profileNotes.length > 0 && el("ul", { class: "profile-notes" }, ...outcome.profileNotes.map((note) => el("li", {}, note.charAt(0).toUpperCase() + note.slice(1)))),
    filamentList(outcome.filaments),
    outcome.notes.length > 0 && el("ul", { class: "notes" }, ...outcome.notes.map((note) => el("li", {}, note))));
  results.append(item);
  save(outcome, item);
  need("#open-tip").hidden = false;
  return true;
}

/** "unsupported" means a readable project from a slicer the library doesn't convert: another copy of it won't help. */
type Result = "converted" | "unsupported" | "stopped" | "failed";

/**
 * Converts now; the caller has its turn. While it runs, the line says which step it is on and how long it has been going,
 * so that a long one is seen to be alive. `report` gets the same words, for the row of a waiting download.
 */
async function convertNow(name: string, bytes: Uint8Array, site: string | null, report?: (message: string) => void): Promise<Result> {
  const size = bytes.byteLength;
  const shown = displayName(name);
  const started = Date.now();
  let step = "Starting";
  const update = () => {
    const detail = `${step} · ${elapsedText(Date.now() - started)}`;
    say(`Converting ${shown} · ${detail}`);
    report?.(`Converting · ${detail}`);
  };
  update();
  stop.hidden = false;
  activity.hidden = false;
  const clock = setInterval(update, 1000);
  try {
    const settings = await loadSettings();
    const outcomes = await convertFile(name, bytes, settings.convert, (text) => {
      step = text;
      update();
    });
    const converted = outcomes.map((outcome) => showOutcome(outcome, site)).some(Boolean);
    if (outcomes.length === 0) showOutcome({ source: name, error: "This zip has no 3MF file inside.", code: "zip_no_3mf", size }, site);
    if (converted) return "converted";
    const codes = outcomes.map((outcome) => ("code" in outcome ? outcome.code : undefined));
    if (codes.includes("stopped")) return "stopped";
    return codes.length > 0 && codes.every((code) => code === "unsupported_slicer") ? "unsupported" : "failed";
  } finally {
    clearInterval(clock);
    stop.hidden = true;
    activity.hidden = true;
    say("");
  }
}

function convertAndShow(name: string, bytes: Uint8Array, site: string | null = null, report?: (message: string) => void): Promise<Result> {
  return inTurn(() => convertNow(name, bytes, site, report));
}

/** Files handed over by the user. Sizes are checked before a large file is read into memory. */
async function convertPicked(files: File[], site: string | null = null, report?: (message: string) => void): Promise<boolean> {
  let converted = false;
  for (const file of files.slice(0, MAX_FILES_AT_ONCE)) {
    if (file.size > MAX_INPUT_BYTES) {
      showOutcome({ source: file.name, error: "This file is too large to convert in a browser: the limit is 1 GB.", code: "input_too_large", size: file.size }, site);
      continue;
    }
    // Reading a large file off the disk takes a while before anything can start.
    say(`Reading ${displayName(file.name)}...`);
    report?.("Reading the file...");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if ((await convertAndShow(file.name, bytes, site, report)) === "converted") converted = true;
  }
  if (files.length > MAX_FILES_AT_ONCE) say(`Only the first ${MAX_FILES_AT_ONCE} files were converted.`);
  return converted;
}

async function finish(id: number): Promise<void> {
  fetches.get(id)?.abort();
  fetches.delete(id);
  rows.delete(id);
  await removePending(api.storage.session, id);
}

async function fetchAndConvert(entry: PendingDownload, url: string, size: number | undefined, onRefused: (failure: FetchFailure) => void): Promise<void> {
  const controller = new AbortController();
  fetches.set(entry.id, controller);
  setRow(entry.id, { phase: "working", message: "Waiting for the files ahead of it..." });
  let result: Result | FetchFailure;
  try {
    result = await inTurn(async () => {
      if (controller.signal.aborted) return "stopped";
      setRow(entry.id, { phase: "working", message: `Getting the file... ${receivedText(0, size)}` });
      let lastShown = 0;
      const fetched = await fetchFile(url, size, {
        signal: controller.signal,
        // Several times a second is plenty to read, and a piece can arrive every few milliseconds.
        onProgress: (received) => {
          if (Date.now() - lastShown < 250) return;
          lastShown = Date.now();
          sayOnRow(entry.id, `Getting the file... ${receivedText(received, size)}`);
        },
      });
      if (!fetched.ok) return fetched.failure;
      setRow(entry.id, { phase: "working", message: "Converting..." });
      return convertNow(entry.name, fetched.bytes, entry.site, (message) => sayOnRow(entry.id, message));
    });
  } finally {
    if (fetches.get(entry.id) === controller) fetches.delete(entry.id);
  }
  // Dismissed while it waited, fetched or converted: the row is gone, and whatever converted is in the results.
  if (controller.signal.aborted) return;
  if (result === "blocked" || result === "wrong-file") onRefused(result);
  // A project from another slicer would fail the same way from the saved copy, so only a damaged file gets that offer.
  else if (result === "failed") setRow(entry.id, { phase: "pick", message: "If the file was damaged on the way here, try the copy you saved." });
  else if (result === "stopped") setRow(entry.id, { phase: "ready" });
  else await finish(entry.id);
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
  const differs = "That address didn't return the same file. Choose the copy you saved.";
  await fetchAndConvert(entry, delivery.url, size, (failure) => {
    void (async () => {
      const hasAccess = await api.permissions.contains({ origins: [delivery.origin] });
      if (failure === "blocked" && !hasAccess) setRow(entry.id, { phase: "choice", delivery, size });
      else setRow(entry.id, { phase: "pick", message: differs });
    })().catch(() => setRow(entry.id, { phase: "pick", message: differs }));
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
    setRow(entry.id, { phase: "working", message: "Reading the file..." });
    if (await convertPicked(files, entry.site, (message) => sayOnRow(entry.id, message))) await finish(entry.id);
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
  if (site !== null) {
    await updateSettings((settings) => {
      if (!settings.quietSites.includes(site)) settings.quietSites.push(site);
    });
  }
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
      // Dismiss stays while a file is on its way, so a server that never finishes sending can't keep the row forever.
      el("div", { class: "row-foot" },
        button("Dismiss", () => void finish(entry.id), "link dismiss"),
        state.phase !== "working" && entry.site !== null && button(`Not on ${entry.site}`, () => void quietSite(entry), "link quiet")));
  }));
}

// The picker's own wait on this input then finds it empty, so a file is never converted twice.
manualPicker.addEventListener("change", () => {
  const files = [...(manualPicker.files ?? [])];
  manualPicker.value = "";
  void convertPicked(files);
});

need("#choose").addEventListener("click", () => void pickFiles(manualPicker).then(convertPicked));
// Results are only what this page has shown: clearing them removes nothing saved, and a save still in progress carries on.
need("#clear-results").addEventListener("click", () => {
  results.replaceChildren();
  resultsSection.hidden = true;
  need("#open-tip").hidden = true;
});
stop.addEventListener("click", () => stopConverting());

// The whole page takes a drop: a file dropped beside the zone would otherwise make the browser leave the page.
for (const type of ["dragenter", "dragover"]) {
  document.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.add("over");
  });
}
document.addEventListener("dragleave", (event) => {
  if ((event as DragEvent).relatedTarget === null) dropZone.classList.remove("over");
});
document.addEventListener("drop", (event) => {
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
  drawVersion(settings.convert.snapmakerOrcaVersion, releases);
}

// The options start closed in the small window, so what the file will be converted for stays in sight.
function drawVersion(chosen: string | null, releases: readonly string[]): void {
  const version = activeRelease(chosen, releases);
  need("#options-version").textContent = version ? `(for Snapmaker Orca ${version})` : "";
}

// Redrawing options another page changed is fine; redrawing under the user's own click isn't needed, since the values match.
onSettingsChanged((settings) => {
  if (!options.contains(document.activeElement)) void drawOptions();
  else void listReleases().then((releases) => drawVersion(settings.convert.snapmakerOrcaVersion, releases));
});

// The notice comes first: it clears a saved choice the catalog no longer holds.
void listReleases().then(showReleaseNotice).then(drawOptions);
void drawPending();
