// SPDX-License-Identifier: AGPL-3.0-or-later
/** The conversion options, the same on the convert page and the settings page. */
import { activeRelease, releaseGroups } from "../core/releases";
import {
  FILAMENT_CHOICES,
  FILAMENT_HELP,
  FILAMENT_NAMES,
  KEEP_LAYERS,
  LAYER_HEIGHT_HELP,
  LAYER_HEIGHT_MATCH_HELP,
  layerHeightsFor,
  layerHeightText,
  NOZZLE_HELP,
  NOZZLE_SIZES,
  polymakerOffered,
  polymakerReason,
  settleConvert,
  type ConvertSettings,
  type FilamentNames,
  type NozzleSize,
  type OptionChoices,
  type Settings,
} from "../core/settings";
import { el } from "./dom";
import { updateSettings } from "./settingsStore";

/** The picker's value for "Newest": empty, so it can't be taken for a release number. */
const NEWEST = "";

function save(change: (convert: ConvertSettings) => void): void {
  void updateSettings((settings: Settings) => change(settings.convert));
}

/**
 * The control under the picker that adds the older releases to it, or takes them out. Its name stays the same and
 * `aria-expanded` says whether the list is open. While an older release is selected it's hidden, since closing the
 * list then would show a choice other than the one saved.
 */
function olderVersions(version: HTMLSelectElement, group: HTMLOptGroupElement, open: boolean): HTMLButtonElement {
  const toggle = el("button", { type: "button", class: "link disclosure", "aria-controls": "orca-version", "aria-expanded": "false" }, `Older versions (${group.children.length})`);
  const show = (open: boolean) => {
    toggle.setAttribute("aria-expanded", String(open));
    if (open) version.append(group);
    else group.remove();
  };
  const hideWhileOlder = () => (toggle.hidden = group.contains(version.selectedOptions[0] ?? null));
  show(open);
  hideWhileOlder();
  toggle.addEventListener("click", () => show(toggle.getAttribute("aria-expanded") !== "true"));
  version.addEventListener("change", hideWhileOlder);
  return toggle;
}

/** The release a version choice converts for: the newest for "Newest", and the one a dropped choice moves to. */
export const releaseFor = (chosen: string | null, releases: readonly string[]) => activeRelease(chosen, releases) ?? releases[0];

/**
 * `initial` is what the catalog offers for the stored version's release: the layer heights of each nozzle size, and where
 * Polymaker has presets. `load` reads the same for another release, when the version is changed here. The layer height
 * list and the Polymaker choice follow the nozzle size and the version as they are changed.
 */
