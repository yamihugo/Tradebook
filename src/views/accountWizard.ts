/**
 * The one-and-only "Add account" wizard.
 *
 * Used by the Accounts tab, the Settings page and (later) the guided tour —
 * so the flow, the firm presets and the disclaimer live in a single place.
 * Controls carry `data-tour="…"` attributes so a tour can point at them.
 */

import type TradebookPlugin from "../main";
import { AccountType, PropAccount } from "../types";
import { PROP_FIRMS, effectiveSize, getFirm, getProgram, getSize, makeAccount, uniqueAccountName } from "../props";
import { fmtMoneyAbs } from "../tz";
import { mountDateField } from "../lib/dates";
import { openCopyPeriod, todayIso } from "../lib/copy";
import { attachTip } from "../lib/tip";

export interface AccountWizardOptions {
  preset?: Partial<PropAccount>;
  onDone?: (acc: PropAccount, createdAnother: boolean) => void;
  /** Tutorial hook — fired on every step change. */
  onStep?: (step: number) => void;
  /** Tutorial hook — the wizard's root element (so a tour can highlight it). */
  onOpen?: (root: HTMLElement) => void;
}

interface Values {
  type: AccountType;
  firmId: string;
  programId: string;
  size: number;
  name: string;
  startingBalance: number;
  createdAt: string;
  rules: { target?: number; maxLoss?: number; dailyLoss?: number; consistency?: number; posSize?: string };
  copyRole: "" | "base" | "copier";
  copyBaseId: string;
  copyMultiplier: number;
  /** Whether the copy link reaches back ("all") or starts on a date. */
  copyFrom: "date" | "all";
  /** The day the link starts (used when copyFrom is "date"). */
  copyStart: string;
  /** Leader only: accounts that start copying this one at the same moment. */
  linkCopierIds: string[];
}

const TYPE_CARDS: Array<{ id: AccountType; label: string; desc: string; icon: string }> = [
  { id: "eval", label: "Eval", desc: "Prop evaluation — pass the target before the max loss.", icon: "🎯" },
  { id: "funded", label: "Funded", desc: "Funded prop account — track payouts and the drawdown buffer.", icon: "💵" },
  { id: "live", label: "Live (prop)", desc: "Live account through a prop firm / broker.", icon: "🔴" },
  { id: "personal", label: "Personal", desc: "Your own money — no prop rules.", icon: "👤" },
  { id: "demo", label: "Demo", desc: "Simulated practice account.", icon: "🧪" },
];

const STEPS = ["Type", "Account", "Details", "Review"];
const isProp = (t: AccountType) => t === "eval" || t === "funded" || t === "live";
/** The most accounts one batch can create — past this it is a spreadsheet job. */
const MAX_BULK = 30;

