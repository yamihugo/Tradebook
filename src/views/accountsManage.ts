import { Modal, Notice, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { AccountType, PropAccount } from "../types";
import { closeCopyPeriods, startCopying, todayIso, unlinkCopier } from "../lib/copy";
import { mountDropdown } from "../lib/dropdown";
import { freeNumeric } from "../lib/numeric";
import { formatDate, mountDateField } from "../lib/dates";
import { attachTip } from "../lib/tip";
import { fmtMoneyAbs } from "../tz";
import { DEFAULT_COLORS, DEFAULT_LABELS, TYPE_COLOR_CHOICES, typeKey, typeOrder } from "../lib/accountTypes";

/** A small palette so two groups never look alike. */
const GROUP_COLORS = ["#34d17a", "#4aa8ff", "#a882ff", "#d9a441", "#ff8d6b", "#7de2d1", "#ff5d48", "#8a8a8a"];

/**
 * The four ways a copier can begin. Real traders arrive with a group already
 * running, so "today" is the safe default but never the only answer.
 */
const COPY_START_ITEMS = [
  { id: "start", label: "From the account's start", note: "Mirror only from the day this copier account was created." },
  { id: "custom", label: "A date I choose", note: "Mirror from a date you pick — when the group started later." },
  { id: "all", label: "The leader's whole history", note: "Mirror everything the leader ever traded, even before this copier existed." },
];

/** The floor of recorded time: "copy everything the leader ever did". */
const COPY_ALL_START = "0000-01-01";

const TYPE_TOGGLES: Array<[AccountType, string]> = [
  ["funded", "Funded"],
  ["eval", "Evaluation"],
  ["live", "Live"],
  ["personal", "Personal"],
  ["demo", "Demo"],
  ["unknown", "Other"],
];

const ALL_TYPES = TYPE_TOGGLES.map(([id]) => id) as string[];

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

/**
 * Two surfaces, one modal. They are different jobs — who copies whom, and how
 * the page reads — so they no longer share a tab bar that hides one behind the
 * other. The header of the accounts page opens each with its own square.
 */
export function openCopyGroups(plugin: TradebookPlugin): void {
  new AccountsManageModal(plugin, "groups").open();
}

export function openAccountsDisplay(plugin: TradebookPlugin): void {
  new AccountsManageModal(plugin, "display").open();
}

/**
 * The "Manage" surface for the Accounts page: everything that is about the page
 * as a whole rather than one account. Each control writes the setting
 * immediately, so there is no save button to forget.
 */
class AccountsManageModal extends Modal {
  private plugin: TradebookPlugin;
  /** Which surface this instance is: the copy groups or the page's own look. */
  private mode: "groups" | "display";
  /** The "new group" composer lives in the class so a re-render keeps what you typed. */
  private newOpen = false;
  private newLeaderId = "";
  private newMemberIds: string[] = [];
  private newName = "";
  /** New group: when its copiers start mirroring. */
  private newCopyFrom = "start";
  private newCopyFromDate = "";
  /** Adding one account to an existing group: the same choice, kept apart. */
  private addPickedId = "";
  private addCopyFrom = "start";
  private addCopyFromDate = "";

  constructor(plugin: TradebookPlugin, mode: "groups" | "display") {
    super(plugin.app);
    this.plugin = plugin;
    this.mode = mode;
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

    const groups = this.mode === "groups";
    const head = el.createDiv({ cls: "tj-manage-head" });
    const titleRow = head.createDiv({ cls: "tj-manage-title" });
    const titleIcon = titleRow.createSpan({ cls: "tj-manage-titleicon" });
    setIcon(titleIcon, groups ? "users" : "sliders-horizontal");
    titleRow.createEl("h2", { text: groups ? "Copy groups" : "Settings" });
    head.createEl("p", {
      cls: "tj-manage-sub",
      text: groups
        ? "Who leads, who copies it, and how. Nothing here touches a trade."
        : "How this page is grouped and how it reads. Nothing here touches a trade.",
    });

    const body = el.createDiv({ cls: "tj-manage-body" });
    if (groups) this.renderGroups(body);
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

  /**
   * A section whose explanation lives behind an (i) rather than in a banner —
   * the header keeps its height and the sentence is still one hover away.
   */
  private sectionInfo(host: HTMLElement, title: string, tip: string): HTMLElement {
    const wrap = host.createDiv({ cls: "tj-manage-sect" });
    const head = wrap.createDiv({ cls: "tj-manage-secthead" });
    head.createDiv({ cls: "tj-manage-sectitle", text: title });
    const info = head.createSpan({
      cls: "tj-manage-infoico",
      attr: { tabindex: "0" },
    });
    // The (i) explains *this* section, so its accessible name says which one —
    // never a generic "More information". (Obsidian draws its own tooltip for
    // any aria-label, and that one would be the only thing the reader saw.)
    const glyph = info.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(glyph, "info");
    info.createSpan({ cls: "tj-sr-only", text: `About ${title}` });
    attachTip(info, { title, sub: tip });
    return wrap;
  }

  /**
   * The day a copier starts on, from the "Copy from" choice. "The leader's whole
   * history" floors at the beginning of recorded time, which is the one case
   * where a copier mirrors trades from before its own account was created.
   */
  private copyStartFor(acc: PropAccount, mode: string, custom: string): string {
    if (mode === "all") return COPY_ALL_START;
    if (mode === "start") return acc.createdAt || todayIso();
    if (mode === "custom") return custom || todayIso();
    return todayIso();
  }

  /** The same choice, said back in words — shown under each copier's name. */
  private copyStartNote(acc: PropAccount | undefined, mode: string, custom: string): string {
    const fmt = (iso: string) => formatDate(iso, this.plugin.settings.dateFormat);
    if (mode === "all") return "copies the leader's whole history";
    if (mode === "start") {
      return acc ? `copies from ${fmt(this.copyStartFor(acc, mode, custom))} — this account's start` : "since each account was created";
    }
    if (mode === "custom") return `copies from ${fmt(custom || todayIso())}`;
    return "starts copying today";
  }

  /**
   * The "Copy from" control: one dropdown plus the date field it reveals when
   * you pick your own date. Both write straight into the caller's own state.
   */
  private copyStartControl(
    host: HTMLElement,
    acc: PropAccount | undefined,
    mode: string,
    custom: string,
    onMode: (m: string) => void,
    onDate: (iso: string) => void
  ): void {
    const dd = mountDropdown(
      host,
      COPY_START_ITEMS,
      mode,
      (id) => {
        onMode(id);
        if (id === "custom" && !custom) onDate(todayIso());
        this.render();
      },
      { placeholder: "Copy from…", title: "When this account began copying" }
    );
    attachTip(dd, { title: "Copy from", sub: this.copyStartNote(acc, mode, custom) });
    if (mode === "custom") {
      mountDateField(host, {
        value: custom || todayIso(),
        format: this.plugin.settings.dateFormat,
        onChange: (iso) => onDate(iso),
      });
    }
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
      empty.createDiv({ cls: "tj-manage-emptytitle", text: "No trading groups yet" });
      empty.createDiv({
        text: "Pick the account other accounts will copy, then who joins it.",
      });
    } else {
      const note = body.createDiv({ cls: "tj-manage-note" });
      const noteIco = note.createSpan({ cls: "tj-manage-note-ico", attr: { "aria-hidden": "true" } });
      setIcon(noteIco, "info");
      note.createSpan({
        text: "Linking never rewrites trades already recorded. Taking an account out of a group keeps everything it already copied.",
      });
    }

    for (const g of groups) this.renderGroup(body, g.leader, g.members, free);

    this.renderNewGroup(body, free);
  }

  /**
   * Start a group from scratch, one step at a time: who leads, who copies it,
   * and from when. Same rules as linking anywhere else — the stretch opens
   * today, so nothing that happened before is rewritten.
   *
   * The order is deliberate. Choosing the leader is the decision that matters,
   * and the copiers are meaningless without it — so the list of accounts is the
   * leader picker, and the rest of the form stays shut until it is answered.
   */
  private stepHead(host: HTMLElement, n: number, title: string, hint?: string): HTMLElement {
    const head = host.createDiv({ cls: "tj-mg-step" });
    head.createSpan({ cls: "tj-mg-stepnum", text: String(n) });
    head.createSpan({ cls: "tj-mg-stepfill" });
    head.createSpan({ cls: "tj-mg-steptitle", text: title });
    if (hint) host.createDiv({ cls: "tj-mg-hint", text: hint });
    return head;
  }

  private renderNewGroup(body: HTMLElement, free: PropAccount[]): void {
    const wrap = body.createDiv({ cls: "tj-mg-new" });

    if (!this.newOpen) {
      const anyGroups = (this.plugin.settings.propAccounts || []).some((a) => a.copyRole === "base");
      const btn = wrap.createEl("button", {
        cls: "tj-mg-act",
        text: anyGroups ? "+ New trading group" : "+ Create Copy Group",
        attr: { type: "button" },
      });
      // Always open. A dead button explains nothing; the composer can show which
      // accounts are taken and free one in a click.
      attachTip(
        btn,
        free.length
          ? { title: "New trading group", sub: "Pick a leader and who copies it." }
          : { title: "New trading group", sub: "Every account is in a group — open this and you can take one out." }
      );
      btn.addEventListener("click", () => {
        this.newOpen = true;
        this.newLeaderId = "";
        this.newMemberIds = [];
        this.render();
      });
      return;
    }

    const leader = free.find((f) => f.id === this.newLeaderId);

    const card = wrap.createDiv({ cls: "tj-mg-card" });
    card.createDiv({ cls: "tj-mg-newtitle", text: "New trading group" });

    const nameRow = card.createDiv({ cls: "tj-mg-row2" });
    nameRow.createSpan({ cls: "tj-mg-rowlabel", text: "Name" });
    const nameInput = nameRow.createEl("input", {
      cls: "tj-mg-name",
      attr: { type: "text", value: this.newName, placeholder: "Trading group" },
    });
    nameInput.addEventListener("input", () => (this.newName = nameInput.value));

    // --- 1 · the leader: the one decision everything else hangs on
    const step1 = card.createDiv({ cls: "tj-mg-stepblock" });
    this.stepHead(step1, 1, "Leader", "The account the others will copy. Pick it first.");
    const grid = step1.createDiv({ cls: "tj-mg-leadgrid" });
    for (const f of free) {
      const on = f.id === this.newLeaderId;
      const el = grid.createDiv({ cls: "tj-mg-leadcard" + (on ? " on" : "") });
      el.createSpan({ cls: "tj-mg-leadcard-nm", text: f.name });
      el.createSpan({ cls: "tj-mg-leadcard-sub", text: `${fmtMoneyAbs(this.sizeOf(f))} · leader` });
      el.addEventListener("click", () => {
        this.newLeaderId = f.id;
        this.newMemberIds = this.newMemberIds.filter((id) => id !== f.id);
        this.render();
      });
    }
    // Nothing free to lead: say why, and make the way out reachable from here.
    if (!free.length) {
      step1.createDiv({
        cls: "tj-mg-empty",
        text: "Every account is in a group already. Take one out and it can lead this one.",
      });
      const taken = step1.createDiv({ cls: "tj-wz-leader-list" });
      for (const t of this.linkedAccounts()) {
        const row = taken.createDiv({ cls: "tj-mg-copier" });
        const body = row.createDiv({ cls: "tj-mg-copier-body" });
        body.createDiv({ cls: "tj-mg-copier-nm", text: t.name });
        body.createDiv({
          cls: "tj-mg-copier-sub",
          text: `${fmtMoneyAbs(this.sizeOf(t))} · ${t.copyRole === "base" ? "leads a group" : "copier"}`,
        });
        row
          .createEl("button", { cls: "tj-mg-act", text: "Take out", attr: { type: "button" } })
          .addEventListener("click", async (ev) => {
            ev.stopPropagation();
            this.detachAccount(t);
            await this.apply();
            new Notice(`${t.name} is out of its group.`);
            this.render();
          });
      }
    }

    // --- 2 · who copies it. Nothing to answer here until step 1 is answered.
    const step2 = card.createDiv({ cls: "tj-mg-stepblock" + (leader ? "" : " is-locked") });
    this.stepHead(step2, 2, "Copiers");
    if (!leader) {
      step2.createDiv({ cls: "tj-mg-empty", text: "Pick the leader first." });
    } else {
      const locked = step2.createDiv({ cls: "tj-mg-lockedlead" });
      locked.createSpan({ cls: "tj-mg-lockedlead-nm", text: leader.name });
      locked.createSpan({ cls: "tj-mg-lockedlead-sub", text: "leader" });

      const list = step2.createDiv({ cls: "tj-wz-leader-list" });
      const others = free.filter((f) => f.id !== leader.id);
      if (!others.length) {
        list.createDiv({ cls: "tj-mg-empty", text: "No other account free to copy it — you can add copiers later." });
      }
      for (const o of others) {
        const on = this.newMemberIds.includes(o.id);
        const el = list.createDiv({ cls: "tj-mg-copier" + (on ? " on" : "") });
        el.createSpan({ cls: "tj-mg-pick" + (on ? " on" : ""), text: on ? "✓" : "" });
        const inner = el.createDiv({ cls: "tj-mg-copier-body" });
        inner.createDiv({ cls: "tj-mg-copier-nm", text: o.name });
        inner.createDiv({ cls: "tj-mg-copier-sub", text: `${fmtMoneyAbs(this.sizeOf(o))} · copies ${leader.name}` });
        el.addEventListener("click", () => {
          this.newMemberIds = on ? this.newMemberIds.filter((x) => x !== o.id) : [...this.newMemberIds, o.id];
          this.render();
        });
      }
    }

    // --- 3 · when those copiers start mirroring
    const step3 = card.createDiv({ cls: "tj-mg-stepblock" + (leader ? "" : " is-locked") });
    this.stepHead(step3, 3, "Copy from", "When each copier should start mirroring the leader.");
    if (!leader) {
      step3.createDiv({ cls: "tj-mg-empty", text: "Pick the leader first." });
    } else {
      this.copyStartControl(
        step3,
        leader,
        this.newCopyFrom,
        this.newCopyFromDate,
        (m) => (this.newCopyFrom = m),
        (iso) => (this.newCopyFromDate = iso)
      );
      step3.createDiv({ cls: "tj-mg-hint", text: this.copyStartNote(leader, this.newCopyFrom, this.newCopyFromDate) });
    }

    const actions = card.createDiv({ cls: "tj-mg-add" });
    const create = actions.createEl("button", { cls: "tj-mg-act", text: "Create group", attr: { type: "button" } }) as HTMLButtonElement;
    create.disabled = !leader;
    create.addEventListener("click", async () => {
      const lead = free.find((f) => f.id === this.newLeaderId);
      if (!lead) return;
      const used = new Set(
        (this.plugin.settings.propAccounts ?? [])
          .filter((a) => a.copyRole === "base")
          .map((a) => a.copyGroupColor)
      );
      lead.copyRole = "base";
      lead.copyBaseId = undefined;
      lead.copyGroupName = this.newName.trim() || undefined;
      lead.copyGroupColor = lead.copyGroupColor ?? GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[0];
      let copiers = 0;
      for (const id of this.newMemberIds) {
        const m = free.find((x) => x.id === id);
        if (!m || m.id === lead.id) continue;
        m.copyRole = "copier";
        m.copyBaseId = lead.id;
        m.copyMultiplier = 1;
        startCopying(m, lead.id, 1, this.copyStartFor(m, this.newCopyFrom, this.newCopyFromDate));
        copiers++;
      }
      closeCopyPeriods(lead);
      this.newOpen = false;
      this.newLeaderId = "";
      this.newMemberIds = [];
      this.newName = "";
      this.newCopyFrom = "start";
      this.newCopyFromDate = "";
      await this.apply();
      new Notice(
        copiers
          ? `Group created — ${lead.name} leads ${copiers} copier${copiers === 1 ? "" : "s"}.`
          : `${lead.name} is set as a leader. Add copiers whenever you want.`
      );
      this.render();
    });
    actions
      .createEl("button", { cls: "tj-mg-act is-quiet", text: "Cancel", attr: { type: "button" } })
      .addEventListener("click", () => {
        this.newOpen = false;
        this.newLeaderId = "";
        this.newMemberIds = [];
        this.newName = "";
        this.newCopyFrom = "start";
        this.newCopyFromDate = "";
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

    // Disband: two taps, in place. Nothing is destroyed — the notes stay — so it
    // needs no modal, but it does deserve a second look.
    const confirmSlot = card.createDiv({ cls: "tj-mg-confirmslot" });
    const del = head.createEl("button", {
      cls: "tj-mg-del",
      attr: { type: "button", "aria-label": "Delete group" },
    });
    setIcon(del, "trash-2");
    attachTip(del, {
      title: "Delete group",
      sub: "Disband the group. Every trade already copied stays where it is.",
    });
    const plural = members.length === 1 ? "" : "s";
    del.addEventListener("click", () => {
      if (confirmSlot.firstChild) {
        confirmSlot.empty();
        del.removeClass("is-armed");
        return;
      }
      del.addClass("is-armed");
      const bar = confirmSlot.createDiv({ cls: "tj-mg-confirm" });
      bar.createSpan({
        cls: "tj-mg-confirm-txt",
        text: `Disband this group? The ${members.length} copier${plural} keep every trade they already copied.`,
      });
      bar
        .createEl("button", { cls: "tj-mg-act is-danger", text: "Disband", attr: { type: "button" } })
        .addEventListener("click", async () => {
          this.detachAccount(leader);
          await this.apply();
          new Notice(`Group disbanded — ${leader.name} is free again.`);
          this.render();
        });
      bar
        .createEl("button", { cls: "tj-mg-act is-quiet", text: "Cancel", attr: { type: "button" } })
        .addEventListener("click", () => {
          confirmSlot.empty();
          del.removeClass("is-armed");
        });
    });

    // --- the leader itself
    const lrow = card.createDiv({ cls: "tj-mg-lrow" });
    lrow.createSpan({ cls: "tj-mg-badge", text: "LEADER" });
    lrow.createSpan({ cls: "tj-mg-lname", text: leader.name });
    lrow.createSpan({ cls: "tj-mg-lsize", text: fmtMoneyAbs(this.sizeOf(leader)) });

    // --- change the leader: kept right under the leader row, where the eye is
    if (members.length) {
      const swapSect = card.createDiv({ cls: "tj-mg-sect" });
      swapSect.createDiv({ cls: "tj-mg-sectitle", text: "Change leader" });
      const swap = swapSect.createDiv({ cls: "tj-mg-swap" });
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
          if (!next) {
            new Notice("Pick the account that should lead.");
            return;
          }
          const nextAcc = all.find((a) => a.id === next.id);
          if (!nextAcc) return;
          const from = todayIso();
          for (const m of members) {
            const mult = m.copyMultiplier ?? 1;
            // Re-link from scratch: nothing from the old group leaks into the
            // new one, and the ratio is written into the config history.
            unlinkCopier(m);
            m.copyRole = "copier";
            m.copyBaseId = nextAcc.id;
            m.copyMultiplier = mult;
            startCopying(m, nextAcc.id, mult, from);
          }
          const name = leader.copyGroupName;
          const colour = leader.copyGroupColor;
          this.detachAccount(leader);
          nextAcc.copyRole = "base";
          nextAcc.copyGroupName = name ?? nextAcc.copyGroupName;
          nextAcc.copyGroupColor = colour ?? nextAcc.copyGroupColor;
          await this.apply();
          new Notice(`${nextAcc.name} now leads the group.`);
          this.render();
        });
    }

    card.createDiv({
      cls: "tj-mg-hint",
      text: "Remove takes an account out of the group: it keeps every trade it copied so far and simply stops taking new ones. From there it can join another group or become a leader.",
    });

    // --- members, drawn on a tree so the leader/copiers relation reads at a glance
    if (members.length) {
      const tree = card.createDiv({ cls: "tj-mg-tree" });
      for (const m of members) this.renderMember(tree, leader, m);
    }

    // --- add a copier
    const addSect = card.createDiv({ cls: "tj-mg-sect" });
    addSect.createDiv({ cls: "tj-mg-sectitle", text: "Add a copier" });
    const add = addSect.createDiv({ cls: "tj-mg-add" });
    if (free.length) {
      mountDropdown(
        add,
        free.map((f) => ({ id: f.id, label: f.name, note: `${fmtMoneyAbs(this.sizeOf(f))} · not in a group` })),
        this.addPickedId,
        (id) => {
          this.addPickedId = id;
        },
        { placeholder: "Add an account…", title: "An account that is not in a group yet" }
      );
      this.copyStartControl(
        add,
        free.find((f) => f.id === this.addPickedId),
        this.addCopyFrom,
        this.addCopyFromDate,
        (m) => (this.addCopyFrom = m),
        (iso) => (this.addCopyFromDate = iso)
      );
      add
        .createEl("button", { text: "Add to group", cls: "tj-mg-act", attr: { type: "button" } })
        .addEventListener("click", async () => {
          // A pick can go stale when the page redraws under it: drop it and say
          // so, instead of a button that looks live and does nothing.
          const target = free.find((f) => f.id === this.addPickedId);
          if (!target) {
            this.addPickedId = "";
            new Notice("Pick an account first.");
            this.render();
            return;
          }
          unlinkCopier(target);
          target.copyRole = "copier";
          target.copyBaseId = leader.id;
          target.copyMultiplier = 1;
          startCopying(target, leader.id, 1, this.copyStartFor(target, this.addCopyFrom, this.addCopyFromDate));
          this.addPickedId = "";
          this.addCopyFrom = "start";
          this.addCopyFromDate = "";
          await this.apply();
          new Notice(`${target.name} now copies ${leader.name}.`);
          this.render();
        });
    } else {
      add.createSpan({ cls: "tj-mg-empty", text: "Every account is already in a group." });
    }

  }

  private renderMember(card: HTMLElement, leader: PropAccount, m: PropAccount): void {
    const row = card.createDiv({ cls: "tj-mg-mrow" });

    row.createSpan({ cls: "tj-mg-badge is-copier", text: "COPIER" });
    row.createSpan({ cls: "tj-mg-mname", text: m.name });

    // ratio
    row.createSpan({ cls: "tj-mg-x", text: "×" });
    const ratio = freeNumeric(
      row.createEl("input", {
        cls: "tj-mg-ratio",
        attr: { type: "number", value: String(m.copyMultiplier ?? 1) },
      })
    );
    attachTip(ratio, {
      title: "Ratio",
      sub: "Contracts copied per contract of the leader. Under one mini — 0.5× of 1 NQ — the copy is mirrored in micros instead, so the leg is never lost.",
    });
    ratio.addEventListener("change", async () => {
      const v = Math.max(0.1, parseFloat(ratio.value) || 1);
      m.copyMultiplier = v;
      // startCopying, not openCopyPeriod: the new ratio is written into the
      // account's own config history from today, which is what the copy engine
      // actually reads. Legs already generated keep the ratio they were made with.
      startCopying(m, leader.id, v, todayIso());
      await this.apply();
      this.render();
    });

    // Out of the group — one action, no separate pause. Leaving closes the
    // stretch, so the account keeps every trade it already copied and simply
    // stops taking new ones; it can then join another group or lead its own.
    const off = row.createEl("button", {
      cls: "tj-mg-act is-quiet",
      text: "Remove",
      attr: { type: "button" },
    });
    attachTip(off, {
      title: "Remove",
      sub: "Take it out of the group. It keeps every trade it copied and the stretches it ran — link it to another group, or make it a leader, whenever you want.",
    });
    off.addEventListener("click", async () => {
      unlinkCopier(m);
      await this.apply();
      new Notice(`${m.name} is out of the group. It keeps every trade it copied.`);
      this.render();
    });
  }

  private sizeOf(acc: PropAccount): number {
    return acc.size;
  }

  /** Accounts that are in a group right now — a leader, or someone's copier. */
  private linkedAccounts(): PropAccount[] {
    const accounts = this.plugin.settings.propAccounts ?? [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return accounts.filter((a) => a.copyRole === "base" || (!!a.copyBaseId && byId.has(a.copyBaseId)));
  }

  /**
   * Take an account out of its group. Whoever copied it comes out too, or the
   * group would survive around an owner that no longer leads. Only settings
   * change — no trade note is ever rewritten, and every copied leg stays.
   */
  private detachAccount(acc: PropAccount): void {
    const accounts = this.plugin.settings.propAccounts ?? [];
    for (const m of accounts.filter((a) => a.copyBaseId === acc.id)) unlinkCopier(m);
    if (acc.copyRole === "base") {
      acc.copyGroupName = undefined;
      acc.copyGroupColor = undefined;
    }
    unlinkCopier(acc);
  }

  // ----------------------------------------------------------------- types ----

  /**
   * The type rows: what each account type is called, what colour it wears, the
   * order the sections come in and whether the type shows at all. The set of
   * types is fixed — the plugin classifies every trade into one of them — so
   * this is naming, not creating. It lives inside Display, under its own
   * heading, because it is how the page reads rather than a separate surface.
   */
  private renderTypeRows(body: HTMLElement): void {
    const s = this.plugin.settings;
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

      // Show or hide this type on the Accounts page. A pill, not a checkbox:
      // hiding only tidies the page — the accounts keep trading and reporting.
      const visOn = new Set<string>(s.accountsVisibleTypes ?? ALL_TYPES).has(t);
      const vis = val.createEl("button", {
        cls: "tj-mg-vis" + (visOn ? " on" : ""),
        attr: { type: "button", "aria-pressed": String(visOn) },
      });
      setIcon(vis, visOn ? "eye" : "eye-off");
      attachTip(vis, {
        title: visOn ? "Shown on the Accounts page" : "Hidden from the Accounts page",
        sub: "Hiding a type only tidies the page — the accounts keep trading and reporting.",
      });
      vis.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const set = new Set<string>(s.accountsVisibleTypes ?? ALL_TYPES);
        if (visOn) set.delete(t);
        else set.add(t);
        const list = ALL_TYPES.filter((k) => set.has(k)) as AccountType[];
        s.accountsVisibleTypes = list.length ? list : (ALL_TYPES as AccountType[]);
        await this.apply();
        this.render();
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

  // --------------------------------------------------------------- display ----

  private renderDisplay(body: HTMLElement): void {
    const s = this.plugin.settings;

    const layout = this.sectionInfo(body, "Layout", "How the page groups accounts and orders the cards.");

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

    const shown = this.sectionInfo(body, "What appears", "Which badges the cards draw. None of them changes a number.");

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

    // Types used to be a tab of its own; it is how the page reads, so it sits
    // here now — one less place to look for the same decision.
    const types = this.sectionInfo(
      body,
      "Types",
      "Rename, recolour and reorder the account types — and hide the ones you do not use."
    );
    this.renderTypeRows(types);
  }
}
