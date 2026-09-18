import { Modal, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { AccountType, PropAccount } from "../types";
import { closeCopyPeriods, openCopyPeriod, todayIso } from "../lib/copy";
import { mountDropdown } from "../lib/dropdown";
import { attachTip } from "../lib/tip";
import { BAR_CATALOG, MINI_CATALOG, SlotDef, barsFor as cardBars, miniFor as cardMini } from "../lib/cardSlots";
import { fmtMoneyAbs } from "../tz";
import { DEFAULT_COLORS, DEFAULT_LABELS, TYPE_COLOR_CHOICES, typeKey, typeLabel, typeOrder } from "../lib/accountTypes";

/** A small palette so two groups never look alike. */
const GROUP_COLORS = ["#34d17a", "#4aa8ff", "#a882ff", "#d9a441", "#ff8d6b", "#7de2d1", "#ff5d48", "#8a8a8a"];

const TYPE_TOGGLES: Array<[AccountType, string]> = [
  ["funded", "Funded"],
  ["eval", "Evaluation"],
  ["live", "Live"],
  ["personal", "Personal"],
  ["demo", "Demo"],
  ["unknown", "Other"],
];

const ALL_TYPES = TYPE_TOGGLES.map(([id]) => id) as string[];

const TYPE_DEFAULT_LABEL: Record<string, string> = Object.fromEntries(TYPE_TOGGLES);

/** Is the pointer in the lower half of this row? Decides insert-above vs below. */
function isBelowMiddle(el: HTMLElement, ev: DragEvent): boolean {
  const box = el.getBoundingClientRect();
  return ev.clientY > box.top + box.height / 2;
}

/** Drop hints are per-row state: clear them all when a drag ends. */
function clearDropMarks(list: HTMLElement): void {
  for (const el of Array.from(list.querySelectorAll(".tj-mg-typerow"))) {
    el.removeClass("is-drop");
    el.removeClass("is-drop-below");
  }
}

/** What Manage needs from the accounts page: one truthful card to preview with. */
export interface CardPreviewSource {
  previewFor(
    type: AccountType,
    override: { bars?: string[]; mini?: string[] },
  ): { el: HTMLElement; account: PropAccount | null };
}

export function openAccountsManage(plugin: TradebookPlugin, view?: CardPreviewSource): void {
  new AccountsManageModal(plugin, view).open();
}

/**
 * The "Manage" surface for the Accounts page: everything that is about the page
 * as a whole rather than one account. Each control writes the setting
 * immediately, so there is no save button to forget.
 */
class AccountsManageModal extends Modal {
  private plugin: TradebookPlugin;
  private view?: CardPreviewSource;
  private tab: "groups" | "display" | "types" | "cards" = "groups";
  /** Cards tab: which account type is being edited. */
  private cardType: AccountType = "eval";
  /** The "new group" composer lives in the class so a re-render keeps what you typed. */
  private newOpen = false;
  private newLeaderId = "";
  private newMemberIds: string[] = [];
  private newName = "";

  constructor(plugin: TradebookPlugin, view?: CardPreviewSource) {
    super(plugin.app);
    this.plugin = plugin;
    this.view = view;
  }

  onOpen(): void {
    // No `tj-modal` here: that class is the old overlay box (its own background,
    // border, radius, padding and shadow). Inside a real Modal it painted a second
    // surface inside the first — one modal, two frames. Obsidian's own `.modal` is
    // the surface, exactly like the account-settings modal does it.
    this.contentEl.addClass("tj-manage");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // ---------------------------------------------------------------- shell ----

  private render(): void {
    const el = this.contentEl;
    el.empty();

    const head = el.createDiv({ cls: "tj-manage-head" });
    const titleRow = head.createDiv({ cls: "tj-manage-title" });
    const titleIcon = titleRow.createSpan({ cls: "tj-manage-titleicon" });
    setIcon(titleIcon, "sliders-horizontal");
    titleRow.createEl("h2", { text: "Management" });
    head.createEl("p", {
      cls: "tj-manage-sub",
      text: "The control room for your accounts: how the list is grouped, how it reads, and how copies flow between accounts. Nothing here touches a trade.",
    });

    const tabs = el.createDiv({ cls: "tj-wz-seg tj-manage-tabs" });
    const tabDefs: Array<["groups" | "display" | "types" | "cards", string]> = [
      ["groups", "Copy groups"],
      ["display", "Display"],
      ["types", "Types"],
      ["cards", "Cards"],
    ];
    for (const [id, label] of tabDefs) {
      const b = tabs.createEl("button", {
        cls: "tj-wz-seg-opt" + (this.tab === id ? " on" : ""),
        text: label,
        attr: { type: "button" },
      });
      b.addEventListener("click", () => {
        if (this.tab === id) return;
        this.tab = id;
        this.render();
      });
    }

    const body = el.createDiv({ cls: "tj-manage-body" });
    if (this.tab === "groups") this.renderGroups(body);
    else if (this.tab === "types") this.renderTypes(body);
    else if (this.tab === "cards") this.renderCards(body);
    else this.renderDisplay(body);

    const foot = el.createDiv({ cls: "tj-manage-foot" });
    foot
      .createEl("button", { text: "Done", cls: "mod-cta", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
  }

  /** Label (and its hint) on the left, control on the right. */
  private row(host: HTMLElement, label: string, hint?: string): HTMLElement {
    const row = host.createDiv({ cls: "tj-mg-row" });
    const l = row.createDiv({ cls: "tj-mg-rowlbl" });
    l.createDiv({ cls: "tj-mg-rowlabel", text: label });
    if (hint) l.createDiv({ cls: "tj-mg-rowhint", text: hint });
    return row.createDiv({ cls: "tj-mg-rowval" });
  }

  private section(host: HTMLElement, title: string): HTMLElement {
    const wrap = host.createDiv({ cls: "tj-manage-sect" });
    wrap.createDiv({ cls: "tj-manage-sectitle", text: title });
    return wrap;
  }

  private async apply(): Promise<void> {
    await this.plugin.saveSettings();
    this.plugin.reloadAllViews();
  }

  // --------------------------------------------------------------- groups ----

  private renderGroups(body: HTMLElement): void {
    const accounts = this.plugin.settings.propAccounts ?? [];

    // A group is whoever is copied from: leaders that were declared, plus any
    // account someone points at. Members are the copiers.
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const leaders: PropAccount[] = [];
    for (const a of accounts) {
      if (a.copyRole === "base" || a.copyBaseId) {
        const owner = a.copyRole === "base" ? a : byId.get(a.copyBaseId as string);
        if (owner && !leaders.some((l) => l.id === owner.id)) leaders.push(owner);
      }
    }
    const groups = leaders
      .map((leader) => ({
        leader,
        members: accounts.filter((a) => a.copyRole === "copier" && a.copyBaseId === leader.id),
      }))
      .sort((a, b) => a.leader.name.localeCompare(b.leader.name));

    const free = accounts.filter((a) => a.copyRole !== "copier" && !groups.some((g) => g.leader.id === a.id));

    if (!groups.length) {
      const empty = body.createDiv({ cls: "tj-manage-empty" });
      empty.createDiv({
        text: "No trading groups yet. Create one below — pick the account other accounts will copy, and who joins it.",
      });
    }

    const note = body.createDiv({ cls: "tj-manage-note" });
    note.createSpan({ cls: "tj-manage-note-ico", text: "ⓘ" });
    note.createSpan({
      text: "Linking never rewrites trades already recorded. Taking an account out of a group keeps everything it already copied.",
    });

    for (const g of groups) this.renderGroup(body, g.leader, g.members, free);

    this.renderNewGroup(body, free);
  }

  /**
   * Start a group from scratch: choose the account others will copy and tick who
   * joins it. Same rules as linking anywhere else — the stretch opens today, so
   * nothing that happened before is rewritten.
   */
  private renderNewGroup(body: HTMLElement, free: PropAccount[]): void {
    const wrap = body.createDiv({ cls: "tj-mg-new" });

    if (!this.newOpen) {
      const btn = wrap.createEl("button", {
        cls: "tj-mg-act",
        text: "+ New trading group",
        attr: { type: "button" },
      });
      if (!free.length) {
        btn.disabled = true;
        attachTip(btn, { title: "Every account is already in a group.", sub: "Take one out first, or link it to another leader." });
      } else attachTip(btn, { title: "New trading group", sub: "Pick a leader and who copies it." });
      btn.addEventListener("click", () => {
        this.newOpen = true;
        this.render();
      });
      return;
    }

    if (!free.some((f) => f.id === this.newLeaderId)) this.newLeaderId = free[0]?.id ?? "";

    const card = wrap.createDiv({ cls: "tj-mg-card" });
    card.createDiv({ cls: "tj-mg-newtitle", text: "New trading group" });

    const nameRow = card.createDiv({ cls: "tj-mg-row2" });
    nameRow.createSpan({ cls: "tj-mg-rowlabel", text: "Name" });
    const nameInput = nameRow.createEl("input", {
      cls: "tj-mg-name",
      attr: { type: "text", value: this.newName, placeholder: "Trading group" },
    });
    nameInput.addEventListener("input", () => (this.newName = nameInput.value));

    const leaderRow = card.createDiv({ cls: "tj-mg-row2" });
    leaderRow.createSpan({ cls: "tj-mg-rowlabel", text: "Leader" });
    mountDropdown(
      leaderRow,
      free.map((f) => ({ id: f.id, label: f.name, note: `${fmtMoneyAbs(this.sizeOf(f))} · free` })),
      this.newLeaderId,
      (id) => {
        this.newLeaderId = id;
        this.render();
      },
      { placeholder: "Pick the account others copy…", title: "The account every copier mirrors" }
    );

    const copyRow = card.createDiv({ cls: "tj-mg-row2" });
    copyRow.createSpan({ cls: "tj-mg-rowlabel", text: "Copiers" });
    const list = copyRow.createDiv({ cls: "tj-wz-leader-list" });
    const others = free.filter((f) => f.id !== this.newLeaderId);
    if (!others.length) {
      list.createDiv({ cls: "tj-mg-empty", text: "No other account free to copy it — you can add copiers later." });
    }
    for (const o of others) {
      const on = this.newMemberIds.includes(o.id);
      const el = list.createDiv({ cls: "tj-wz-leader" + (on ? " on" : "") });
      el.createSpan({ cls: "tj-wz-pick", text: on ? "✓" : "" });
      const inner = el.createDiv({ cls: "tj-wz-leader-body" });
      inner.createDiv({ cls: "tj-wz-leader-nm", text: o.name });
      inner.createDiv({ cls: "tj-wz-leader-sub", text: `${fmtMoneyAbs(this.sizeOf(o))} · starts copying today` });
      el.addEventListener("click", () => {
        this.newMemberIds = on ? this.newMemberIds.filter((x) => x !== o.id) : [...this.newMemberIds, o.id];
        this.render();
      });
    }

    const actions = card.createDiv({ cls: "tj-mg-add" });
    const create = actions.createEl("button", { cls: "tj-mg-act", text: "Create group", attr: { type: "button" } });
    create.addEventListener("click", async () => {
      const lead = free.find((f) => f.id === this.newLeaderId);
      if (!lead) return;
      const from = todayIso();
      const used = new Set(
        (this.plugin.settings.propAccounts ?? [])
          .filter((a) => a.copyRole === "base")
          .map((a) => a.copyGroupColor)
      );
      lead.copyRole = "base";
      lead.copyBaseId = undefined;
      lead.copyGroupName = this.newName.trim() || undefined;
      lead.copyGroupColor = lead.copyGroupColor ?? GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[0];
      for (const id of this.newMemberIds) {
        const m = free.find((x) => x.id === id);
        if (!m || m.id === lead.id) continue;
        m.copyRole = "copier";
        m.copyBaseId = lead.id;
        m.copyMultiplier = 1;
        openCopyPeriod(m, lead.id, 1, from);
      }
      closeCopyPeriods(lead);
      this.newOpen = false;
      this.newLeaderId = "";
      this.newMemberIds = [];
      this.newName = "";
      await this.apply();
      this.render();
    });
    actions
      .createEl("button", { cls: "tj-mg-act is-quiet", text: "Cancel", attr: { type: "button" } })
      .addEventListener("click", () => {
        this.newOpen = false;
        this.newMemberIds = [];
        this.newName = "";
        this.render();
      });
  }

  private renderGroup(
    body: HTMLElement,
    leader: PropAccount,
    members: PropAccount[],
    free: PropAccount[],
  ): void {
    const card = body.createDiv({ cls: "tj-mg-card" });

    // --- header: colour, name, leader, count
    const head = card.createDiv({ cls: "tj-mg-head" });
    const dot = head.createDiv({ cls: "tj-mg-dot" });
    dot.style.background = leader.copyGroupColor ?? GROUP_COLORS[0];
    attachTip(dot, { title: "Group colour", sub: "Click to walk the palette." });
    dot.addEventListener("click", async () => {
      const i = GROUP_COLORS.indexOf(leader.copyGroupColor ?? GROUP_COLORS[0]);
      leader.copyGroupColor = GROUP_COLORS[(i + 1) % GROUP_COLORS.length];
      await this.apply();
      this.render();
    });

    const nameInput = head.createEl("input", {
      cls: "tj-mg-name",
      attr: { type: "text", value: leader.copyGroupName ?? "", placeholder: `Trading group — ${leader.name}` },
    });
    nameInput.addEventListener("change", async () => {
      leader.copyGroupName = nameInput.value.trim() || undefined;
      await this.apply();
      this.render();
    });

    head.createDiv({ cls: "tj-mg-count", text: `${members.length} copier${members.length === 1 ? "" : "s"}` });

    // --- the leader itself
    const lrow = card.createDiv({ cls: "tj-mg-lrow" });
    lrow.createSpan({ cls: "tj-mg-crown", text: "👑" });
    lrow.createSpan({ cls: "tj-mg-lname", text: leader.name });
    lrow.createSpan({ cls: "tj-mg-lsize", text: fmtMoneyAbs(this.sizeOf(leader)) });

    card.createDiv({
      cls: "tj-mg-hint",
      text: "Remove takes an account out of the group: it keeps every trade it copied so far and simply stops taking new ones. From there it can join another group or become a leader.",
    });

    // --- members
    for (const m of members) this.renderMember(card, leader, m);

    // --- add a copier
    const add = card.createDiv({ cls: "tj-mg-add" });
    if (free.length) {
      let picked = "";
      mountDropdown(
        add,
        free.map((f) => ({ id: f.id, label: f.name, note: `${fmtMoneyAbs(this.sizeOf(f))} · not in a group` })),
        picked,
        (id) => {
          picked = id;
        },
        { placeholder: "Add an account…", title: "An account that is not in a group yet" }
      );
      add
        .createEl("button", { text: "Add to group", cls: "tj-mg-act", attr: { type: "button" } })
        .addEventListener("click", async () => {
          const target = free.find((f) => f.id === picked);
          if (!target) return;
          target.copyRole = "copier";
          target.copyBaseId = leader.id;
          target.copyMultiplier = 1;
          openCopyPeriod(target, leader.id, 1, todayIso());
          await this.apply();
          this.render();
        });
    } else {
      add.createSpan({ cls: "tj-mg-empty", text: "Every account is already in a group." });
    }

    // --- change the leader of the whole group
    if (members.length) {
      const swap = card.createDiv({ cls: "tj-mg-swap" });
      swap.createSpan({ cls: "tj-mg-swaplbl", text: "Change leader" });
      const all = this.plugin.settings.propAccounts ?? [];
      const items = all
        .filter((a) => a.id !== leader.id)
        .map((a) => {
          const taken = a.copyRole === "copier";
          const from = taken ? all.find((x) => x.id === a.copyBaseId) : undefined;
          return {
            id: a.id,
            label: a.name,
            note: taken ? `already copies ${from?.name ?? "another account"}` : `${fmtMoneyAbs(this.sizeOf(a))} · free`,
            disabled: taken,
          };
        })
        // Who can lead comes first; the ones already spoken for stay visible but
        // greyed, so the choice is never made blind.
        .sort((a, b) => Number(a.disabled) - Number(b.disabled));
      let nextId = "";
      mountDropdown(swap, items, nextId, (id) => {
        nextId = id;
      }, { placeholder: "Pick an account…", title: "Which account leads this group from today" });
      swap
        .createEl("button", { text: "Move group", cls: "tj-mg-act", attr: { type: "button" } })
        .addEventListener("click", async () => {
          const next = items.find((i) => i.id === nextId && !i.disabled);
          if (!next) return;
          const nextAcc = all.find((a) => a.id === next.id);
          if (!nextAcc) return;
          const from = todayIso();
          for (const m of members) {
            m.copyBaseId = nextAcc.id;
            openCopyPeriod(m, nextAcc.id, m.copyMultiplier ?? 1, from);
          }
          closeCopyPeriods(leader);
          leader.copyRole = undefined;
          leader.copyBaseId = undefined;
          nextAcc.copyRole = "base";
          nextAcc.copyGroupName = leader.copyGroupName ?? nextAcc.copyGroupName;
          nextAcc.copyGroupColor = leader.copyGroupColor ?? nextAcc.copyGroupColor;
          await this.apply();
          this.render();
        });
    }
  }

  private renderMember(card: HTMLElement, leader: PropAccount, m: PropAccount): void {
    const row = card.createDiv({ cls: "tj-mg-mrow" });

    row.createSpan({ cls: "tj-mg-mname", text: m.name });

    // ratio
    row.createSpan({ cls: "tj-mg-x", text: "×" });
    const ratio = row.createEl("input", {
      cls: "tj-mg-ratio",
      attr: { type: "number", min: "0.1", step: "0.5", value: String(m.copyMultiplier ?? 1) },
    });
    attachTip(ratio, { title: "Ratio", sub: "Contracts copied per contract of the leader." });
    ratio.addEventListener("change", async () => {
      const v = Math.max(0.1, parseFloat(ratio.value) || 1);
      m.copyMultiplier = v;
      openCopyPeriod(m, leader.id, v, todayIso());
      await this.apply();
      this.render();
    });

    // copy type
    mountDropdown(
      row,
      [
        { id: "std", label: "Same symbol", note: "NQ copies NQ" },
        { id: "cross", label: "Mini ↔ micro", note: "1 mini = 10 micros" },
      ],
      m.copyCrossOrder ? "cross" : "std",
      async (id) => {
        m.copyCrossOrder = id === "cross";
        await this.apply();
      },
      { title: "How the leader's symbol is mirrored", align: "right" }
    );

    // Out of the group — one action, no separate pause. Leaving closes the
    // stretch, so the account keeps every trade it already copied and simply
    // stops taking new ones; it can then join another group or lead its own.
    const off = row.createEl("button", {
      cls: "tj-mg-act is-quiet",
      text: "Remove",
      attr: { type: "button" },
    });
    off.setAttr(
      "title",
      "Take it out of the group. It keeps every trade it copied and the stretches it ran — link it to another group, or make it a leader, whenever you want."
    );
    off.addEventListener("click", async () => {
      closeCopyPeriods(m);
      m.copyRole = undefined;
      m.copyBaseId = undefined;
      await this.apply();
      this.render();
    });
  }

  private sizeOf(acc: PropAccount): number {
    return acc.size;
  }

  // -------------------------------------------------------------- display ----

  /**
   * Types tab: what each account type is called, what colour it wears and the
   * order the sections come in. The set of types is fixed — the plugin
   * classifies every trade into one of them — so this is naming, not creating.
   */
  // ----------------------------------------------------------------- cards --

  /**
   * Which two bars and which four numbers each kind of account shows. The
   * preview beside the pickers is the real card component, drawn from your own
   * accounts, so what you see here is what the list will draw — not a mock-up
   * that drifts away from it.
   */
  private renderCards(body: HTMLElement): void {
    const s = this.plugin.settings;
    // Demo cards are a fixed statement (practice, outside the totals), so they
    // are not configurable here. Typed as the full union so `includes` accepts
    // whatever type is currently selected.
    const types: AccountType[] = typeOrder().filter((t) => t !== "demo");
    if (!types.includes(this.cardType)) this.cardType = types[0] ?? "eval";
    const t = this.cardType;

    this.section(body, "Cards");
    body.createDiv({
      cls: "tj-manage-note",
      text: "Each kind of account shows its own two bars and four numbers. Demo cards keep their fixed summary — they sit outside the portfolio totals.",
    });

    const seg = body.createDiv({ cls: "tj-wz-seg tj-mg-cardtypes" });
    for (const id of types) {
      const b = seg.createEl("button", {
        cls: "tj-wz-seg-opt" + (id === t ? " on" : ""),
        text: typeLabel(id),
        attr: { type: "button" },
      });
      b.addEventListener("click", () => {
        if (this.cardType === id) return;
        this.cardType = id;
        this.render();
      });
    }

    const bars = cardBars(t, s.accountCardBars);
    const mini = cardMini(t, s.accountCardMini);

    const wrap = body.createDiv({ cls: "tj-mg-cardwrap" });
    const pick = wrap.createDiv({ cls: "tj-mg-cardpick" });
    const prev = wrap.createDiv({ cls: "tj-mg-cardprev" });

    // Whatever is chosen is what the card draws — in the order chosen, with no
    // stand-ins. A brand-new account has to look ready for its first trade, not
    // like a card that has been patched up.
    const res = this.view?.previewFor(t, { bars, mini });

    const group = (title: string, current: string[], catalog: SlotDef[], commit: (next: string[]) => void) => {
      const g = pick.createDiv({ cls: "tj-mg-cardgroup" });
      g.createDiv({ cls: "tj-mg-swaplbl", text: title });
      current.forEach((cur, i) => {
        const line = g.createDiv({ cls: "tj-mg-cardline" });
        mountDropdown(
          line,
          catalog.map((c) => ({
            id: c.id,
            label: c.label,
            note: c.hint,
            // The same slot twice would print the same number twice: keep it
            // visible but unavailable, so the option list never looks short.
            disabled: current.includes(c.id) && c.id !== cur,
          })),
          cur,
          (id) => {
            const next = [...current];
            next[i] = id;
            commit(next);
          },
          { title: "What this slot shows" },
        );
      });
    };

    group("Bars", bars, BAR_CATALOG, (next) => {
      s.accountCardBars = { ...(s.accountCardBars ?? {}), [t]: next };
      void this.apply().then(() => this.render());
    });
    group("Numbers", mini, MINI_CATALOG, (next) => {
      s.accountCardMini = { ...(s.accountCardMini ?? {}), [t]: next };
      void this.apply().then(() => this.render());
    });

    const reset = pick.createEl("button", {
      cls: "tj-mg-act is-quiet",
      text: `Reset ${typeLabel(t).toLowerCase()} to default`,
      attr: { type: "button" },
    });
    reset.addEventListener("click", () => {
      const barsMap = { ...(s.accountCardBars ?? {}) };
      const miniMap = { ...(s.accountCardMini ?? {}) };
      delete barsMap[t];
      delete miniMap[t];
      s.accountCardBars = barsMap;
      s.accountCardMini = miniMap;
      void this.apply().then(() => this.render());
    });

    prev.createDiv({ cls: "tj-mg-cardprev-lbl", text: "Preview" });
    if (res) {
      prev.appendChild(res.el);
      if (res.account) {
        prev.createDiv({
          cls: "tj-mg-cardprev-sub",
          text: `The ${typeLabel(t).toLowerCase()} account with the most history — ${res.account.name}.`,
        });
      }
    } else {
      prev.createDiv({ cls: "tj-mg-empty", text: "Open this from the Accounts page to see a live preview." });
    }
  }

  private renderTypes(body: HTMLElement): void {
    const s = this.plugin.settings;
    this.section(body, "Types");
    body.createDiv({
      cls: "tj-manage-note",
      text: "Rename them to whatever you call them, recolour them and move them up or down. The names follow the page: sections, tags and the composition bar.",
    });

    const list = body.createDiv({ cls: "tj-mg-typelist" });
    const order = typeOrder();
    let dragFrom = -1;

    // Insert where you point, never a swap: dragging the last row to the top
    // pushes the others down instead of trading places with the first one.
    const move = (from: number, to: number) => {
      if (from < 0 || to < 0) return;
      const next = [...typeOrder()];
      const [item] = next.splice(from, 1);
      const at = from < to ? to - 1 : to;
      if (at === from || at < 0) return;
      next.splice(at, 0, item);
      s.accountTypeOrder = next;
      void this.apply().then(() => this.render());
    };

    /** Any open palette goes away as soon as you click elsewhere. */
    const closeSwatches = () => {
      for (const el of Array.from(document.querySelectorAll(".tj-mg-swatches"))) el.remove();
    };

    order.forEach((t, i) => {
      const row = list.createDiv({ cls: "tj-mg-row tj-mg-typerow" });

      // Only the grip is draggable, so the name field stays editable as before.
      const grip = row.createDiv({ cls: "tj-mg-grip", attr: { "aria-label": "Drag to reorder, or use the arrows" } });
      attachTip(grip, { title: "Drag to reorder", sub: "Or use the arrows — dragging alone is not enough for everyone." });
      grip.setText("⠿");
      grip.setAttr("draggable", "true");
      grip.addEventListener("dragstart", (ev) => {
        dragFrom = i;
        row.addClass("is-dragging");
        (ev as DragEvent).dataTransfer?.setData("text/plain", String(i));
      });
      grip.addEventListener("dragend", () => {
        dragFrom = -1;
        row.removeClass("is-dragging");
        clearDropMarks(list);
      });
      // Which half of the row you are over decides where it lands: above it or
      // below it. That is the difference between a list that feels right and one
      // that keeps jumping to the wrong place.
      row.addEventListener("dragover", (ev) => {
        if (dragFrom < 0) return;
        ev.preventDefault();
        const below = isBelowMiddle(row, ev as DragEvent);
        row.toggleClass("is-drop", !below);
        row.toggleClass("is-drop-below", below);
      });
      row.addEventListener("dragleave", () => {
        row.removeClass("is-drop");
        row.removeClass("is-drop-below");
      });
      row.addEventListener("drop", (ev) => {
        ev.preventDefault();
        const below = isBelowMiddle(row, ev as DragEvent);
        row.removeClass("is-drop");
        row.removeClass("is-drop-below");
        move(dragFrom, i + (below ? 1 : 0));
      });

      // Dragging must never be the only way to reorder (WCAG 2.2 SC 2.5.7), so
      // every row also carries explicit steps. They call the same move() as the
      // drop handler, so the two can never drift apart. `move` inserts *before*
      // an index, hence +2 for "one row down".
      const moves = row.createDiv({ cls: "tj-mg-moves" });
      const step = (dir: -1 | 1) => {
        const b = moves.createEl("button", {
          cls: "tj-mg-move",
          text: dir < 0 ? "↑" : "↓",
          attr: { type: "button", "aria-label": dir < 0 ? "Move up" : "Move down" },
        }) as HTMLButtonElement;
        attachTip(b, { title: dir < 0 ? "Move up" : "Move down" });
        b.disabled = dir < 0 ? i === 0 : i === order.length - 1;
        b.addEventListener("click", () => move(i, dir < 0 ? i - 1 : i + 2));
      };
      step(-1);
      step(1);

      const val = row.createDiv({ cls: "tj-mg-rowval" });
      const input = val.createEl("input", {
        cls: "tj-mg-name",
        attr: { type: "text", value: s.accountTypeLabels?.[t] ?? DEFAULT_LABELS[t], placeholder: DEFAULT_LABELS[t] },
      });
      input.addEventListener("change", () => {
        const v = input.value.trim();
        const labels = { ...(s.accountTypeLabels ?? {}) };
        if (v && v !== DEFAULT_LABELS[t]) labels[t] = v;
        else delete labels[t];
        s.accountTypeLabels = labels;
        void this.apply();
      });

      const dot = val.createDiv({ cls: "tj-mg-dot", attr: { "aria-label": "Pick a colour" } });
      attachTip(dot, { title: "Pick a colour", sub: "Sixteen that read well on dark and light." });
      const current = s.accountTypeColors?.[t] ?? DEFAULT_COLORS[t];
      dot.style.background = current;
      dot.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const already = val.querySelector(".tj-mg-swatches");
        closeSwatches();
        if (already) return; // clicking the same dot closes it again
        const pop = val.createDiv({ cls: "tj-mg-swatches" });
        for (const c of TYPE_COLOR_CHOICES) {
          const sw = pop.createDiv({ cls: "tj-mg-swatch" + (c.toLowerCase() === current.toLowerCase() ? " on" : "") });
          sw.style.background = c;
          attachTip(sw, { title: c });
          sw.addEventListener("click", (e) => {
            e.stopPropagation();
            s.accountTypeColors = { ...(s.accountTypeColors ?? {}), [t]: c };
            dot.style.background = c;
            for (const other of Array.from(pop.querySelectorAll(".tj-mg-swatch"))) other.removeClass("on");
            sw.addClass("on");
            void this.apply();
          });
        }
        // Added on the next tick: a listener registered while this click is still
        // bubbling would catch the very same event and close the palette at once.
        setTimeout(() => document.addEventListener("click", closeSwatches, { once: true }), 0);
      });
    });

    // A way back: labels, colours and order are all cosmetic, so clearing them
    // restores the defaults without touching a single account.
    const reset = body.createEl("button", {
      cls: "tj-mg-act is-quiet",
      text: "Reset to defaults",
      attr: { type: "button" },
    });
    attachTip(reset, { title: "Reset to defaults", sub: "Back to the original names, colours and order." });
    reset.addEventListener("click", async () => {
      delete s.accountTypeLabels;
      delete s.accountTypeColors;
      delete s.accountTypeOrder;
      await this.apply();
      this.render();
    });
  }

  private renderDisplay(body: HTMLElement): void {
    const s = this.plugin.settings;

    const layout = this.section(body, "Layout");

    const group = this.row(layout, "Group accounts by", "How the list is split into sections");
    mountDropdown(
      group,
      [
        { id: "type", label: "Account type" },
        { id: "firm", label: "Firm" },
        { id: "firm-type", label: "Firm → type" },
        { id: "copy", label: "Trading group" },
      ],
      s.accountsGroupBy ?? "type",
      async (id) => {
        s.accountsGroupBy = id as typeof s.accountsGroupBy;
        await this.apply();
        this.render();
      },
      { align: "right" }
    );

    const sort = this.row(layout, "Order the cards by", "Balance, net P&L and drawdown fall back to name when equal");
    mountDropdown(
      sort,
      [
        { id: "name", label: "Name" },
        { id: "balance", label: "Balance" },
        { id: "net", label: "Net P&L" },
        { id: "dd", label: "Drawdown used" },
      ],
      s.accountsSort ?? "name",
      async (id) => {
        s.accountsSort = id as typeof s.accountsSort;
        await this.apply();
      },
      { align: "right" }
    );

    const shown = this.section(body, "What appears");

    const logo = this.row(shown, "Firm logo on each card", "Just the badge — it never changes a number. Off shows the firm's initial");
    const logoInput = logo.createEl("input", { cls: "tj-mg-check", attr: { type: "checkbox" } });
    logoInput.checked = s.accountsShowLogo !== false;
    logoInput.addEventListener("change", async () => {
      s.accountsShowLogo = logoInput.checked;
      await this.apply();
    });

    const demos = this.row(shown, "Exclude demo accounts", "Demos stay visible but out of the totals");
    const demoInput = demos.createEl("input", { cls: "tj-mg-check", attr: { type: "checkbox" } });
    demoInput.checked = s.excludeDemosFromPortfolio !== false;
    demoInput.addEventListener("change", async () => {
      s.excludeDemosFromPortfolio = demoInput.checked;
      await this.apply();
    });

    const arch = this.row(shown, "Archived accounts", "Show the Archived box at the bottom — past evals you keep for the record");
    const archInput = arch.createEl("input", { cls: "tj-mg-check", attr: { type: "checkbox" } });
    archInput.checked = s.accountsShowArchived !== false;
    archInput.addEventListener("change", async () => {
      s.accountsShowArchived = archInput.checked;
      await this.apply();
    });

    const types = this.section(body, "Account types shown");

    const visible = new Set<string>(s.accountsVisibleTypes ?? ALL_TYPES);
    for (const [id, label] of TYPE_TOGGLES) {
      const r = this.row(types, label);
      const cb = r.createEl("input", { cls: "tj-mg-check", attr: { type: "checkbox" } });
      cb.checked = visible.has(id);
      cb.addEventListener("change", async () => {
        if (cb.checked) visible.add(id);
        else visible.delete(id);
        const list = ALL_TYPES.filter((t) => visible.has(t)) as AccountType[];
        s.accountsVisibleTypes = list.length ? list : (ALL_TYPES as AccountType[]);
        await this.apply();
      });
    }
  }
}
