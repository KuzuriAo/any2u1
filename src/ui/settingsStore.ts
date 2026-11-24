// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from "../browser";
import { parseSettings, type Settings } from "../core/settings";

export async function loadSettings(): Promise<Settings> {
  const { settings } = await api.storage.local.get("settings");
  return parseSettings(settings);
}

/** The last change this page asked for: the next one waits for it, so two changes close together can't each read the settings before the other has written. */
let lastChange: Promise<unknown> = Promise.resolve();

/** Reads the latest first, so a page left open doesn't undo what another page changed. Stores only the checked shape, with its limits. */
export function updateSettings(change: (settings: Settings) => void): Promise<Settings> {
  const done = lastChange.then(async () => {
    const settings = await loadSettings();
    change(settings);
    const checked = parseSettings(settings);
    await api.storage.local.set({ settings: checked });
    return checked;
  });
  lastChange = done.catch(() => {});
  return done;
}

export function onSettingsChanged(listener: (settings: Settings) => void): void {
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) listener(parseSettings(changes.settings.newValue));
  });
}
