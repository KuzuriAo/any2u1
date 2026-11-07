// SPDX-License-Identifier: AGPL-3.0-or-later
/** A result's notes: the library's warnings, then what the filament option did, in the library's own sentences. */
import { filamentNotes, type ConvertReport } from "any2orca";

export type NotesReport = Pick<ConvertReport, "warnings" | "filamentPresets" | "filamentComplianceFallback" | "filamentComplianceUnchanged">;

export function notesFor(report: NotesReport): string[] {
  return [...report.warnings, ...filamentNotes(report)];
}
