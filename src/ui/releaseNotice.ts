// SPDX-License-Identifier: AGPL-3.0-or-later
/** Says once, and until dismissed, that an update changed which Snapmaker Orca releases are available. */
import { api } from "../browser";
import { parseKnownReleases, releaseChange, releaseNoticeText, settledChoice } from "../core/releases";
import { button, el, need } from "./dom";
import { loadSettings, updateSettings } from "./settingsStore";

const KNOWN_KEY = "knownReleases";
const NOTICE_KEY = "releaseNotice";

function draw(text: unknown): void {
  const box = need<HTMLElement>("#release-notice");
  box.hidden = typeof text !== "string" || text === "";
  if (box.hidden) return;
  box.replaceChildren(el("span", {}, text as string), " ", button("Got it", () => void api.storage.local.remove(NOTICE_KEY), "link dismiss-notice"));
}

export async function showReleaseNotice(releases: readonly string[]): Promise<void> {
  const stored = await api.storage.local.get([KNOWN_KEY, NOTICE_KEY]);
  const known = parseKnownReleases(stored[KNOWN_KEY]);
  let notice = stored[NOTICE_KEY];
  const { convert } = await loadSettings();
  const chosen = convert.snapmakerOrcaVersion;
  // A first run has nothing to announce; a notice stays until dismissed, and the next new release brings it back.
  if (known !== null) {
    const text = releaseNoticeText(releaseChange(known, releases, chosen), releases, chosen);
    if (text !== null) {
      notice = typeof notice === "string" && notice !== "" ? `${notice} ${text}` : text;
      await api.storage.local.set({ [NOTICE_KEY]: notice });
    }
  }
  const settled = settledChoice(known, releases, chosen);
  if (settled !== chosen) await updateSettings((settings) => (settings.convert.snapmakerOrcaVersion = settled));
  await api.storage.local.set({ [KNOWN_KEY]: [...releases] });
  draw(notice);
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[NOTICE_KEY]) draw(changes[NOTICE_KEY].newValue);
  });
}
