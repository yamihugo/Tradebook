/**
 * The plugin's own dropdown.
 *
 * A native `<select>` arrives with Obsidian's box styling, which fights every
 * other control we have (ghost inputs, flat segments). This one is flat on
 * purpose: the label and a chevron, a hairline when you hover, and the list
 * floats over the page. Items can carry a note and can be shown-but-disabled,
 * so a picker never has to hide the accounts it cannot accept.
 *
 * While open the list is lifted to <body> and pinned to the viewport: inside a
 * scrolling panel (the Management modal, the import review) an absolutely
 * positioned list is clipped by the scroller's padding box, which cut the last
 * options off and grew a scrollbar. Fixed positioning escapes it.
 */

import { attachTip } from "./tip";

export interface DropdownItem {
  id: string;
  label: string;
  /** Small line under the label — usually the reason an item is not selectable. */
  note?: string;
  /** Rendered, but not clickable. Always give it a `note` explaining why. */
  disabled?: boolean;
  /**
   * A section title drawn above this item. Set it on the first item of each
   * group: the list is then read as answers to different questions, not as one
   * flat run where a leader and a stranger look alike.
   */
  heading?: string;
  /** A short chip at the end of the row, shown on the button too once picked. */
  tag?: string;
  /** Tints that chip. Unset means the quiet default. */
  tagTone?: "leader" | "copier";
}

export interface DropdownOpts {
  /** Shown on the button before anything is picked. */
  placeholder?: string;
  title?: string;
  /** Which edge the floating list lines up with. */
  align?: "left" | "right";
}

interface OpenMenu {
  wrap: HTMLElement;
  list: HTMLElement;
  close: () => void;
}

/** The list currently floating above the page, if any. */
let active: OpenMenu | null = null;
let watcher: MutationObserver | null = null;

function stopWatching(): void {
  watcher?.disconnect();
  watcher = null;
}

/** A panel redraws by rebuilding its tree; the orphaned list goes with it. */
function startWatching(doc: Document): void {
  if (watcher || typeof MutationObserver === "undefined" || !doc.body) return;
  watcher = new MutationObserver(() => {
    if (active && !active.wrap.isConnected) active.close();
  });
  watcher.observe(doc.body, { childList: true, subtree: true });
}

/** Close every open list — one dropdown at a time. */
function closeAll(except?: HTMLElement): void {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLElement>(".tj-mg-dd.open").forEach((n) => {
    if (n !== except) n.removeClass("open");
  });
  if (active && active.wrap !== except) active.close();
}

function onDocClick(e: Event): void {
  if (!active) return;
  const t = e.target as Node | null;
  if (t && (active.list.contains(t) || active.wrap.contains(t))) return;
  closeAll();
}

if (typeof document !== "undefined") {
  document.addEventListener("click", onDocClick, true);
}

/** The chip that carries a role, coloured only where a role is worth colour. */
function tagCls(it: DropdownItem): string {
  return "tj-mg-dd-tag" + (it.tagTone ? ` is-${it.tagTone}` : "");
}

export function mountDropdown(
  host: HTMLElement,
  items: DropdownItem[],
  value: string,
  onChange: (id: string) => void,
  opts: DropdownOpts = {}
): HTMLElement {
  const doc = host.ownerDocument;
  const win = doc.defaultView ?? window;

  const wrap = host.createDiv({ cls: "tj-mg-dd" + (opts.align === "right" ? " is-right" : "") });
  const btn = wrap.createEl("button", { cls: "tj-mg-dd-btn", attr: { type: "button" } });
  let chosen = value;
  const label = btn.createSpan({ cls: "tj-mg-dd-val" });
  const chev = btn.createSpan({ cls: "tj-mg-dd-chev", text: "▾" });
  let tagEl: HTMLElement | null = null;
  // The role travels with the name: once a leader is picked the button still
  // says so, and the reader never has to open the list to remember what it was.
  // Repainted on every pick so the button never lies about the current choice.
  const paint = (): void => {
    const cur = items.find((i) => i.id === chosen);
    label.setText(cur?.label ?? opts.placeholder ?? "—");
    label.toggleClass("is-placeholder", !cur);
    if (tagEl) {
      tagEl.remove();
      tagEl = null;
    }
    if (cur?.tag) tagEl = btn.insertBefore(btn.createSpan({ cls: tagCls(cur), text: cur.tag }), chev);
  };
  paint();
  if (opts.title) attachTip(btn, { title: opts.title });

  const list = wrap.createDiv({ cls: "tj-mg-dd-list" });
  if (!items.length) {
    list.createDiv({ cls: "tj-mg-dd-empty", text: "Nothing to pick yet" });
  }
  for (const it of items) {
    // A heading is not an option: it is the name of the group of options that
    // follows, so it carries no id and is never clickable.
    if (it.heading) list.createDiv({ cls: "tj-mg-dd-head", text: it.heading });
    const item = list.createDiv({
      cls: "tj-mg-dd-item" + (it.id === chosen ? " on" : "") + (it.disabled ? " is-off" : ""),
    });
    const txt = item.createDiv({ cls: "tj-mg-dd-txt" });
    txt.createDiv({ cls: "tj-mg-dd-lbl", text: it.label });
    if (it.note) txt.createDiv({ cls: "tj-mg-dd-note", text: it.note });
    if (it.tag) item.createSpan({ cls: tagCls(it), text: it.tag });
    if (it.disabled) continue;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      chosen = it.id;
      paint();
      list.querySelectorAll<HTMLElement>(".tj-mg-dd-item.on").forEach((n) => n.removeClass("on"));
      item.addClass("on");
      close();
      onChange(it.id);
    });
  }

  /** Keep the floating list on the button as the page moves under it. */
  const place = (): void => {
    if (!wrap.isConnected) {
      close();
      return;
    }
    const r = btn.getBoundingClientRect();
    const w = list.offsetWidth;
    const h = list.offsetHeight;
    let left = opts.align === "right" ? r.right - w : r.left;
    let top = r.bottom + 6;
    if (left + w > win.innerWidth - 8) left = win.innerWidth - 8 - w;
    if (left < 8) left = 8;
    if (top + h > win.innerHeight - 8 && r.top - 6 - h > 8) top = r.top - 6 - h;
    list.style.left = `${Math.round(left)}px`;
    list.style.top = `${Math.round(top)}px`;
  };

  const close = (): void => {
    if (!active || active.list !== list) return;
    win.removeEventListener("resize", place);
    win.removeEventListener("scroll", place, true);
    stopWatching();
    wrap.removeClass("open");
    list.removeClass("is-portal");
    list.style.left = "";
    list.style.top = "";
    wrap.appendChild(list);
    active = null;
  };

  const open = (): void => {
    closeAll(wrap);
    wrap.addClass("open");
    list.addClass("is-portal");
    doc.body.appendChild(list);
    win.addEventListener("resize", place);
    win.addEventListener("scroll", place, true);
    place();
    active = { wrap, list, close };
    startWatching(doc);
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (wrap.hasClass("open")) close();
    else open();
  });

  return wrap;
}
