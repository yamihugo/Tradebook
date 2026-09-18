/**
 * The plugin's own dropdown.
 *
 * A native `<select>` arrives with Obsidian's box styling, which fights every
 * other control we have (ghost inputs, flat segments). This one is flat on
 * purpose: the label and a chevron, a hairline when you hover, and the list
 * floats over the page. Items can carry a note and can be shown-but-disabled,
 * so a picker never has to hide the accounts it cannot accept.
 */

import { attachTip } from "./tip";

export interface DropdownItem {
  id: string;
  label: string;
  /** Small line under the label — usually the reason an item is not selectable. */
  note?: string;
  /** Rendered, but not clickable. Always give it a `note` explaining why. */
  disabled?: boolean;
}

export interface DropdownOpts {
  /** Shown on the button before anything is picked. */
  placeholder?: string;
  title?: string;
  /** Which edge the floating list lines up with. */
  align?: "left" | "right";
}

/** Close every open list — one dropdown at a time. */
function closeAll(except?: HTMLElement): void {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLElement>(".tj-mg-dd.open").forEach((n) => {
    if (n !== except) n.removeClass("open");
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("click", () => closeAll(), true);
}

export function mountDropdown(
  host: HTMLElement,
  items: DropdownItem[],
  value: string,
  onChange: (id: string) => void,
  opts: DropdownOpts = {}
): HTMLElement {
  const wrap = host.createDiv({ cls: "tj-mg-dd" + (opts.align === "right" ? " is-right" : "") });
  const btn = wrap.createEl("button", { cls: "tj-mg-dd-btn", attr: { type: "button" } });
  const current = items.find((i) => i.id === value);
  const label = btn.createSpan({ cls: "tj-mg-dd-val" });
  label.setText(current?.label ?? opts.placeholder ?? "—");
  if (!current) label.addClass("is-placeholder");
  btn.createSpan({ cls: "tj-mg-dd-chev", text: "▾" });
  if (opts.title) attachTip(btn, { title: opts.title });

  const list = wrap.createDiv({ cls: "tj-mg-dd-list" });
  if (!items.length) {
    list.createDiv({ cls: "tj-mg-dd-empty", text: "Nothing to pick yet" });
  }
  for (const it of items) {
    const item = list.createDiv({
      cls: "tj-mg-dd-item" + (it.id === value ? " on" : "") + (it.disabled ? " is-off" : ""),
    });
    const txt = item.createDiv({ cls: "tj-mg-dd-txt" });
    txt.createDiv({ cls: "tj-mg-dd-lbl", text: it.label });
    if (it.note) txt.createDiv({ cls: "tj-mg-dd-note", text: it.note });
    if (it.disabled) continue;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      wrap.removeClass("open");
      onChange(it.id);
    });
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = !wrap.hasClass("open");
    closeAll(wrap);
    wrap.toggleClass("open", willOpen);
  });

  return wrap;
}
