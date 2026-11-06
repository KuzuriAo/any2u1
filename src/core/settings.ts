// SPDX-License-Identifier: AGPL-3.0-or-later
/** The user's settings. Whatever storage holds is checked on the way in, and anything malformed falls back to the default. */

export type FilamentNames = "original" | "generic" | "snapmaker";
export type OfferStyle = "window" | "badge";
export type Toolheads = [boolean, boolean, boolean, boolean];

export type ConvertSettings = {
  /** A release number stays put; null ("Newest" in the options) follows the newest release the catalog holds. A first run pins the newest. */
  snapmakerOrcaVersion: string | null;
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
    convert: { snapmakerOrcaVersion: null, highFlowToolheads: [false, false, false, false], hardenedNozzles: false, filamentNames: "original" },
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
      highFlowToolheads: isToolheads(convert.highFlowToolheads) ? convert.highFlowToolheads : defaults.convert.highFlowToolheads,
      hardenedNozzles: convert.hardenedNozzles === true,
      filamentNames: convert.filamentNames === "generic" || convert.filamentNames === "snapmaker" ? convert.filamentNames : "original",
    },
  };
}

/**
 * What the library is asked for, given the releases its catalog holds. A saved release that's gone falls back to the
 * newest. High-flow is sent only where the file's nozzle has a high-flow option, as the web app does: the library would
 * ignore it with a warning, which would show on every file of another nozzle size.
 */
export function convertOptions(convert: ConvertSettings, releases: readonly string[], highFlowSupported = true) {
  const version = convert.snapmakerOrcaVersion;
  return {
    ...(version !== null && releases.includes(version) ? { snapmakerOrcaVersion: version } : {}),
    highFlowHotends: highFlowSupported && convert.highFlowToolheads.some(Boolean) ? [...convert.highFlowToolheads] : false,
    hardenedNozzles: convert.hardenedNozzles,
    ...(convert.filamentNames === "original" ? {} : { filamentComplianceMode: convert.filamentNames }),
  };
}

/** The printer options a file was made with, for its result: only those that applied to its nozzle. */
export function describePrinter(convert: ConvertSettings, nozzle: string | null, highFlowSupported: boolean): string[] {
  const toolheads = convert.highFlowToolheads.flatMap((on, index) => (on ? [`T${index + 1}`] : []));
  return [
    ...(highFlowSupported && toolheads.length > 0 ? [`high-flow on ${toolheads.join(", ")}`] : []),
    // The library applies this to the 0.4 mm profile only.
    ...(convert.hardenedNozzles && (nozzle ?? "0.4") === "0.4" ? ["hardened steel nozzles"] : []),
  ];
}

/** Exact hosts only, so that quieting one bucket on a storage provider doesn't quiet every site using that provider. */
export function isQuiet(hosts: readonly string[], quietSites: readonly string[]): boolean {
  return hosts.some((host) => quietSites.includes(host));
}
