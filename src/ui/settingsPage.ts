// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from "../browser";
import { listReleases } from "./engine";
import { button, el, need } from "./dom";
import { renderOptions } from "./optionsForm";
import { showReleaseNotice } from "./releaseNotice";
import { loadSettings, onSettingsChanged, updateSettings } from "./settingsStore";
import { diagnosticsReport } from "../core/report";
import { environment, reportBlock } from "./report";
import type { Settings } from "../core/settings";

const enabled = need<HTMLInputElement>("#enabled");
const askWhere = need<HTMLInputElement>("#ask-where");
const styleWindow = need<HTMLInputElement>("#style-window");
const styleBadge = need<HTMLInputElement>("#style-badge");
const quietList = need<HTMLUListElement>("#quiet");
const hostList = need<HTMLUListElement>("#hosts");
const options = need<HTMLElement>("#options");

function drawQuiet(settings: Settings): void {
  quietList.replaceChildren(...(settings.quietSites.length === 0
    ? [el("li", { class: "empty" }, "None.")]
    : settings.quietSites.map((site) => el("li", {}, el("span", {}, site), button("Remove", () => {
        void updateSettings((s) => (s.quietSites = s.quietSites.filter((other) => other !== site)));
      }, "link")))));
}

async function drawHosts(): Promise<void> {
  // Everything granted, including anything given in the browser's own extension settings rather than through this extension.
  const { origins: hosts = [] } = await api.permissions.getAll();
  hostList.replaceChildren(...(hosts.length === 0
    ? [el("li", { class: "empty" }, "None.")]
    : hosts.map((origin) => el("li", {}, el("span", {}, origin === "https://*/*" ? "All sites (given in the browser's settings)" : origin.replace(/^https:\/\//, "").replace(/\/\*$/, "")), button("Remove", () => {
        void api.permissions.remove({ origins: [origin] }).then(drawHosts);
      }, "link")))));
}

function drawSwitches(settings: Settings): void {
  enabled.checked = settings.enabled;
  styleWindow.checked = settings.offerStyle === "window";
  styleBadge.checked = settings.offerStyle === "badge";
  need("#pin-tip").hidden = settings.offerStyle !== "badge";
  askWhere.checked = settings.askWhereToSave;
}

enabled.addEventListener("change", () => void updateSettings((s) => (s.enabled = enabled.checked)));
styleWindow.addEventListener("change", () => void updateSettings((s) => (s.offerStyle = "window")));
styleBadge.addEventListener("change", () => void updateSettings((s) => (s.offerStyle = "badge")));
askWhere.addEventListener("change", () => void updateSettings((s) => (s.askWhereToSave = askWhere.checked)));

async function draw(): Promise<void> {
  const releases = await listReleases();
  // The notice comes first: it clears a saved choice the catalog no longer holds.
  await showReleaseNotice(releases);
  const settings = await loadSettings();
  drawSwitches(settings);
  drawQuiet(settings);
  renderOptions(options, settings.convert, releases);
}

onSettingsChanged((settings) => {
  drawSwitches(settings);
  drawQuiet(settings);
});
api.permissions.onRemoved?.addListener(() => void drawHosts());
api.permissions.onAdded?.addListener(() => void drawHosts());

need("#diagnostics").append(reportBlock(diagnosticsReport(environment()), "Copy the versions"));
/** Settings open in a tab of their own. This closes it, so nobody has to know to close the tab. */
need("#close").addEventListener("click", () => {
  void (async () => {
    try {
      const tab = await api.tabs.getCurrent();
      if (tab?.id !== undefined) {
        await api.tabs.remove(tab.id);
        return;
      }
    } catch {
      // Falls through to closing the page itself.
    }
    window.close();
  })();
});

need("#version").textContent = `any2u1 ${api.runtime.getManifest().version}, build ${__BUILD_ID__}`;
void draw();
void drawHosts();
