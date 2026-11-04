// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The text a user can copy into a bug report. It holds the failure's code, the browser, the site's host, the file's size
 * and the versions, and nothing that names the model or the user: no file name, no address, no message text (a message
 * can name something inside the file).
 */

export type ReportFacts = {
  code?: string;
  /** With `unsupported_slicer`: the slicer's name, as the library gives it. */
  slicer?: string;
  size?: number;
  site?: string | null;
  browser: string;
  extensionVersion: string;
  libraryVersion: string;
};

/** "Firefox 159", "Edge 156", "Chrome 156": the browser and its major version only, not the system. */
export function browserOf(userAgent: string): string {
  for (const [name, pattern] of [["Firefox", /Firefox\/(\d+)/], ["Edge", /Edg\/(\d+)/], ["Chrome", /Chrome\/(\d+)/]] as const) {
    const major = pattern.exec(userAgent)?.[1];
    if (major !== undefined) return `${name} ${major}`;
  }
  return "unknown browser";
}

const MAX_FIELD = 80;
const clean = (value: string) => value.replace(/[^\w .:/-]/g, "?").slice(0, MAX_FIELD);

export function failureReport(facts: ReportFacts): string {
  const lines = [
    "any2u1 failure report",
    `Error: ${clean(facts.code ?? "unknown")}${facts.slicer ? ` (${clean(facts.slicer)})` : ""}`,
    `Browser: ${clean(facts.browser)}`,
    ...(facts.site ? [`Site: ${clean(facts.site)}`] : []),
    ...(typeof facts.size === "number" ? [`File size: ${facts.size} bytes`] : []),
    versions(facts),
  ];
  return lines.join("\n");
}

/** Just the environment, for the settings page. */
export function diagnosticsReport(facts: Pick<ReportFacts, "browser" | "extensionVersion" | "libraryVersion">): string {
  return ["any2u1 diagnostics", `Browser: ${clean(facts.browser)}`, versions(facts)].join("\n");
}

const versions = (facts: Pick<ReportFacts, "extensionVersion" | "libraryVersion">) =>
  `any2u1 ${clean(facts.extensionVersion)}, any2orca ${clean(facts.libraryVersion)}`;
