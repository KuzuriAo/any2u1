// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The converter, in a Web Worker on the extension's page (a service worker can't start one). The
 * profile catalog is inside the extension, so converting makes no request beyond the extension's own files.
 */
import { createConverterWorker, type ConverterWorker } from "any2orca/worker";
import type { ReportFilament } from "any2orca";
import ConverterWorkerScript from "any2orca/worker-entry?worker";
import { MAX_FILES_IN_ZIP, MAX_INPUT_BYTES } from "../core/limits";
import { notesFor } from "../core/notes";
import { is3mfName, outputName } from "../core/names";
import { stageText } from "../core/progress";
import { activeRelease } from "../core/releases";
import { convertOptions, describePrinter, type ConvertSettings } from "../core/settings";

export type Converted = {
  source: string;
  name: string;
  output: Uint8Array;
  profile: string;
  /** Why the profile was matched, when the match wasn't plain. */
  profileNotes: string[];
  orcaVersion: string | undefined;
  /** Every filament, in the file's order, as the converted file has it. Never reordered, merged or dropped. */
  filaments: ReportFilament[];
  /** The printer options that applied to this file, e.g. "high-flow on T1". */
  printer: string[];
  /** A file that was set up for the U1 before it got here: said first, so nobody thinks nothing happened. */
  alreadyU1: boolean;
  notes: string[];
};
/** `code` is the library's error code, or this extension's own for a failure it found itself. `slicer` goes with `unsupported_slicer`. */
export type Failed = { source: string; error: string; code?: string; slicer?: string; size?: number };
export type Outcome = Converted | Failed;

const CRASHED = "The conversion stopped, most likely because the browser ran out of memory for this file.";
const STOPPED = "Stopped before it finished. Nothing was saved for this file.";

let worker: ConverterWorker | null = null;
let crashed: ((error: Error) => void) | null = null;
let crash: Promise<never> = new Promise(() => {});

function start(): ConverterWorker {
  if (worker) return worker;
  const script = new ConverterWorkerScript();
  crash = new Promise((_, reject) => {
    crashed = reject;
  });
  crash.catch(() => {});
  const fail = () => end(CRASHED);
  script.addEventListener("error", fail);
  script.addEventListener("messageerror", fail);
  worker = createConverterWorker(script, { profilesUrl: new URL("profiles/", window.location.href) });
  return worker;
}

/** Ends the worker: the call in progress fails with `message`, and the next call starts a new worker. */
function end(message: string): void {
  crashed?.(new Error(message));
  crashed = null;
  worker?.terminate();
  worker = null;
}

/** Stops the conversion in progress. Its file gets a message, and the next file converts in a new worker. */
export function stopConverting(): void {
  if (worker) end(STOPPED);
}

/**
 * The library settles its calls when the worker fails, but that worker stays dead. Starting a new one here means
 * a file too large for memory doesn't leave every other waiting download needing a page reload.
 */
function guarded<T>(work: Promise<T>): Promise<T> {
  return Promise.race([work, crash]);
}

export async function listReleases(): Promise<string[]> {
  const listing = await guarded(start().listProfiles());
  return listing.releases.map((release) => release.version);
}

function failure(source: string, error: unknown, size: number): Failed {
  const { code, slicer } = (error ?? {}) as { code?: unknown; slicer?: unknown };
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return {
    source,
    error: message,
    size,
    code: typeof code === "string" ? code : message === CRASHED ? "worker_stopped" : message === STOPPED ? "stopped" : "unknown",
    ...(typeof slicer === "string" ? { slicer } : {}),
  };
}

const isU1File = (printerModel: string | null, sourceVendor: string) => sourceVendor === "snapmaker" && /\bU1\b/.test(printerModel ?? "");

/** Told what a conversion is doing, in words: the library reports four stages, and the page adds its own. */
export type Step = (text: string) => void;

async function convertOne(source: string, bytes: Uint8Array, convert: ConvertSettings, releases: readonly string[], onStep: Step): Promise<Converted> {
  const converter = start();
  onStep("Opening the project");
  const { project, inspection } = await guarded(converter.open(bytes, { transfer: true }));
  try {
    const release = activeRelease(convert.snapmakerOrcaVersion, releases);
    // The catalog says which nozzle sizes have a high-flow option; the same check the web app makes.
    const nozzle = inspection.matchNozzleDiameter ?? "0.4";
    const { profiles } = await guarded(converter.listProfiles({ nozzleDiameter: nozzle, ...(release ? { snapmakerOrcaVersion: release } : {}) }));
    const highFlowSupported = profiles.some((profile) => profile.highFlowSupported);
    const { output, report } = await guarded(project.convert({ ...convertOptions(convert, releases, highFlowSupported), onProgress: (stage) => onStep(stageText(stage)) }));
    return {
      source,
      name: outputName(source),
      output,
      profile: report.profile.displayName,
      profileNotes: report.profileNotes,
      filaments: report.filaments,
      orcaVersion: release,
      printer: describePrinter(convert, nozzle, highFlowSupported),
      alreadyU1: isU1File(inspection.printerModel, inspection.sourceVendor),
      notes: notesFor(report),
    };
  } finally {
    await guarded(project.close()).catch(() => {});
  }
}

/** A 3MF, or a zip of them: one outcome per 3MF. One bad file doesn't stop the rest of a zip. */
export async function convertFile(name: string, bytes: Uint8Array, convert: ConvertSettings, onStep: Step = () => {}): Promise<Outcome[]> {
  // The worker takes over a file's memory, which leaves its length at 0, so sizes are read before the hand-over.
  const size = bytes.byteLength;
  if (size > MAX_INPUT_BYTES) return [{ source: name, error: "This file is too large to convert in a browser: the limit is 1 GB.", code: "input_too_large", size }];
  try {
    const releases = await listReleases();
    // Unpacking twice is wasted work on a large 3MF, so only a file that may be a zip is checked for one. The bytes are
    // copied to the worker, not moved: when the file isn't a bundle (null), the same bytes are opened next.
    if (!is3mfName(name)) onStep("Looking inside the file");
    const nested = is3mfName(name) ? null : await guarded(start().unwrapBundle(bytes));
    if (nested === null) return [await convertOne(name, bytes, convert, releases, onStep)];
    const projects = nested.filter((entry) => !entry.name.startsWith("._"));
    if (projects.length > MAX_FILES_IN_ZIP) return [{ source: name, error: `This zip holds ${projects.length} 3MF files; the limit is ${MAX_FILES_IN_ZIP}.`, code: "zip_too_many_files", size }];
    const outcomes: Outcome[] = [];
    for (const [index, entry] of projects.entries()) {
      const entrySize = entry.bytes.byteLength;
      const which = projects.length > 1 ? `File ${index + 1} of ${projects.length} · ` : "";
      try {
        outcomes.push(await convertOne(entry.name, entry.bytes, convert, releases, (text) => onStep(which + text)));
      } catch (error) {
        outcomes.push(failure(entry.name, error, entrySize));
        if (error instanceof Error && (error.message === CRASHED || error.message === STOPPED)) break;
      }
    }
    return outcomes;
  } catch (error) {
    return [failure(name, error, size)];
  }
}
