// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The first-run panel on the convert page (`convert.html?view=welcome`, opened once on install): what the extension does
 * by itself, and how to pin its button. No browser lets an extension pin itself, so the panel gives the steps and says
 * whether the button is pinned, read with `action.getUserSettings` where the browser has it.
 */
import { api } from "../browser";
import { browserFamily, pinSteps } from "../core/pinSteps";
import { need } from "./dom";

type ActionWithSettings = {
  getUserSettings?: () => Promise<{ isOnToolbar?: boolean }>;
  onUserSettingsChanged?: { addListener(listener: (change: { isOnToolbar?: boolean }) => void): void };
};

/** Shows the panel and keeps its pinned line current. Does nothing outside `view=welcome`. */
export function showWelcome(): void {
  if (new URLSearchParams(location.search).get("view") !== "welcome") return;
  const panel = need<HTMLElement>("#welcome");
  const state = need<HTMLElement>("#pin-state");
  const steps = need<HTMLElement>("#pin-steps");
  const runtime = api.runtime as typeof api.runtime & { getBrowserInfo?: unknown };
  const brands = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData?.brands ?? [];
  steps.textContent = pinSteps(browserFamily({ hasGetBrowserInfo: typeof runtime.getBrowserInfo === "function", brands: brands.map((entry) => entry.brand), userAgent: navigator.userAgent }));
  panel.hidden = false;

  const action = api.action as unknown as ActionWithSettings;
  const draw = (pinned: boolean | undefined) => {
    state.textContent =
      pinned === true ? "The any2u1 button is pinned to your toolbar."
      : pinned === false ? "The any2u1 button isn't pinned to your toolbar yet. To pin it:"
      // A browser that can't say: the steps, without a claim either way.
      : "To pin the any2u1 button to your toolbar:";
    steps.hidden = pinned === true;
  };
  const read = () => {
    if (typeof action.getUserSettings !== "function") return draw(undefined);
    action.getUserSettings().then((settings) => draw(typeof settings?.isOnToolbar === "boolean" ? settings.isOnToolbar : undefined), () => draw(undefined));
  };
  read();
  // The change event isn't in every release the extension supports; without it, the line is read again when the page is back in front.
  if (action.onUserSettingsChanged) action.onUserSettingsChanged.addListener(() => read());
  window.addEventListener("focus", read);
}
