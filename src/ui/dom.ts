// SPDX-License-Identifier: AGPL-3.0-or-later
/** Builds elements from text. Names, hosts and notes come from outside, so nothing here parses HTML. */

type Attributes = Record<string, string | boolean>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attributes = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === true) element.setAttribute(name, "");
    else if (value !== false) element.setAttribute(name, value);
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

export function need<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

export function button(label: string, onClick: () => void, className = ""): HTMLButtonElement {
  const element = el("button", { type: "button", class: className }, label);
  element.addEventListener("click", onClick);
  return element;
}