export function openAccountWizard(plugin: TradebookPlugin, opts: AccountWizardOptions = {}): { close: () => void } {
  const preset = opts.preset ?? {};
  const values: Values = {
    type: (preset.type as AccountType) || "eval",
    firmId: preset.firmId || PROP_FIRMS[0].id,
    programId: preset.programId || "",
    size: preset.size || 0,
    name: preset.name || "",
    startingBalance: preset.size || 0,
    createdAt: new Date().toISOString().slice(0, 10),
    rules: {},
    copyRole: "",
    copyBaseId: "",
    copyMultiplier: 1,
    copyFrom: "date",
    copyStart: new Date().toISOString().slice(0, 10),
    linkCopierIds: [],
  };
  let step = 0;
  /** How many accounts the Review step will create in one go. */
  let createCount = 1;

  const overlay = document.body.createDiv({ cls: "tj-modal-overlay" });
  const modal = overlay.createDiv({ cls: "tj-modal tj-account-wizard", attr: { "data-tour": "wizard" } });
  const root = modal;

  const head = modal.createDiv({ cls: "tj-modal-head" });
  head.createEl("h2", { text: "Add account" });
  const closeBtn = head.createEl("button", { text: "✕", cls: "tj-btn tj-mini", attr: { type: "button" } });
  const close = () => overlay.remove();
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  const steps = modal.createDiv({ cls: "tj-wz-steps" });
  const body = modal.createDiv({ cls: "tj-wz-body" });
  const foot = modal.createDiv({ cls: "tj-wz-foot" });
  const back = foot.createEl("button", { text: "Back", cls: "tj-btn", attr: { type: "button", "data-tour": "wizard-back" } });
  const next = foot.createEl("button", { text: "Next", cls: "tj-btn mod-cta", attr: { type: "button", "data-tour": "wizard-next" } });

  /**
   * The capital of the account. On a prop account the size *is* the starting
   * balance, so the two are written together in one place — keeping them apart
   * is how the review once showed a $50K account holding a $100K balance.
   */
  const setSize = (size: number) => {
    values.size = size;
    values.startingBalance = size;
  };

  const setProgramDefaults = () => {
    const firm = getFirm(values.firmId) ?? PROP_FIRMS[0];
    if (!values.programId || !firm.programs.some((p) => p.id === values.programId)) {
      values.programId = firm.programs[0].id;
    }
    const program = getProgram(firm, values.programId) ?? firm.programs[0];
    if (!values.size || !program.sizes.some((s) => s.size === values.size)) setSize(program.sizes[0].size);
    else setSize(values.size);
  };

  const activeSize = () => {
    const firm = getFirm(values.firmId);
    const program = getProgram(firm, values.programId);
    return effectiveSize(getSize(program, values.size), values.rules);
  };

  const baseName = () => {
    if (!isProp(values.type)) return values.type === "demo" ? "Demo" : "Personal";
    const firm = getFirm(values.firmId);
    const program = getProgram(firm, values.programId);
    return `${firm?.name ?? ""} · ${program?.label ?? ""} · $${(values.size / 1000).toFixed(0)}K`;
  };

  /** The next free name for one account — decided by the same rule as a batch. */
  const suggestedName = () => namesFor(1)[0] ?? baseName();

  /**
   * The names a batch will get. The numbering continues the family that is
   * already there: the first account of its kind takes the plain name ("$50K",
   * which is "one"), and the next ones pick up where the existing ones left off.
   * Starting again at `#1` would leave two accounts claiming to be the first and
   * a hole where the second should be.
   */
  const namesFor = (count: number): string[] => {
    const accounts = plugin.settings.propAccounts || [];
    const taken = new Set(accounts.map((a) => (a.name || "").toLowerCase()));
    const base = (values.name || "").trim() || baseName();
    const baseLower = base.toLowerCase();

    // How many accounts already answer to this name, or to `name #n`.
    let next = 1;
    for (const a of accounts) {
      const n = (a.name || "").toLowerCase();
      if (n === baseLower || n.startsWith(`${baseLower} #`)) next++;
    }

    const out: string[] = [];
    for (let i = next; out.length < count && i < 999; i++) {
      const candidate = i === 1 ? base : `${base} #${i}`;
      const lower = candidate.toLowerCase();
      if (taken.has(lower)) continue;
      taken.add(lower);
      out.push(candidate);
    }
    return out;
  };

  document.addEventListener(
    "click",
    () => document.querySelectorAll(".tj-dd.open").forEach((n) => n.classList.remove("open")),
    true
  );

  const dropdown = (
    host: HTMLElement,
    options: Array<{ id: string; label: string }>,
    value: string,
    onChange: (v: string) => void,
    tour?: string
  ): HTMLElement => {
    const wrap = host.createDiv({ cls: "tj-dd", attr: tour ? { "data-tour": tour } : {} });
    const btn = wrap.createEl("button", { cls: "tj-dd-btn", attr: { type: "button" } });
    const current = options.find((o) => o.id === value);
    btn.createSpan({ cls: "tj-dd-val", text: current?.label ?? "—" });
    btn.createSpan({ cls: "tj-dd-chev", text: "▾" });
    const list = wrap.createDiv({ cls: "tj-dd-list" });
    if (!options.length) list.createDiv({ cls: "tj-dd-empty", text: "No options" });
    for (const o of options) {
      const item = list.createDiv({ cls: "tj-dd-item" + (o.id === value ? " on" : "") });
      item.createSpan({ text: o.label });
      if (o.id === value) item.createSpan({ cls: "tj-dd-check", text: "✓" });
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        onChange(o.id);
        wrap.removeClass("open");
      });
    }
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = !wrap.hasClass("open");
      document.querySelectorAll(".tj-dd.open").forEach((n) => n.classList.remove("open"));
      wrap.toggleClass("open", willOpen);
    });
    return wrap;
  };

  const numberField = (host: HTMLElement, label: string, value: number, onChange: (v: number) => void, opts2?: { step?: number }) => {
    const f = host.createDiv({ cls: "tj-wz-field" });
    f.createEl("label", { text: label, cls: "tj-wz-label" });
    const input = f.createEl("input", {
      cls: "tj-wz-input",
      attr: { type: "number", value: String(value || ""), step: String(opts2?.step ?? 1) },
    });
    input.addEventListener("input", () => onChange(parseFloat(input.value) || 0));
    return input;
  };

  // ------------------------------------------------------------------ steps
  const renderSteps = () => {
    steps.empty();
    STEPS.forEach((label, i) => {
      const s = steps.createDiv({ cls: "tj-wz-step" + (i === step ? " on" : i < step ? " done" : "") });
      s.createSpan({ cls: "tj-wz-step-n", text: i < step ? "✓" : String(i + 1) });
      s.createSpan({ cls: "tj-wz-step-l", text: label });
    });
  };

  const renderType = () => {
    const grid = body.createDiv({ cls: "tj-wz-types", attr: { "data-tour": "wizard-type" } });
    for (const t of TYPE_CARDS) {
      const card = grid.createDiv({ cls: "tj-wz-type" + (values.type === t.id ? " on" : ""), attr: { "data-tour": `wizard-type-${t.id}` } });
      card.createDiv({ cls: "tj-wz-type-ico", text: t.icon });
      card.createDiv({ cls: "tj-wz-type-l", text: t.label });
      card.createDiv({ cls: "tj-wz-type-d", text: t.desc });
      card.addEventListener("click", () => {
        values.type = t.id;
        values.rules = {};
        if (!isProp(t.id)) {
          values.firmId = "own";
          values.programId = t.id === "demo" ? "demo" : "personal";
        } else if (values.programId === "personal" || values.programId === "demo") {
          values.firmId = PROP_FIRMS[0].id;
          values.programId = "";
        }
        setProgramDefaults();
        renderStep();
      });
    }
  };

  const renderAccount = () => {
    const cols = body.createDiv({ cls: "tj-wz-cols" });
    const left = cols.createDiv({ cls: "tj-wz-col" });
    const right = cols.createDiv({ cls: "tj-wz-col" });

    if (isProp(values.type)) {
      const phase = values.type as "eval" | "funded" | "live";
      const firms = PROP_FIRMS.filter((f) => f.programs.some((p) => p.phase === phase));
      const firm = getFirm(values.firmId) ?? firms[0] ?? PROP_FIRMS[0];
      const programs = firm.programs.filter((p) => p.phase === phase);
      if (!programs.some((p) => p.id === values.programId)) {
        values.programId = programs[0]?.id ?? "";
        values.size = 0;
      }

      // ---- firm (chips) ----
      const firmWrap = left.createDiv({ cls: "tj-wz-field", attr: { "data-tour": "wizard-firm" } });
      firmWrap.createEl("label", { text: "Prop firm", cls: "tj-wz-label" });
      const firmChips = firmWrap.createDiv({ cls: "tj-wz-chips" });
      for (const f of firms) {
        const chip = firmChips.createDiv({ cls: "tj-wz-chip tj-wz-chip-wide" + (f.id === values.firmId ? " on" : "") });
        const logoUrl = plugin.firmLogoUrl?.(f.id);
        if (logoUrl) {
          const img = chip.createEl("img", { cls: "tj-wz-firmlogo", attr: { alt: f.name } });
          img.src = logoUrl;
          img.addEventListener("error", () => img.remove());
        }
        chip.createSpan({ cls: "tj-wz-chipname", text: f.name });
        chip.addEventListener("click", () => {
          values.firmId = f.id;
          values.programId = "";
          values.size = 0;
          values.rules = {};
          setProgramDefaults();
          renderStep();
        });
      }

      // ---- program (chips, same language as the firm) ----
      const progWrap = left.createDiv({ cls: "tj-wz-field", attr: { "data-tour": "wizard-program" } });
      progWrap.createEl("label", { text: "Program", cls: "tj-wz-label" });
      const progChips = progWrap.createDiv({ cls: "tj-wz-chips" });
      for (const p of programs) {
        const chip = progChips.createDiv({ cls: "tj-wz-chip tj-wz-chip-wide" + (p.id === values.programId ? " on" : "") });
        chip.createSpan({ text: p.label });
        chip.addEventListener("click", () => {
          values.programId = p.id;
          values.size = 0;
          values.rules = {};
          setProgramDefaults();
          renderStep();
        });
      }

      // ---- size ----
      const program = getProgram(firm, values.programId) ?? programs[0];
      if (program) {
        if (!values.size || !program.sizes.some((sz) => sz.size === values.size)) setSize(program.sizes[0].size);
        else setSize(values.size);
        const sizeWrap = left.createDiv({ cls: "tj-wz-field", attr: { "data-tour": "wizard-size" } });
        sizeWrap.createEl("label", { text: "Account size", cls: "tj-wz-label" });
        const chips = sizeWrap.createDiv({ cls: "tj-wz-chips" });
        for (const sz of program.sizes) {
          const chip = chips.createDiv({ cls: "tj-wz-chip" + (values.size === sz.size ? " on" : "") });
          chip.createSpan({ text: `$${(sz.size / 1000).toFixed(0)}K` });
          if (sz.price) chip.createSpan({ cls: "tj-wz-chip-sub", text: sz.price });
          chip.addEventListener("click", () => {
            values.rules = {};
            setSize(sz.size);
            renderStep();
          });
        }
      }

      // ---- rules preview + edit ----
      const rules = right.createDiv({ cls: "tj-wz-rules", attr: { "data-tour": "wizard-rules" } });
      const eff = activeSize();
      const line = (label: string, v: string) => {
        const r = rules.createDiv({ cls: "tj-wz-rule" });
        r.createSpan({ text: label });
        r.createEl("b", { text: v });
      };
      line("Profit target", eff && eff.target ? `$${eff.target.toLocaleString()}` : "—");
      line("Max loss", eff && eff.maxLoss ? `-$${eff.maxLoss.toLocaleString()}` : "—");
      line("Daily loss", eff && eff.dailyLoss ? `-$${eff.dailyLoss.toLocaleString()}` : "None");
      line(
        "Consistency",
        eff && eff.consistency
          ? `${eff.consistency}% ${eff.consistencyBasis === "target" ? "(of target)" : "(of profit)"}`
          : "None"
      );
      line("Position size", (eff && eff.posSize) || "—");
      if (eff && eff.minDays) line("Min trading days", String(eff.minDays));
      if (eff && eff.maxLossType) line("Drawdown", eff.maxLossType === "static" ? "Static" : "End-of-day trailing");

      const editBtn = rules.createEl("button", { text: "Adjust rules", cls: "tj-btn tj-mini", attr: { type: "button" } });
      const editBox = left.createDiv({ cls: "tj-wz-row tj-wz-editrules" });
      editBox.style.display = "none";
      editBtn.addEventListener("click", () => {
        editBox.style.display = editBox.style.display === "none" ? "flex" : "none";
      });
      numberField(editBox, "Target", values.rules.target ?? eff?.target ?? 0, (v) => (values.rules.target = v));
      numberField(editBox, "Max loss", values.rules.maxLoss ?? eff?.maxLoss ?? 0, (v) => (values.rules.maxLoss = v));
      numberField(editBox, "Daily loss", values.rules.dailyLoss ?? eff?.dailyLoss ?? 0, (v) => (values.rules.dailyLoss = v));
      numberField(editBox, "Consistency %", values.rules.consistency ?? eff?.consistency ?? 0, (v) => (values.rules.consistency = v));

      const disc = right.createDiv({ cls: "tj-wz-disclaimer", attr: { "data-tour": "wizard-disclaimer" } });
      disc.createSpan({ text: "⚠️" });
      disc.createSpan({
        text: "Prop firms change their rules often — please double-check the numbers above before saving. You can edit them later.",
      });
    } else {
      // personal / demo: starting balance only
      numberField(left, "Starting balance", values.startingBalance || 0, (v) => {
        values.startingBalance = v;
        values.size = v;
      });
      const note = right.createDiv({ cls: "tj-wz-disclaimer" });
      note.createSpan({ text: "ℹ️" });
      note.createSpan({
        text: values.type === "demo"
          ? "Demo accounts have no rules — they only track your performance."
          : "Personal accounts have no prop rules. The balance is what you actually have.",
      });
    }
  };

  const renderDetails = () => {
    // Two titled sections, so the tab reads in order: the account itself, then
    // how it relates to a trading group.
    const basics = body.createDiv({ cls: "tj-wz-sect" });
    basics.createDiv({ cls: "tj-wz-sectitle", text: "Account" });
    const row = basics.createDiv({ cls: "tj-wz-row" });
    const f = row.createDiv({ cls: "tj-wz-field tj-wz-wide" });
    f.createEl("label", { text: "Name", cls: "tj-wz-label" });
    const nameInput = f.createEl("input", {
      cls: "tj-wz-input",
      attr: { type: "text", placeholder: suggestedName(), value: values.name, "data-tour": "wizard-name" },
    });
    nameInput.addEventListener("input", () => (values.name = nameInput.value));

    // Started on — anchors the equity curve and copy-trading periods.
    const meta = basics.createDiv({ cls: "tj-wz-row" });
    const d = meta.createDiv({ cls: "tj-wz-field", attr: { "data-tour": "wizard-started" } });
    d.createEl("label", { text: "Started on", cls: "tj-wz-label" });
    // Printed in the format chosen in Settings: a native date input always shows
    // the operating system's format, which made the setting look ignored.
    mountDateField(d, {
      value: values.createdAt,
      format: plugin.settings.dateFormat,
      onChange: (iso) => (values.createdAt = iso),
    });

    if (isProp(values.type)) {
      // Prop accounts start at the account size — no manual balance.
      const b = meta.createDiv({ cls: "tj-wz-field" });
      b.createEl("label", { text: "Balance", cls: "tj-wz-label" });
      b.createDiv({ cls: "tj-wz-static", text: `Starts at $${values.size.toLocaleString()}` });
    }

    // Copy trading (optional). Same model as the account modal: a role, a leader
    // shown with context (never blind), an explicit starting point, and the rule
    // that linking never rewrites trades already recorded in the account.
    const copyBox = body.createDiv({ cls: "tj-wz-copy", attr: { "data-tour": "wizard-copy" } });
    const head2 = copyBox.createDiv({ cls: "tj-wz-copy-head" });
    head2.createSpan({ cls: "tj-wz-copy-title", text: "Copy trading" });
    const roleSeg = head2.createDiv({ cls: "tj-wz-seg" });
    const detail = copyBox.createDiv({ cls: "tj-wz-copydetail" });

    const roleOpts: Array<[Values["copyRole"], string]> = [
      ["", "Not in a group"],
      ["base", "👑 Leader"],
      ["copier", "Copier"],
    ];

    const renderCopy = () => {
      roleSeg.empty();
      for (const [id, label] of roleOpts) {
        const b = roleSeg.createEl("button", {
          cls: "tj-wz-seg-opt" + (values.copyRole === id ? " on" : ""),
          text: label,
          attr: { type: "button" },
        });
        b.addEventListener("click", () => {
          if (values.copyRole === id) return;
          values.copyRole = id;
          if (id !== "copier") values.copyBaseId = "";
          renderCopy();
        });
      }

      detail.empty();

      if (values.copyRole === "") {
        detail.createDiv({
          cls: "tj-wz-copy-hint",
          text: "This account stands on its own. You can link it to a group later — linking never rewrites trades already recorded here.",
        });
        return;
      }

      const all = plugin.settings.propAccounts || [];
      const nameOf = (id?: string) => all.find((a) => a.id === id)?.name ?? "another account";
      /** Accounts that could still join a group, and the ones already in one. */
      const free = all.filter((a) => a.copyRole !== "copier");
      const busy = all.filter((a) => a.copyRole === "copier");
      // A copier always points at someone: if nothing is chosen yet (or the
      // chosen leader is gone), fall back to the first available one so we never
      // save a link that leads nowhere.
      if (values.copyRole === "copier" && !free.some((a) => a.id === values.copyBaseId) && free.length) {
        values.copyBaseId = free[0].id;
      }

      if (values.copyRole === "base") {
        detail.createDiv({
          cls: "tj-wz-copy-hint",
          text: "Other accounts can copy this one. The copiers show up on this account's page, and each keeps its own history.",
        });
        const pickField = detail.createDiv({ cls: "tj-wz-row" }).createDiv({ cls: "tj-wz-field tj-wz-wide" });
        pickField.createEl("label", { text: "Start the group now (optional)", cls: "tj-wz-label" });
        const pickList = pickField.createDiv({ cls: "tj-wz-leader-list" });
        const drawPick = () => {
          pickList.empty();
          if (!all.length) {
            pickList.createDiv({
              cls: "tj-wz-copy-hint",
              text: "No other accounts yet — you can link copiers later from this account's page.",
            });
          }
          for (const c of free) {
            const on = values.linkCopierIds.includes(c.id);
            const el = pickList.createDiv({ cls: "tj-wz-leader" + (on ? " on" : "") });
            el.createSpan({ cls: "tj-wz-pick", text: on ? "✓" : "" });
            const inner = el.createDiv({ cls: "tj-wz-leader-body" });
            inner.createDiv({ cls: "tj-wz-leader-nm", text: c.name });
            inner.createDiv({ cls: "tj-wz-leader-sub", text: `${fmtMoneyAbs(c.size)} · not in a group` });
            el.addEventListener("click", () => {
              values.linkCopierIds = on
                ? values.linkCopierIds.filter((x) => x !== c.id)
                : [...values.linkCopierIds, c.id];
              drawPick();
            });
          }
          for (const c of busy) {
            const el = pickList.createDiv({ cls: "tj-wz-leader is-taken" });
            el.createSpan({ cls: "tj-wz-pick" });
            const inner = el.createDiv({ cls: "tj-wz-leader-body" });
            inner.createDiv({ cls: "tj-wz-leader-nm", text: c.name });
            inner.createDiv({ cls: "tj-wz-leader-sub", text: `already copies ${nameOf(c.copyBaseId)}` });
            attachTip(el, { title: "Already in a group", sub: "Unlink it there first — a copier cannot lead another group." });
          }
        };
        drawPick();
        if (values.linkCopierIds.length) {
          detail.createDiv({
            cls: "tj-wz-copy-hint",
            text: `${values.linkCopierIds.length} account${
              values.linkCopierIds.length === 1 ? "" : "s"
            } will start copying this one today at 1× — you can change the ratio per account later.`,
          });
        }
        return;
      }

      // ---- copier: pick a leader, with context so it is never a blind guess ----
      const row = detail.createDiv({ cls: "tj-wz-row" });
      const leadField = row.createDiv({ cls: "tj-wz-field tj-wz-wide" });
      leadField.createEl("label", { text: "Leader account", cls: "tj-wz-label" });
      const list = leadField.createDiv({ cls: "tj-wz-leader-list" });

      // No chains: only accounts that are not copying anything can lead.
      const subs = new Map<string, { el: HTMLElement; acc: PropAccount; count?: number }>();

      const listText = (acc: PropAccount, count?: number): string => {
        const role = acc.copyRole === "base" ? "👑 Leader" : "not in a group";
        const copiers = all.filter((a) => a.copyBaseId === acc.id).length;
        const bits = [fmtMoneyAbs(acc.size), role];
        if (count !== undefined) bits.push(`${count} trade${count === 1 ? "" : "s"}`);
        if (copiers) bits.push(`${copiers} copier${copiers === 1 ? "" : "s"}`);
        return bits.join(" · ");
      };

      const rowFor = (c: PropAccount) => {
        const el = list.createDiv({ cls: "tj-wz-leader" + (values.copyBaseId === c.id ? " on" : "") });
        el.createSpan({ cls: "tj-wz-leader-dot" });
        const inner = el.createDiv({ cls: "tj-wz-leader-body" });
        inner.createDiv({ cls: "tj-wz-leader-nm", text: c.name });
        const sub = inner.createDiv({ cls: "tj-wz-leader-sub", text: listText(c) });
        subs.set(c.id, { el: sub, acc: c });
        el.addEventListener("click", () => {
          values.copyBaseId = c.id;
          drawList();
        });
      };
      const group = (title: string | null, rows: PropAccount[]) => {
        if (!rows.length) return;
        if (title) list.createDiv({ cls: "tj-wz-listsep", text: title });
        for (const c of rows) rowFor(c);
      };
      const drawList = () => {
        list.empty();
        subs.clear();
        // Leaders first: the accounts that already lead a group are the ones you
        // are most likely to copy, so they read before the standalone ones.
        const leaders = free.filter((a) => a.copyRole === "base");
        const standalone = free.filter((a) => a.copyRole !== "base");
        group(leaders.length ? "Leaders" : null, leaders);
        group(leaders.length && standalone.length ? "Not in a group" : null, standalone);
        // Shown greyed, never selectable: a copier cannot lead another group,
        // but hiding it would leave the user guessing which accounts are taken.
        if (busy.length) {
          list.createDiv({ cls: "tj-wz-listsep", text: "Already in a group" });
          for (const c of busy) {
            const el = list.createDiv({ cls: "tj-wz-leader is-taken" });
            el.createSpan({ cls: "tj-wz-leader-dot" });
            const inner = el.createDiv({ cls: "tj-wz-leader-body" });
            inner.createDiv({ cls: "tj-wz-leader-nm", text: c.name });
            inner.createDiv({ cls: "tj-wz-leader-sub", text: `already copies ${nameOf(c.copyBaseId)}` });
            attachTip(el, { title: "Already a copier", sub: "No chains: a copier cannot lead another group." });
          }
        }
        if (!free.length && !busy.length) {
          list.createDiv({ cls: "tj-wz-copy-hint", text: "No account can lead a group yet — add another account first." });
        }
      };
      drawList();
      if (!free.length) {
        detail.createDiv({
          cls: "tj-wz-copy-hint",
          text: "Every account is already in a group — unlink one first (a copier cannot lead another group).",
        });
      }

      const numRow = detail.createDiv({ cls: "tj-wz-row" });
      numberField(numRow, "Ratio (×)", values.copyMultiplier, (v) => (values.copyMultiplier = v), { step: 0.5 });

      const fromField = numRow.createDiv({ cls: "tj-wz-field" });
      fromField.createEl("label", { text: "Copy from", cls: "tj-wz-label" });
      const seg = fromField.createDiv({ cls: "tj-wz-seg" });
      const fromOpt = (id: "date" | "all", label: string) => {
        const b = seg.createEl("button", {
          cls: "tj-wz-seg-opt" + (values.copyFrom === id ? " on" : ""),
          text: label,
          attr: { type: "button" },
        });
        b.addEventListener("click", () => {
          values.copyFrom = id;
          renderCopy();
        });
      };
      fromOpt("date", "From a date");
      fromOpt("all", "All history");
      if (values.copyFrom === "date") {
        // The date gets its own full-width line: squeezed under the segment it
        // was hard to tell what it belonged to.
        const dateRow = detail.createDiv({ cls: "tj-wz-row" });
        const df = dateRow.createDiv({ cls: "tj-wz-field tj-wz-wide" });
        df.createEl("label", { text: "Start date", cls: "tj-wz-label" });
        mountDateField(df, {
          value: values.copyStart,
          format: plugin.settings.dateFormat,
          onChange: (iso) => (values.copyStart = iso),
        });
      }
      detail.createDiv({
        cls: "tj-wz-copy-hint",
        text:
          values.copyFrom === "all"
            ? "Brings the leader's whole history into this account, so it shows trades from before you linked it."
            : "Only trades from this date onwards land here. Anything already in the account stays exactly as it is.",
      });

      // Fill the trade counts when they arrive — a nicety, never a blocker.
      void plugin
        .loadTradesExpanded()
        .then((trades) => {
          const counts = new Map<string, number>();
          for (const t of trades) {
            const m = plugin.mappedAccount(t.account);
            if (m) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
          }
          for (const [, entry] of subs) {
            entry.count = counts.get(entry.acc.id) ?? 0;
            entry.el.setText(listText(entry.acc, entry.count));
          }
        })
        .catch(() => undefined);
    };
    renderCopy();
  };

  const renderReview = () => {
    const eff = activeSize();
    const box = body.createDiv({ cls: "tj-wz-review", attr: { "data-tour": "wizard-review" } });

    // Two cards, in this order: what the account is, then how it relates to a
    // group. Kept apart so the copy story is never buried in a list of numbers.
    const card = (title: string) => {
      const c = box.createDiv({ cls: "tj-wz-sumcard" });
      c.createDiv({ cls: "tj-wz-sumtitle", text: title });
      const rows = c.createDiv({ cls: "tj-wz-sumrows" });
      return (label: string, v: string) => {
        const r = rows.createDiv({ cls: "tj-wz-sumrow" });
        r.createSpan({ cls: "tj-wz-sumk", text: label });
        r.createSpan({ cls: "tj-wz-sumv", text: v });
      };
    };

    const accLine = card(TYPE_CARDS.find((t) => t.id === values.type)?.label ?? values.type);
    if (isProp(values.type)) {
      accLine("Firm", getFirm(values.firmId)?.name ?? values.firmId);
      accLine("Program", getProgram(getFirm(values.firmId), values.programId)?.label ?? values.programId);
      accLine("Size", `$${(values.size / 1000).toFixed(0)}K`);
      accLine("Profit target", eff && eff.target ? `$${eff.target.toLocaleString()}` : "—");
      accLine("Max loss", eff && eff.maxLoss ? `-$${eff.maxLoss.toLocaleString()}` : "—");
    }
    const bulkNames = namesFor(createCount);
    accLine("Name", createCount > 1 ? `${bulkNames[0]} + ${createCount - 1} more` : values.name || suggestedName());
    if (values.createdAt) accLine("Started on", values.createdAt);
    // A prop account's size *is* its starting balance: printing both invited the
    // same number to appear twice, and once to disagree with itself.
    if (!isProp(values.type) && values.startingBalance) {
      accLine("Starting balance", `$${values.startingBalance.toLocaleString()}`);
    }

    // Copy trading, said in plain words: what is linked, from when, and whether
    // anything already in the account is touched (it never is).
    const grp = card("Trading group");
    if (values.copyRole) {
      grp("Copy role", values.copyRole === "base" ? "👑 Leader" : `Copier ×${values.copyMultiplier}`);
      if (values.copyRole === "copier") {
        const leader = (plugin.settings.propAccounts ?? []).find((a) => a.id === values.copyBaseId);
        grp("Copies from", leader?.name ?? "—");
        grp("Copy from", values.copyFrom === "all" ? "All history" : values.copyStart || values.createdAt);
      } else {
        const names = values.linkCopierIds
          .map((id) => (plugin.settings.propAccounts ?? []).find((a) => a.id === id)?.name)
          .filter((n): n is string => !!n);
        grp("Copiers starting now", names.length ? names.join(", ") : "None yet");
      }
      const allHistory = values.copyRole === "copier" && values.copyFrom === "all";
      const note = box.createDiv({ cls: "tj-wz-copynote" + (allHistory ? " is-warn" : "") });
      note.createSpan({ cls: "tj-wz-copynote-ico", text: allHistory ? "⚠️" : "ⓘ" });
      note.createSpan({
        text:
          values.copyRole === "base"
            ? "New accounts can copy this one later. Each copier keeps its own history — nothing here is rewritten."
            : allHistory
              ? "This account will also show the leader's earlier trades, so its P&L and trade count include trades you did not place here."
              : "Only trades from this date onwards are added. Anything already recorded in this account stays exactly as it is.",
      });
    } else {
      grp("Copy role", "Not in a group");
      const note = box.createDiv({ cls: "tj-wz-copynote" });
      note.createSpan({ cls: "tj-wz-copynote-ico", text: "ⓘ" });
      note.createSpan({
        text: "This account stands alone — nothing is copied in or out. You can link it later without touching trades already recorded.",
      });
    }
    // How many accounts of this shape? The count belongs at the moment of
    // creating, and the names are numbered right here — nothing to invent,
    // nothing that can collide.
    const many = box.createDiv({ cls: "tj-wz-many" });
    const manyHead = many.createDiv({ cls: "tj-wz-many-head" });
    manyHead.createSpan({ cls: "tj-wz-many-lbl", text: "How many accounts" });
    const namesEl = many.createDiv({ cls: "tj-wz-many-names" });

    const drawMany = () => {
      namesEl.empty();
      next.setText(createCount > 1 ? `Create ${createCount} accounts` : "Create account");
      if (createCount < 2) return;
      namesEl.createDiv({
        cls: "tj-wz-many-note",
        text: "Same firm, size, rules and start date — only the name changes:",
      });
      for (const n of namesFor(createCount)) namesEl.createDiv({ cls: "tj-wz-many-name", text: n });
    };

    if (values.copyRole === "base") {
      // A trading group has exactly one leader: five at once would leave four of
      // them leading nothing, so a leader is created on its own.
      many.createDiv({
        cls: "tj-wz-many-hint",
        text: "A trading group has one leader, so a leader is created one at a time — create it, then add its copiers under Manage → Copy groups.",
      });
    } else {
      const stepper = manyHead.createDiv({ cls: "tj-wz-stepper" });
      const dec = stepper.createEl("button", {
        cls: "tj-wz-stepper-btn",
        text: "−",
        attr: { type: "button", "aria-label": "One fewer" },
      });
      const val = stepper.createSpan({ cls: "tj-wz-stepper-val", text: String(createCount) });
      const inc = stepper.createEl("button", {
        cls: "tj-wz-stepper-btn",
        text: "+",
        attr: { type: "button", "aria-label": "One more" },
      });
      const bump = (d: number) => {
        createCount = Math.min(MAX_BULK, Math.max(1, createCount + d));
        val.setText(String(createCount));
        drawMany();
      };
      dec.addEventListener("click", () => bump(-1));
      inc.addEventListener("click", () => bump(1));
      drawMany();
    }

    const warn = box.createDiv({ cls: "tj-wz-disclaimer" });
    warn.createSpan({ text: "⚠️" });
    warn.createSpan({ text: "Check the rules one last time. They are editable later in Settings → Accounts." });
  };

  const renderStep = () => {
    body.empty();
    renderSteps();
    if (step === 0) renderType();
    else if (step === 1) renderAccount();
    else if (step === 2) renderDetails();
    else renderReview();

    back.style.visibility = step === 0 ? "hidden" : "visible";
    next.setText(step !== STEPS.length - 1 ? "Next" : createCount > 1 ? `Create ${createCount} accounts` : "Create account");
    another.style.display = step === STEPS.length - 1 ? "inline-flex" : "none";
    opts.onStep?.(step);
  };

  /**
   * One account from the current values. Every field but the name is shared,
   * which is the entire point of a batch: five evals of the same firm differ by
   * their number, not by their rules.
   */
  const build = (name: string): PropAccount => {
    const taken = (plugin.settings.propAccounts || []).map((a) => a.name);
    const acc: PropAccount = isProp(values.type)
      ? makeAccount(getFirm(values.firmId) ?? PROP_FIRMS[0], getProgram(getFirm(values.firmId), values.programId) ?? PROP_FIRMS[0].programs[0], values.size, name, values.type)
      : makeAccount(getFirm("own")!, getProgram(getFirm("own"), values.type === "demo" ? "demo" : "personal")!, values.startingBalance || values.size, name || (values.type === "demo" ? "Demo" : "Personal"), values.type);
    acc.name = uniqueAccountName(acc.name, taken);
    if (values.createdAt) acc.createdAt = values.createdAt;

    if (isProp(values.type) && Object.keys(values.rules).length) acc.rules = { ...values.rules };
    if (values.copyRole) {
      acc.copyRole = values.copyRole;
      if (values.copyRole === "copier") {
        const mult = Math.max(0.1, values.copyMultiplier || 1);
        acc.copyMultiplier = mult;
        if (values.copyBaseId) acc.copyBaseId = values.copyBaseId;
        // A copier writes down when the link starts: the account's own memory.
        // "All history" is explicit — it never happens by accident.
        const from = values.copyFrom === "all" ? "0000-01-01" : values.copyStart || values.createdAt;
        if (values.copyBaseId) {
          acc.copyPeriods = [{ start: from, baseId: values.copyBaseId, multiplier: mult }];
          acc.copyConfigHistory = [{ from, ratio: mult }];
        }
      }
    }
    if (!acc.name || !acc.name.trim()) acc.name = suggestedName();
    return acc;
  };

  const create = (count: number, another: boolean) => {
    const names = namesFor(count);
    const made: PropAccount[] = [];
    for (let i = 0; i < count; i++) {
      const built = build(names[i] ?? "");
      plugin.settings.propAccounts.push(built);
      made.push(built);
    }
    const acc = made[0];

    // A new leader can pull accounts in straight away. They are linked from
    // today at 1× — the same "period memory" every other link uses, so nothing
    // that happened before is ever rewritten.
    if (values.copyRole === "base" && values.linkCopierIds.length) {
      const from = todayIso();
      for (const id of values.linkCopierIds) {
        const other = (plugin.settings.propAccounts || []).find((a) => a.id === id);
        if (!other || other.copyRole === "copier") continue;
        other.copyRole = "copier";
        other.copyBaseId = acc.id;
        other.copyMultiplier = 1;
        openCopyPeriod(other, acc.id, 1, from);
      }
    }

    void plugin.saveSettings().then(() => plugin.reloadAllViews());
    opts.onDone?.(acc, another);

    if (another) {
      values.name = "";
      values.copyRole = "";
      values.linkCopierIds = [];
      createCount = 1;
      step = 0;
      renderStep();
    } else {
      close();
    }
  };

  back.addEventListener("click", () => {
    if (step > 0) {
      step -= 1;
      renderStep();
    }
  });
  next.addEventListener("click", () => {
    if (step < STEPS.length - 1) {
      step += 1;
      renderStep();
    } else {
      create(createCount, false);
    }
  });

  const another = foot.createEl("button", { text: "Create & add another", cls: "tj-btn", attr: { type: "button" } });
  another.addEventListener("click", () => create(createCount, true));
  another.style.display = "none";

  setProgramDefaults();
  renderStep();
  opts.onOpen?.(root);

  return { close };
}
