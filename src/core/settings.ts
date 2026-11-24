// SPDX-License-Identifier: AGPL-3.0-or-later
/** The user's settings. Whatever storage holds is checked on the way in, and anything malformed falls back to the default. */
import { activeRelease } from "./releases";

/** The Filament option's choices, in the order shown: the creator's own, then the library's `FILAMENT_COMPLIANCE_MODES` (a test checks they agree). */
export const FILAMENT_NAMES = ["original", "snapmaker", "polymaker", "generic"] as const;
export type FilamentNames = (typeof FILAMENT_NAMES)[number];

/** Each choice's name and what it does, in the words the any2orca web app uses, so the two say the same. */
export const FILAMENT_CHOICES: Readonly<Record<FilamentNames, { label: string; description: string }>> = {
  original: { label: "Original", description: "Keep the creator's filaments: names and settings as in the file." },
  snapmaker: { label: "Snapmaker", description: "Switch to Snapmaker presets, with their own settings, for Snapmaker Space." },
  polymaker: { label: "Polymaker", description: "Switch PLA to Polymaker presets, with their own settings; other filaments as Snapmaker." },
  generic: { label: "Generic", description: "Switch to Generic presets, with their own settings." },
};

/** The help under the Filament option, in the web app's words too. */
export const FILAMENT_HELP =
  "Original keeps the creator's filaments exactly: their names and their settings. Snapmaker, Polymaker and Generic switch each filament to a preset Snapmaker Orca ships, with that preset's own settings, for uploads to Snapmaker Space; colors and order stay. Snapmaker Orca would use the preset's settings anyway once a filament carries its name.";

/** Why Polymaker can't be chosen for a nozzle size, given the sizes Snapmaker Orca has Polymaker presets for: "… for the 0.4 mm nozzle only." */
export function polymakerReason(sizes: readonly string[]): string {
  if (sizes.length === 0) return "This Snapmaker Orca version has no Polymaker presets.";
  const list = sizes.length === 1 ? sizes[0] : `${sizes.slice(0, -1).join(", ")} and ${sizes.at(-1)}`;
  return `Snapmaker Orca has Polymaker presets for the ${list} mm ${sizes.length === 1 ? "nozzle" : "nozzles"} only.`;
}
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

/** The help under the Layer height option, in the words the any2orca web app uses. */
export const LAYER_HEIGHT_HELP =
  "Converts the project with one layer height for every layer, from your nozzle's U1 profiles. It replaces the creator's variable layer heights and any layer heights set for part of the model.";
/** Under the Layer height option when the nozzle size is "Match the file": there is no one size to list heights for. */
export const LAYER_HEIGHT_MATCH_HELP = "The layer heights to choose from depend on the nozzle size, so there are none with 'Match the file'.";
/** The Layer height option's first choice: nothing is sent, and the creator's layers stay. */
export const KEEP_LAYERS = "Keep the creator's layers";
/** A layer height can't be more than this; the library refuses more. Only keeps a stored value sane: the catalog's list decides. */
const MAX_LAYER_HEIGHT = 10;

/** "0.3 mm", "0.18 mm": at most three decimals, with no trailing zeros. */
export const layerHeightText = (height: number) => `${Number(height.toFixed(3))} mm`;

/**
 * What the catalog offers for one Snapmaker Orca release: each nozzle size's profile layer heights, lowest first, and the
 * nozzle sizes that have Polymaker presets (null when that couldn't be read, and then Polymaker is offered for every size:
 * the library converts it as Snapmaker where it has no presets, and says so).
 */
export type OptionChoices = {
  layerHeights: Readonly<Record<string, readonly number[]>>;
  polymakerSizes: readonly string[] | null;
};

/** Each nozzle size's layer heights, from a profile list: every height once, lowest first. Anything that isn't a height is left out. */
export function layerHeightsBySize(profiles: ReadonlyArray<{ nozzleDiameter?: unknown; layerHeight?: unknown }>): Record<string, number[]> {
  const sizes: Record<string, number[]> = {};
  for (const { nozzleDiameter, layerHeight } of profiles) {
    if (typeof nozzleDiameter !== "string" || !NOZZLE_SIZES.some((size) => size === nozzleDiameter && size !== "match")) continue;
    if (typeof layerHeight !== "number" || !Number.isFinite(layerHeight) || layerHeight <= 0 || layerHeight > MAX_LAYER_HEIGHT) continue;
    const heights = (sizes[nozzleDiameter] ??= []);
    if (!heights.includes(layerHeight)) heights.push(layerHeight);
  }
  for (const heights of Object.values(sizes)) heights.sort((a, b) => a - b);
  return sizes;
}

