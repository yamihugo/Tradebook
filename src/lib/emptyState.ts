/**
 * The journal's one "nothing here yet" block.
 *
 * Home, Trade Log, Accounts and Strategies all read the same way: the brand
 * mark, one honest sentence, and the actions that would fill the page. Keeping
 * it in a single place means no empty page can quietly drift away from the rest.
 */

import { setIcon } from "obsidian";
import { BRAND_ICON_ID } from "./brand";

export interface EmptyStateOptions {
  title: string;
  sub: string;
  /** A quieter third line — e.g. which filter or account produced the blank page. */
  note?: string;
  primaryText?: string;
  primaryIcon?: string;
  onPrimary?: () => void;
  secondaryText?: string;
  secondaryIcon?: string;
  onSecondary?: () => void;
  /** Extra class on the box (e.g. to reuse a page's own animation state). */
  extraCls?: string;
}

/** Render the block into `host`. Actions are omitted when no label is given. */
export function renderEmptyState(host: HTMLElement, opts: EmptyStateOptions): void {
  const box = host.createDiv({ cls: "tj-emptystate" + (opts.extraCls ? ` ${opts.extraCls}` : "") });
  setIcon(box.createDiv({ cls: "tj-emptystate-icon" }), BRAND_ICON_ID);
  box.createDiv({ cls: "tj-emptystate-title", text: opts.title });
  box.createDiv({ cls: "tj-emptystate-sub", text: opts.sub });
  if (opts.note) box.createDiv({ cls: "tj-emptystate-note", text: opts.note });

  if (!opts.primaryText && !opts.secondaryText) return;
  const actions = box.createDiv({ cls: "tj-emptystate-actions" });

  if (opts.primaryText) {
    const btn = actions.createEl("button", { cls: "mod-cta tj-empty-primary" });
    setIcon(btn.createSpan({ cls: "tj-btn-icon" }), opts.primaryIcon ?? "download");
    btn.createSpan({ text: opts.primaryText });
    if (opts.onPrimary) btn.addEventListener("click", () => opts.onPrimary?.());
  }

  if (opts.secondaryText) {
    const btn = actions.createEl("button", { cls: "tj-empty-secondary" });
    setIcon(btn.createSpan({ cls: "tj-btn-icon" }), opts.secondaryIcon ?? "plus");
    btn.createSpan({ text: opts.secondaryText });
    if (opts.onSecondary) btn.addEventListener("click", () => opts.onSecondary?.());
  }
}
