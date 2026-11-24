// SPDX-License-Identifier: AGPL-3.0-or-later
/** A report the user can read and copy. What goes in it is decided in core/report.ts. */
import { api } from "../browser";
import { browserOf, REPORT_PROBLEM_URL } from "../core/report";
import { button, el } from "./dom";

export const environment = () => ({ browser: browserOf(navigator.userAgent), extensionVersion: api.runtime.getManifest().version, libraryVersion: __LIBRARY_VERSION__ });

/** The report's text is always shown, so the user sees exactly what they'd be sharing; Copy only saves selecting it. */
export function reportBlock(text: string, label: string): HTMLElement {
  const details = el("details", { class: "report-text" }, el("summary", {}, "What's in it"), el("pre", {}, text));
  const copy = button(label, () => {
    navigator.clipboard.writeText(text).then(
      () => (copy.textContent = "Copied"),
      () => {
        copy.textContent = "Couldn't copy: select the text below";
        details.open = true;
      },
    );
  }, "link copy-report");
  // A fixed address, opened in a new tab: the page sends nothing itself, and the user pastes what they choose.
  const link = el("a", { href: REPORT_PROBLEM_URL, target: "_blank", rel: "noopener noreferrer", class: "report-link" }, "Report a problem");
  return el("div", { class: "report" }, copy, link, details);
}