/** The layer heights to choose from for a nozzle size: none for "match", where the size differs from file to file. */
export function layerHeightsFor(choices: OptionChoices | undefined, nozzle: NozzleSize): readonly number[] {
  return nozzle === "match" ? [] : (choices?.layerHeights[nozzle] ?? []);
}

/** Whether Polymaker can be chosen: not for a nozzle size the catalog has no Polymaker preset for. With "match" the size isn't known, so it can. */
export function polymakerOffered(choices: OptionChoices | undefined, nozzle: NozzleSize): boolean {
  const sizes = choices?.polymakerSizes;
  return nozzle === "match" || sizes === null || sizes === undefined || sizes.includes(nozzle);
}

/**
 * The options as they can be for the nozzle size and release chosen: a layer height the size doesn't have goes back to the
 * creator's layers, and Polymaker where it has no presets becomes Snapmaker, which converts to the same file there.
 * Without the catalog's choices, nothing is changed.
 */
export function settleConvert(convert: ConvertSettings, choices: OptionChoices | undefined): ConvertSettings {
  if (choices === undefined) return convert;
  const layerHeight = convert.layerHeight !== null && layerHeightsFor(choices, convert.nozzle).includes(convert.layerHeight) ? convert.layerHeight : null;
  const filamentNames = convert.filamentNames === "polymaker" && !polymakerOffered(choices, convert.nozzle) ? "snapmaker" : convert.filamentNames;
  return layerHeight === convert.layerHeight && filamentNames === convert.filamentNames ? convert : { ...convert, layerHeight, filamentNames };
}

export type OfferStyle = "window" | "badge";
export type Toolheads = [boolean, boolean, boolean, boolean];

export type ConvertSettings = {
  /** A release number stays put; null ("Newest" in the options) follows the newest release the catalog holds. A first run pins the newest. */
  snapmakerOrcaVersion: string | null;
  /** The size every file is made for, whatever size its creator used; "match" makes each file for its creator's size. */
  nozzle: NozzleSize;
  /** One layer height in mm for every layer, one of the nozzle size's profile heights; null keeps the creator's layers. */
  layerHeight: number | null;
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
    convert: { snapmakerOrcaVersion: null, nozzle: DEFAULT_NOZZLE_SIZE, layerHeight: null, highFlowToolheads: [false, false, false, false], hardenedNozzles: false, filamentNames: "original" },
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
  const nozzle = NOZZLE_SIZES.find((size) => size === convert.nozzle) ?? DEFAULT_NOZZLE_SIZE;
  const height = convert.layerHeight;
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
      nozzle,
      // Whether the size has this height is the catalog's to say, where the options are drawn and where a file is converted.
      layerHeight: nozzle !== "match" && typeof height === "number" && Number.isFinite(height) && height > 0 && height <= MAX_LAYER_HEIGHT ? height : null,
      highFlowToolheads: isToolheads(convert.highFlowToolheads) ? convert.highFlowToolheads : defaults.convert.highFlowToolheads,
      hardenedNozzles: convert.hardenedNozzles === true,
      filamentNames: FILAMENT_NAMES.find((choice) => choice === convert.filamentNames) ?? "original",
    },
  };
}

/**
 * What the library is asked for, given the releases its catalog holds. "Newest" sends no release, so the library uses
 * its newest; a saved release that's gone sends the one `activeRelease` moves it to. The nozzle size is always sent. High-flow is
 * sent only where the size the file is made for has a high-flow option, as the web app does: the library would ignore it with a
 * warning, which would show on every file made for another size. The layer height is sent only when it's one of
 * `layerHeights`, the heights the size the file is made for has: the library refuses any other, and a stored value the
 * catalog no longer has must not fail every file.
 */
export function convertOptions(convert: ConvertSettings, releases: readonly string[], highFlowSupported = true, layerHeights: readonly number[] = []) {
  const version = convert.snapmakerOrcaVersion === null ? undefined : activeRelease(convert.snapmakerOrcaVersion, releases);
  return {
    ...(version !== undefined ? { snapmakerOrcaVersion: version } : {}),
    nozzle: convert.nozzle,
    ...(convert.layerHeight !== null && layerHeights.includes(convert.layerHeight) ? { layerHeight: convert.layerHeight } : {}),
    highFlowHotends: highFlowSupported && convert.highFlowToolheads.some(Boolean) ? [...convert.highFlowToolheads] : false,
    hardenedNozzles: convert.hardenedNozzles,
    ...(convert.filamentNames === "original" ? {} : { filamentComplianceMode: convert.filamentNames }),
  };
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
