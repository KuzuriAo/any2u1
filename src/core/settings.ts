// SPDX-License-Identifier: AGPL-3.0-or-later
/** The user's settings. Whatever storage holds is checked on the way in, and anything malformed falls back to the default. */
import { activeRelease } from "./releases";

export type FilamentNames = "original" | "generic" | "snapmaker";

/** The help under the Filament option, in the words the any2orca web app uses, so the two say the same. */
export const FILAMENT_HELP =
  "Original keeps the creator's filaments exactly: their names and their settings. Generic and Snapmaker switch each filament to a preset Snapmaker Orca ships, with that preset's own settings, for uploads to Snapmaker Space; colors and order stay. Snapmaker Orca would use the preset's settings anyway once a filament carries its name.";
/**
 * The nozzle sizes a file can be made for, as the library's `NOZZLE_CHOICES` lists them (a test checks they agree), and
 * "match" for the size the creator used. Kept here rather than imported, so the background script doesn't load the library.
 */
export const NOZZLE_SIZES = ["0.2", "0.4", "0.6", "0.8", "match"] as const;
export type NozzleSize = (typeof NOZZLE_SIZES)[number];
/** The U1's stock nozzles, the library's `DEFAULT_NOZZLE`. */
export const DEFAULT_NOZZLE_SIZE: NozzleSize = "0.4";

/** The help under the nozzle size option. */
export const NOZZLE_HELP =
  "The converted file is made for this nozzle size. The U1's stock nozzles are 0.4 mm, and Snapmaker Orca uses one size for all four toolheads. A project made for another size is converted anyway and you're told; 'Match the file' converts for the size the creator used.";
export type OfferStyle = "window" | "badge";
export type Toolheads = [boolean, boolean, boolean, boolean];

export type ConvertSettings = {
  /** A release number stays put; null ("Newest" in the options) follows the newest release the catalog holds. A first run pins the newest. */
  snapmakerOrcaVersion: string | null;
  /** The size every file is made for, whatever size its creator used; "match" makes each file for its creator's size. */
  nozzle: NozzleSize;
  highFlowToolheads: Toolheads;
  hardenedNozzles: boolean;
  filamentNames: FilamentNames;
};

export type Settings = {
  enabled: boolean;
  offerStyle: OfferStyle;
  /** Hosts with no offer, without a leading `www.`. */
  quietSites: string[];
  /** Open the browser's Save dialog for each converted file, so it can be renamed or put elsewhere. */
  askWhereToSave: boolean;
  convert: ConvertSettings;
};

const MAX_QUIET_SITES = 500;
const MAX_HOST = 253;

export function defaultSettings(): Settings {
  return {
    enabled: true,
    offerStyle: "window",
    quietSites: [],
    askWhereToSave: false,
    convert: { snapmakerOrcaVersion: null, nozzle: DEFAULT_NOZZLE_SIZE, highFlowToolheads: [false, false, false, false], hardenedNozzles: false, filamentNames: "original" },
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isToolheads(value: unknown): value is Toolheads {
  return Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === "boolean");
}

export function parseSettings(stored: unknown): Settings {
  const defaults = defaultSettings();
  const raw = record(stored);
  const convert = record(raw.convert);
  const version = convert.snapmakerOrcaVersion;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
    offerStyle: raw.offerStyle === "badge" ? "badge" : "window",
    // The newest are kept, so a site quieted when the list is full isn't the one left out.
    quietSites: Array.isArray(raw.quietSites)
      ? [...new Set(raw.quietSites.filter((host): host is string => typeof host === "string" && host !== "" && host.length <= MAX_HOST))].slice(-MAX_QUIET_SITES)
      : [],
    askWhereToSave: raw.askWhereToSave === true,
    convert: {
      snapmakerOrcaVersion: typeof version === "string" && /^\d+(\.\d+){1,3}$/.test(version) ? version : null,
      nozzle: NOZZLE_SIZES.find((size) => size === convert.nozzle) ?? DEFAULT_NOZZLE_SIZE,
      highFlowToolheads: isToolheads(convert.highFlowToolheads) ? convert.highFlowToolheads : defaults.convert.highFlowToolheads,
      hardenedNozzles: convert.hardenedNozzles === true,
      filamentNames: convert.filamentNames === "generic" || convert.filamentNames === "snapmaker" ? convert.filamentNames : "original",
    },
  };
}

/**
 * What the library is asked for, given the releases its catalog holds. "Newest" sends no release, so the library uses
 * its newest; a saved release that's gone sends the one `activeRelease` moves it to. The nozzle size is always sent. High-flow is
 * sent only where the size the file is made for has a high-flow option, as the web app does: the library would ignore it with a
 * warning, which would show on every file made for another size.
 */
export function convertOptions(convert: ConvertSettings, releases: readonly string[], highFlowSupported = true) {
  const version = convert.snapmakerOrcaVersion === null ? undefined : activeRelease(convert.snapmakerOrcaVersion, releases);
  return {
    ...(version !== undefined ? { snapmakerOrcaVersion: version } : {}),
    nozzle: convert.nozzle,
    highFlowHotends: highFlowSupported && convert.highFlowToolheads.some(Boolean) ? [...convert.highFlowToolheads] : false,
    hardenedNozzles: convert.hardenedNozzles,
    ...(convert.filamentNames === "original" ? {} : { filamentComplianceMode: convert.filamentNames }),
  };
}

/**
 * The size a file will be made for, before it's converted: the size chosen, or with "match" the creator's size as the library
 * snaps it to a U1 size (`inspection.matchNozzleDiameter`), and the stock size where the file gives none, as the library does.
 */
export function nozzleFor(choice: NozzleSize, creatorSize: string | null): string {
  return choice === "match" ? (creatorSize ?? DEFAULT_NOZZLE_SIZE) : choice;
}

/** The printer options a file was made with, for its result: only those that applied to the size it was made for. */
export function describePrinter(convert: ConvertSettings, nozzle: string, highFlowSupported: boolean): string[] {
  const toolheads = convert.highFlowToolheads.flatMap((on, index) => (on ? [`T${index + 1}`] : []));
  return [
    ...(highFlowSupported && toolheads.length > 0 ? [`high-flow on ${toolheads.join(", ")}`] : []),
    // The library applies this to the 0.4 mm profile only.
    ...(convert.hardenedNozzles && nozzle === "0.4" ? ["hardened steel nozzles"] : []),
  ];
}

/** Exact hosts only, so that quieting one bucket on a storage provider doesn't quiet every site using that provider. */
export function isQuiet(hosts: readonly string[], quietSites: readonly string[]): boolean {
  return hosts.some((host) => quietSites.includes(host));
}
