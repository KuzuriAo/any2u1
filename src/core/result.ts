// SPDX-License-Identifier: AGPL-3.0-or-later
/** What a converted file's result says about what it was made for. */

export type MadeFor = {
  /** The profile's name in the catalog, e.g. "0.20mm Standard @Snapmaker U1 (0.4 nozzle)". */
  profile: string;
  /** The nozzle size the file is made for, e.g. "0.4". */
  nozzle: string;
  orcaVersion: string | undefined;
  /** The printer options that applied, e.g. "high-flow on T1". */
  printer: readonly string[];
};

/**
 * The profile with the size the file is made for: "0.20mm Standard, for 0.4 mm nozzles". The catalog's names end in
 * " @Snapmaker U1 (0.4 nozzle)", which the size says in words; a name without that part is shown whole.
 */
export function profileText(displayName: string, nozzle: string): string {
  const name = displayName.split(" @")[0]!.trim();
  return `${name || displayName}, for ${nozzle} mm nozzles`;
}

/** "using 0.20mm Standard, for 0.4 mm nozzles and Snapmaker Orca 2.4.1, high-flow on T1", for the line that says where it was saved. */
export function madeForText(made: MadeFor): string {
  const release = made.orcaVersion ? ` and Snapmaker Orca ${made.orcaVersion}` : "";
  return [`using ${profileText(made.profile, made.nozzle)}${release}`, ...made.printer].join(", ");
}