export function renderOptions(
  container: HTMLElement,
  stored: ConvertSettings,
  releases: readonly string[],
  initial?: OptionChoices,
  load: (release: string) => Promise<OptionChoices | undefined> = async () => undefined,
): void {
  let offered = initial;
  // What is stored, as it can be: a layer height or a Polymaker choice the size chosen doesn't have is put right, and saved so.
  const convert = settleConvert(stored, offered);
  if (convert !== stored) save((c) => Object.assign(c, settleConvert(c, initial)));
  // "Newest" (stored as null) follows the catalog; a number, the newest included, stays put. A choice the catalog no
  // longer holds shows as the release a conversion would use instead, until the release check saves it.
  const chosen = convert.snapmakerOrcaVersion;
  const exact = chosen === null ? null : (activeRelease(chosen, releases) ?? null);
  const { shown, older, olderOpen } = releaseGroups(releases, exact);
  const option = (release: string) => el("option", { value: release, selected: release === exact }, release);
  const version = el("select", { id: "orca-version" });
  if (releases[0] !== undefined) version.append(el("option", { value: NEWEST, selected: exact === null }, `Newest (currently ${releases[0]})`));
  for (const release of shown) version.append(option(release));
  const chosenVersion = () => (version.value === NEWEST ? null : version.value);
  version.addEventListener("change", () => {
    const value = chosenVersion();
    save((c) => (c.snapmakerOrcaVersion = value));
    // The other release's heights and Polymaker sizes are read now; until then the form keeps what it showed.
    const release = releaseFor(value, releases);
    void (release === undefined ? Promise.resolve(undefined) : load(release)).then((next) => {
      if (chosenVersion() !== value) return;
      offered = next;
      save((c) => {
        if (c.snapmakerOrcaVersion === value) Object.assign(c, settleConvert(c, next));
      });
      follow();
    });
  });
  const olderToggle = older.length > 0 ? olderVersions(version, el("optgroup", { label: "Older versions" }, ...older.map(option)), olderOpen) : null;

  const nozzle = el("select", { id: "nozzle-size" });
  for (const size of NOZZLE_SIZES) nozzle.append(el("option", { value: size, selected: size === convert.nozzle }, size === "match" ? "Match the file" : `${size} mm`));
  nozzle.addEventListener("change", () => {
    const size = nozzle.value as NozzleSize;
    const now = offered;
    save((c) => Object.assign(c, settleConvert({ ...c, nozzle: size }, now)));
    follow();
  });

  const layer = el("select", { id: "layer-height" });
  const layerHelp = el("p", { class: "help" });
  let layerHeight = convert.layerHeight;
  layer.addEventListener("change", () => {
    const height = layer.value === "" ? null : Number(layer.value);
    layerHeight = height;
    save((c) => (c.layerHeight = height));
  });

  const toolheads = el("div", { class: "toolheads" });
  convert.highFlowToolheads.forEach((on, index) => {
    const box = el("input", { type: "checkbox", id: `high-flow-${index + 1}`, checked: on });
    box.addEventListener("change", () => save((c) => (c.highFlowToolheads[index] = box.checked)));
    toolheads.append(el("label", {}, box, `T${index + 1}`));
  });

  const hardened = el("input", { type: "checkbox", id: "hardened", checked: convert.hardenedNozzles });
  hardened.addEventListener("change", () => save((c) => (c.hardenedNozzles = hardened.checked)));

  const filament = el("select", { id: "filament-names" });
  for (const choice of FILAMENT_NAMES) filament.append(el("option", { value: choice, selected: choice === convert.filamentNames }, FILAMENT_CHOICES[choice].label));
  const filamentChoice = el("p", { id: "filament-choice", class: "help" });
  const polymakerWhy = el("p", { id: "polymaker-reason", class: "help" });
  const describe = () => (filamentChoice.textContent = FILAMENT_CHOICES[filament.value as FilamentNames]?.description ?? "");
  filament.addEventListener("change", () => {
    describe();
    save((c) => (c.filamentNames = filament.value as FilamentNames));
  });

  /**
   * Draws what depends on the nozzle size and the version, from the form's own values: the layer heights to choose from,
   * and whether Polymaker can be chosen. A height or a Polymaker choice the new size doesn't have goes back to its
   * default here, as the save beside each change does in storage.
   */
  function follow(): void {
    const size = nozzle.value as NozzleSize;
    const heights = layerHeightsFor(offered, size);
    if (layerHeight !== null && !heights.includes(layerHeight)) layerHeight = null;
    layer.replaceChildren(
      el("option", { value: "", selected: layerHeight === null }, KEEP_LAYERS),
      ...heights.map((each) => el("option", { value: String(each), selected: each === layerHeight }, layerHeightText(each))),
    );
    layer.disabled = size === "match";
    layerHelp.textContent = size === "match" ? LAYER_HEIGHT_MATCH_HELP : LAYER_HEIGHT_HELP;

    const polymaker = [...filament.options].find((option) => option.value === "polymaker");
    const canChoose = polymakerOffered(offered, size);
    if (polymaker) polymaker.disabled = !canChoose;
    if (!canChoose && filament.value === "polymaker") filament.value = "snapmaker";
    polymakerWhy.hidden = canChoose;
    polymakerWhy.textContent = canChoose ? "" : polymakerReason(offered?.polymakerSizes ?? []);
    describe();
  }
  follow();

  container.replaceChildren(
    el("div", { class: "field" },
      el("label", { for: "orca-version" }, "Snapmaker Orca version"),
      version,
      olderToggle,
      el("p", { class: "help" }, "Pick the version you have installed. Newest moves up when an update of the extension adds a release; a number stays until you change it.")),
    el("div", { class: "field" },
      el("label", { for: "nozzle-size" }, "Your U1's nozzle size"),
      nozzle,
      el("p", { class: "help" }, NOZZLE_HELP)),
    el("div", { class: "field" },
      el("label", { for: "layer-height" }, "Layer height"),
      layer,
      layerHelp),
    el("div", { class: "field" },
      el("span", { class: "label" }, "High-flow toolheads"),
      toolheads,
      el("p", { class: "help" }, "Tick each toolhead with the Liber High Flow Hotend.")),
    el("div", { class: "field" },
      el("label", { class: "check" }, hardened, "My nozzles are hardened steel"),
      el("p", { class: "help" }, "The stock U1 0.4 nozzle is stainless steel. Tick this if you fitted hardened steel, so Snapmaker Orca warns about abrasive filaments correctly.")),
    el("div", { class: "field" },
      el("label", { for: "filament-names" }, "Filament"),
      filament,
      filamentChoice,
      polymakerWhy,
      el("p", { class: "help" }, FILAMENT_HELP)),
  );
}
