// SPDX-License-Identifier: AGPL-3.0-or-later
/** The conversion options, the same on the convert page and the settings page. */
import { activeRelease } from "../core/releases";
import type { ConvertSettings, FilamentNames, Settings } from "../core/settings";
import { el } from "./dom";
import { updateSettings } from "./settingsStore";

const FILAMENT_CHOICES: Array<{ value: FilamentNames; label: string }> = [
  { value: "original", label: "Keep the names in the file" },
  { value: "generic", label: "Generic" },
  { value: "snapmaker", label: "Snapmaker" },
];

/** The picker's value for "Newest": empty, so it can't be taken for a release number. */
const NEWEST = "";

function save(change: (convert: ConvertSettings) => void): void {
  void updateSettings((settings: Settings) => change(settings.convert));
}

export function renderOptions(container: HTMLElement, convert: ConvertSettings, releases: readonly string[]): void {
  // "Newest" (stored as null) follows the catalog; a number, the newest included, stays put. A choice the catalog no
  // longer holds shows as the release a conversion would use instead, until the release check saves it.
  const chosen = convert.snapmakerOrcaVersion;
  const exact = chosen === null ? null : (activeRelease(chosen, releases) ?? null);
  const version = el("select", { id: "orca-version" });
  if (releases[0] !== undefined) version.append(el("option", { value: NEWEST, selected: exact === null }, `Newest (currently ${releases[0]})`));
  for (const release of releases) version.append(el("option", { value: release, selected: release === exact }, release));
  version.addEventListener("change", () => save((c) => (c.snapmakerOrcaVersion = version.value === NEWEST ? null : version.value)));

  const toolheads = el("div", { class: "toolheads" });
  convert.highFlowToolheads.forEach((on, index) => {
    const box = el("input", { type: "checkbox", id: `high-flow-${index + 1}`, checked: on });
    box.addEventListener("change", () => save((c) => (c.highFlowToolheads[index] = box.checked)));
    toolheads.append(el("label", {}, box, `T${index + 1}`));
  });

  const hardened = el("input", { type: "checkbox", id: "hardened", checked: convert.hardenedNozzles });
  hardened.addEventListener("change", () => save((c) => (c.hardenedNozzles = hardened.checked)));

  const filament = el("select", { id: "filament-names" });
  for (const choice of FILAMENT_CHOICES) filament.append(el("option", { value: choice.value, selected: choice.value === convert.filamentNames }, choice.label));
  filament.addEventListener("change", () => save((c) => (c.filamentNames = filament.value as FilamentNames)));

  container.replaceChildren(
    el("div", { class: "field" },
      el("label", { for: "orca-version" }, "Snapmaker Orca version"),
      version,
      el("p", { class: "help" }, "Pick the version you have installed. Newest moves up when an update of the extension adds a release; a number stays until you change it.")),
    el("div", { class: "field" },
      el("span", { class: "label" }, "High-flow toolheads"),
      toolheads,
      el("p", { class: "help" }, "Tick each toolhead with the Liber High Flow Hotend.")),
    el("div", { class: "field" },
      el("label", { class: "check" }, hardened, "My nozzles are hardened steel"),
      el("p", { class: "help" }, "The stock U1 0.4 nozzle is stainless steel. Tick this if you fitted hardened steel, so Snapmaker Orca warns about abrasive filaments correctly.")),
    el("div", { class: "field" },
      el("label", { for: "filament-names" }, "Filament names"),
      filament,
      el("p", { class: "help" }, "Only the name and brand change; temperatures, flow and retraction stay as the creator set them. Snapmaker Space accepts a file only if every filament name starts with Snapmaker or Generic.")),
  );
}
