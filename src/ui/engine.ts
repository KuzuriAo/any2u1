// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The converter, in a Web Worker on the extension's page (a service worker can't start one). The
 * profile catalog is inside the extension, so converting makes no request beyond the extension's own files.
 */
import { createConverterWorker, type ConverterWorker } from "any2orca/worker";
import ConverterWorkerScript from "any2orca/worker-entry?worker";
import { MAX_FILES_IN_ZIP, MAX_INPUT_BYTES } from "../core/limits";
import { is3mfName, isZipName, outputName } from "../core/names";
import { activeRelease } from "../core/releases";
import { convertOptions, type ConvertSettings } from "../core/settings";

export type Converted = {
  source: string;
  name: string;
  output: Uint8Array;
  profile: string;
  orcaVersion: string | undefined;
  notes: string[];
};
export type Failed = { source: string; error: string };
export type Outcome = Converted | Failed;

const CRASHED = "The conversion stopped, most likely because the browser ran out of memory for this file.";

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
  const fail = () => {
    crashed?.(new Error(CRASHED));
    worker?.terminate();
    worker = null;
  };
  script.addEventListener("error", fail);
  script.addEventListener("messageerror", fail);
  worker = createConverterWorker(script, { profilesUrl: new URL("profiles/", window.location.href) });
  return worker;
}

/** A crashed worker never answers, so every call waits on the crash as well as on its answer. */
function guarded<T>(work: Promise<T>): Promise<T> {
  return Promise.race([work, crash]);
}

export async function listReleases(): Promise<string[]> {
  const listing = await guarded(start().listProfiles());
  return listing.releases.map((release) => release.version);
}

/** The library's messages speak as the library; here, the user is talking to the extension. */
function inOurWords(message: string): string {
  return message.replace(/\bany2orca\b/g, "this extension");
}

function friendly(error: unknown, zip: boolean): string {
  const code = (error as { code?: string } | null)?.code;
  if (zip && code === "invalid_file") return "This zip has no 3MF file inside, or it is damaged.";
  return error instanceof Error ? inOurWords(error.message) : "Something went wrong.";
}

/** Reports the file's own story first, then what the library had to say. */
function notesFor(printerModel: string | null, sourceVendor: string, warnings: readonly string[], fallback: readonly string[] = [], unchanged: readonly string[] = []): string[] {
  const notes: string[] = [];
  if (sourceVendor === "snapmaker" && /\bU1\b/.test(printerModel ?? "")) notes.push("This file was already set up for the Snapmaker U1.");
  notes.push(...warnings.map(inOurWords));
  if (fallback.length > 0) notes.push(`Snapmaker makes no preset for ${fallback.join(", ")} at this nozzle size, so it uses Generic.`);
  if (unchanged.length > 0) notes.push(`No Snapmaker or Generic preset fits ${unchanged.join(", ")} at this nozzle size, so its name stays as the creator had it. Snapmaker Space may refuse this file.`);
  return notes;
}

async function convertOne(source: string, bytes: Uint8Array, convert: ConvertSettings, releases: readonly string[]): Promise<Converted> {
  const converter = start();
  const { project, inspection } = await guarded(converter.open(bytes, { transfer: true }));
  try {
    const { output, report } = await guarded(project.convert(convertOptions(convert, releases)));
    return {
      source,
      name: outputName(source),
      output,
      profile: report.profile.displayName,
      orcaVersion: activeRelease(convert.snapmakerOrcaVersion, releases),
      notes: notesFor(inspection.printerModel, inspection.sourceVendor, report.warnings, report.filamentComplianceFallback, report.filamentComplianceUnchanged),
    };
  } finally {
    await guarded(project.close()).catch(() => {});
  }
}

/** A 3MF, or a zip of them: one outcome per 3MF. One bad file doesn't stop the rest of a zip. */
export async function convertFile(name: string, bytes: Uint8Array, convert: ConvertSettings): Promise<Outcome[]> {
  if (bytes.byteLength > MAX_INPUT_BYTES) return [{ source: name, error: "This file is too large to convert in a browser: the limit is 1 GB." }];
  const zipName = isZipName(name);
  try {
    const releases = await listReleases();
    // Unpacking twice is wasted work on a large 3MF, so only a file that may be a zip is checked for one.
    const nested = is3mfName(name) ? null : await guarded(start().unwrapBundle(bytes));
    if (nested === null) return [await convertOne(name, bytes, convert, releases)];
    const projects = nested.filter((entry) => !entry.name.startsWith("._"));
    if (projects.length > MAX_FILES_IN_ZIP) return [{ source: name, error: `This zip holds ${projects.length} 3MF files; the limit is ${MAX_FILES_IN_ZIP}.` }];
    const outcomes: Outcome[] = [];
    for (const entry of projects) {
      try {
        outcomes.push(await convertOne(entry.name, entry.bytes, convert, releases));
      } catch (error) {
        outcomes.push({ source: entry.name, error: friendly(error, false) });
        if (error instanceof Error && error.message === CRASHED) break;
      }
    }
    return outcomes;
  } catch (error) {
    return [{ source: name, error: friendly(error, zipName) }];
  }
}
