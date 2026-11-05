// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from "../browser";
import { parseSettings, type Settings } from "../core/settings";

export async function loadSettings(): Promise<Settings> {
  const { settings } = await api.storage.local.get("settings");
  return parseSettings(settings);
}

/** Reads the latest first, so a page left open doesn't undo what another page changed. Stores only the checked shape, with its limits. */
export async function updateSettings(change: (settings: Settings) => void): Promise<Settings> {
  const settings = await loadSettings();
  change(settings);
  const checked = parseSettings(settings);
  await api.storage.local.set({ settings: checked });
  return checked;
}

export function onSettingsChanged(listener: (settings: Settings) => void): void {
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) listener(parseSettings(changes.settings.newValue));
  });
}
