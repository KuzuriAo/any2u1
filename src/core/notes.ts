// SPDX-License-Identifier: AGPL-3.0-or-later
/** A result's notes: the library's own list, in its order, under a heading for each topic. */
import type { ConvertNote, KnownNoteTopic } from "any2orca";

/** A heading for each topic the library names; a test checks this covers the library's `NOTE_TOPICS`. */
export const TOPIC_TITLES: Readonly<Record<KnownNoteTopic, string>> = {
  "filament-diameter": "Filament diameter",
  nozzle: "Nozzle size",
  profile: "Profile",
  "filament-presets": "Filament presets",
  source: "From the file",
  settings: "Settings",
  plates: "Plates",
};

/** For a topic a later library adds. The library puts those last, so they share one heading. */
export const OTHER_TITLE = "Other notes";

export type NoteGroup = { title: string; notes: string[] };

const titleFor = (topic: string): string => (Object.hasOwn(TOPIC_TITLES, topic) ? TOPIC_TITLES[topic as KnownNoteTopic] : OTHER_TITLE);

/**
 * The notes in the order given, each run under one heading. Nothing is moved: a topic that came back later in the list
 * would get its heading again, so what needs doing first, such as loading other filament, stays first.
 */
export function noteGroups(notes: readonly ConvertNote[]): NoteGroup[] {
  const groups: NoteGroup[] = [];
  for (const note of notes) {
    const title = titleFor(note.topic);
    const last = groups.at(-1);
    if (last?.title === title) last.notes.push(note.text);
    else groups.push({ title, notes: [note.text] });
  }
  return groups;
}
