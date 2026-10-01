/**
 * The one-and-only "Add account" wizard.
 *
 * The account is the source of truth: there are no hardcoded prop-firm presets
 * driving it. The trader picks a type, names the account, chooses a packaged
 * logo (or types initials) and enters the rules as their firm publishes them.
 * A matching published preset is offered as a starting point — never required.
 * Controls carry `data-tour="…"` attributes so a tour can point at them.
 */

import { setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { AccountRules, AccountType, PropAccount } from "../types";
import { uniqueAccountName } from "../props";
import { freeNumeric } from "../lib/numeric";
import { isPropType } from "../lib/accountRules";
import { FIRM_CATALOG, firmLabel, firmLogoUrl } from "../lib/firmLogos";
import { ACCOUNT_SIZES, CREATION_TYPES, TYPE_CATALOG, typeLabel } from "../lib/accountTypes";
import { formatDate, mountDateField } from "../lib/dates";

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
  /** Packaged logo id, or "own" for the practice symbol. */
  logoId: string;
  /** Draw initials instead of a packaged logo. */
  custom: boolean;
  initials: string;
  name: string;
  /** The account size — one number, and the name follows it. */
  size: number;
  createdAt: string;
  rules: AccountRules;
}

const STEPS = ["Type", "Brand", "Account", "Review"];
const isProp = isPropType;
/** The most accounts one batch can create — past this it is a spreadsheet job. */
const MAX_BULK = 30;

const DD_TYPES: Array<{ id: string; label: string }> = [
  { id: "eod-trailing", label: "End-of-day trailing" },
  { id: "intraday-trailing", label: "Intraday trailing" },
  { id: "eod-trailing-open", label: "End-of-day trailing, never locks" },
  { id: "static", label: "Static" },
];

function initialsFrom(name: string): string {
  const out = (name || "?")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  return out || "?";
}

/**
 * A single document-level click closes any open wizard dropdown. Installed
 * once for the whole plugin session — the wizard can open many times, so a
 * listener added per open would leak.
 */
let ddCloseInstalled = false;
function ensureDropdownCloseListener(): void {
  if (ddCloseInstalled) return;
  ddCloseInstalled = true;
  document.addEventListener(
    "click",
    () => document.querySelectorAll(".tj-dd.open").forEach((n) => n.classList.remove("open")),
    true
  );
}

export function openAccountWizard(plugin: TradebookPlugin, opts: AccountWizardOptions = {}): { close: () => void } {
  const preset = opts.preset ?? {};
  const presetProp = preset.type ? isProp(preset.type as AccountType) : true;
  const values: Values = {
    type: (preset.type as AccountType) || "eval",
    logoId: preset.firmId || (presetProp ? "topstep" : "own"),
    custom: preset.branding ? preset.branding.kind === "initials" : false,
    initials: preset.branding?.initials || "",
    name: preset.name || "",
    size: preset.size || 0,
    createdAt: "",
    rules: preset.rules ? { ...preset.rules } : {},
  };
  let step = 0;
  /** How many accounts the Review step will create in one go. */
  let createCount = 1;
  /** Once the trader types a name, the balance/logo stop rewriting it. */
  let nameTouched = false;
  /** The trader picked "Custom…" in the size list, so the amount field is shown. */
  let customSize = false;
  /** The step-3 helper line, toggled by updateNext(). */
  let sizeHint: HTMLElement | null = null;

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

  /** Every type walks the same four steps — the last one only drops the rules. */
  const flow = () => [0, 1, 2, 3];

  const baseName = () => {
    const label = firmLabel(values.logoId) || "Prop";
    const kind = typeLabel(values.type);
    if (!values.size) return `${label} ${kind}`;
    return `${label} ${kind} $${(values.size / 1000).toFixed(0)}K`;
  };

  /** The next free name for one account — decided by the same rule as a batch. */
  const suggestedName = () => namesFor(1)[0] ?? baseName();

  /**
   * The names a batch will get. The numbering continues the family that is
   * already there: the first account of its kind takes the plain name, and the
   * next ones pick up where the existing ones left off.
   */
  const namesFor = (count: number): string[] => {
    const accounts = plugin.settings.propAccounts || [];
    const taken = new Set(accounts.map((a) => (a.name || "").toLowerCase()));
    const base = (values.name || "").trim() || baseName();
    const baseLower = base.toLowerCase();

    let start = 1;
    for (const a of accounts) {
      const n = (a.name || "").toLowerCase();
      if (n === baseLower || n.startsWith(`${baseLower} #`)) start++;
    }

    const out: string[] = [];
    for (let i = start; out.length < count && i < 999; i++) {
      const candidate = i === 1 ? base : `${base} #${i}`;
      const lower = candidate.toLowerCase();
      if (taken.has(lower)) continue;
      taken.add(lower);
      out.push(candidate);
    }
    return out;
  };

  ensureDropdownCloseListener();

  const dropdown = (
    host: HTMLElement,
    options: Array<{ id: string; label: string }>,
    value: string,
    onChange: (v: string) => void,
    tour?: string,
    placeholder?: string
  ): HTMLElement => {
    const wrap = host.createDiv({ cls: "tj-dd", attr: tour ? { "data-tour": tour } : {} });
    const btn = wrap.createEl("button", { cls: "tj-dd-btn", attr: { type: "button" } });
    const current = options.find((o) => o.id === value);
    btn.createSpan({ cls: "tj-dd-val", text: current?.label ?? placeholder ?? "—" });
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

  /** A number with a fixed unit inside the box ($ before, % or "days" after). */
  const affixField = (
    host: HTMLElement,
    label: string,
    unit: { prefix?: string; suffix?: string },
    value: number,
    onChange: (v: number) => void
  ) => {
    const f = host.createDiv({ cls: "tj-wz-field" });
    f.createEl("label", { text: label, cls: "tj-wz-label" });
    const wrap = f.createDiv({ cls: "tj-wz-affix" });
    if (unit.prefix) wrap.createSpan({ cls: "tj-wz-affix-pre", text: unit.prefix });
    const input = freeNumeric(
      wrap.createEl("input", {
        cls: "tj-wz-input",
        attr: { type: "number", value: value ? String(value) : "" },
      })
    );
    if (unit.suffix) wrap.createSpan({ cls: "tj-wz-affix-suf", text: unit.suffix });
    input.addEventListener("input", () => onChange(parseFloat(input.value) || 0));
    return input;
  };

  /** A $ / % amount — the trader picks the unit, inline, next to the label. */
  const amountField = (
    host: HTMLElement,
    label: string,
    dollars: number | undefined,
    pct: number | undefined,
    set: (d: number | undefined, p: number | undefined) => void
  ) => {
    const f = host.createDiv({ cls: "tj-wz-field" });
    const head = f.createDiv({ cls: "tj-wz-affixhead" });
    head.createEl("label", { text: label, cls: "tj-wz-label" });
    const toggle = head.createDiv({ cls: "tj-wz-untoggle" });
    let mode = pct !== undefined ? "%" : "$";

    const wrap = f.createDiv({ cls: "tj-wz-affix" });
    const pre = wrap.createSpan({ cls: "tj-wz-affix-pre", text: mode });
    const input = freeNumeric(
      wrap.createEl("input", {
        cls: "tj-wz-input",
        attr: { type: "number", value: String((pct !== undefined ? pct : dollars) ?? "") },
      })
    );

    const push = () => {
      const v = parseFloat(input.value) || 0;
      if (mode === "%") set(undefined, v);
      else set(v, undefined);
    };

    for (const m of ["$", "%"] as const) {
      const b = toggle.createEl("button", {
        cls: "tj-wz-unbtn" + (m === mode ? " on" : ""),
        text: m,
        attr: { type: "button", "aria-label": m === "$" ? "Amount in dollars" : "Amount in percent", "aria-pressed": String(m === mode) },
      });
      b.addEventListener("click", () => {
        if (mode === m) return;
        mode = m;
        pre.setText(mode);
        toggle.querySelectorAll(".tj-wz-unbtn").forEach((n) => n.classList.remove("on"));
        b.classList.add("on");
        push();
      });
    }
    input.addEventListener("input", push);
    return f;
  };

  // ------------------------------------------------------------------ steps
  const renderSteps = () => {
    steps.empty();
    STEPS.forEach((label, i) => {
      const onFlow = flow().includes(i);
      const s = steps.createDiv({
        cls: "tj-wz-step" + (i === step ? " on" : flow().indexOf(i) < flow().indexOf(step) ? " done" : "") + (onFlow ? "" : " off"),
      });
      s.createSpan({ cls: "tj-wz-step-n", text: flow().indexOf(i) < flow().indexOf(step) ? "✓" : String(i + 1) });
      s.createSpan({ cls: "tj-wz-step-l", text: label });
    });
  };

  const renderType = () => {
    const grid = body.createDiv({ cls: "tj-wz-types", attr: { "data-tour": "wizard-type" } });
    for (const t of CREATION_TYPES) {
      const card = grid.createDiv({ cls: "tj-wz-type" + (values.type === t.id ? " on" : ""), attr: { "data-tour": `wizard-type-${t.id}` } });
      const ico = card.createDiv({ cls: "tj-wz-type-ico", attr: { "aria-hidden": "true" } });
      setIcon(ico, t.icon);
      card.createDiv({ cls: "tj-wz-type-l", text: t.label });
      card.createDiv({ cls: "tj-wz-type-d", text: t.desc });
      card.addEventListener("click", () => {
        values.type = t.id;
        values.rules = {};
        if (isProp(t.id) && values.size > 0) applySizeRules(values.size);
        if (!isProp(t.id)) {
          values.logoId = "own";
          values.custom = false;
        } else if (values.logoId === "own") {
          values.logoId = "topstep";
        }
        renderStep();
      });
    }
  };

  /** The small visual inside a logo tile: packaged image, CSS symbol or initials. */
  const tileVisual = (host: HTMLElement, id: string, label: string) => {
    if (id === "own") {
      host.createSpan({ cls: "tj-wz-logo-own", text: "◆", attr: { "aria-hidden": "true" } });
      return;
    }
    const url = firmLogoUrl(id);
    if (url) {
      const img = host.createEl("img", { cls: "tj-wz-logotile-img", attr: { alt: label } });
      img.src = url;
      img.addEventListener("error", () => {
        img.remove();
        host.createSpan({ cls: "tj-wz-logotile-init", text: initialsFrom(label) });
      });
      return;
    }
    host.createSpan({ cls: "tj-wz-logotile-init", text: initialsFrom(label) });
  };

  /**
   * Step 2 — the brand alone. Name, balance and rules live one step later, so
   * picking the firm is one decision and nothing else competes for the eye.
   */
  const renderBrand = () => {
    const sect = body.createDiv({ cls: "tj-wz-sect" });
    sect.createDiv({ cls: "tj-wz-sectitle", text: "Brand" });

    // ---- logo grid ----
    const logoWrap = sect.createDiv({ cls: "tj-wz-field", attr: { "data-tour": "wizard-logo" } });
    const groups: Array<{ id: "prop" | "broker" | "practice"; title: string }> = [
      { id: "prop", title: "Prop firms" },
      { id: "broker", title: "Brokers" },
      { id: "practice", title: "Practice" },
    ];
    const grid = logoWrap.createDiv({ cls: "tj-wz-logogrid" });
    for (const g of groups) {
      const gWrap = grid.createDiv({ cls: "tj-wz-logogroup" });
      gWrap.createDiv({ cls: "tj-wz-logoglbl", text: g.title });
      const tiles = gWrap.createDiv({ cls: "tj-wz-logotiles" });
      for (const entry of FIRM_CATALOG.filter((f) => f.group === g.id)) {
        const on = !values.custom && values.logoId === entry.id;
        const tile = tiles.createDiv({ cls: "tj-wz-logotile" + (on ? " on" : ""), attr: { title: entry.label } });
        tileVisual(tile, entry.id, entry.label);
        tile.createSpan({ cls: "tj-wz-logotile-lbl", text: entry.label });
        tile.addEventListener("click", () => {
          values.logoId = entry.id;
          values.custom = false;
          renderStep();
        });
      }
    }
    // Custom initials tile.
    const customWrap = logoWrap.createDiv({ cls: "tj-wz-logocustom" });
    const customTile = customWrap.createDiv({ cls: "tj-wz-logotile" + (values.custom ? " on" : "") });
    customTile.createSpan({
      cls: "tj-wz-logotile-init",
      text: values.custom && values.initials ? values.initials.slice(0, 2).toUpperCase() : "AB",
    });
    customTile.createSpan({ cls: "tj-wz-logotile-lbl", text: "Custom" });
    customTile.addEventListener("click", () => {
      values.custom = true;
      renderStep();
    });
    if (values.custom) {
      const initF = customWrap.createDiv({ cls: "tj-wz-field" });
      initF.createEl("label", { text: "Initials", cls: "tj-wz-label" });
      const initInput = initF.createEl("input", {
        cls: "tj-wz-input",
        attr: { type: "text", maxlength: "2", placeholder: initialsFrom(values.name || baseName()), value: values.initials },
      });
      initInput.addEventListener("input", () => {
        values.initials = initInput.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 2);
        initInput.value = values.initials;
      });
      window.setTimeout(() => initInput.focus(), 0);
    }
  };

  /** Value of a target/max-loss field, preferring an explicit $ then a %. */
  const amountOf = (d: number | undefined, p: number | undefined, size: number): number | undefined => {
    if (d !== undefined) return d;
    if (p !== undefined) return Math.round((size * p) / 100);
    return undefined;
  };

  /**
   * Baseline rules the market publishes for a plain account size (6% target,
   * 4% max loss, 2% daily loss). A starting point only — the trader's numbers
   * always win. The same percentages apply to a custom size.
   */
  /** Seeds the rules for the chosen account TYPE. An eval has a target to reach;
   *  a funded account chases payouts, not a target; a live account is real money
   *  with a static floor. Personal and demo sit outside this entirely. */
  const applySizeRules = (size: number): void => {
    const type = values.type;
    values.rules.maxLoss = Math.round(size * 0.04);
    values.rules.maxLossPct = undefined;
    values.rules.dailyLoss = Math.round(size * 0.02);
    values.rules.maxLossType = type === "live" ? "static" : "eod-trailing";
    if (type === "eval") {
      values.rules.target = Math.round(size * 0.06);
      values.rules.targetPct = undefined;
    } else {
      values.rules.target = undefined;
      values.rules.targetPct = undefined;
    }
  };

  /** The plain sizes, plus a Custom… door for anything the list does not hold. */
  const SIZE_OPTIONS = ACCOUNT_SIZES.map((size) => ({
    id: String(size),
    label: `$${(size / 1000).toFixed(0)}K`,
  }));
  const sizeDropdownValue = () => (customSize || !values.size ? "" : String(values.size));

  const applySize = (id: string) => {
    if (id === "custom") {
      customSize = true;
      renderStep();
      return;
    }
    const size = parseInt(id, 10);
    if (!Number.isFinite(size) || size <= 0) return;
    customSize = false;
    values.size = size;
    if (isProp(values.type)) applySizeRules(size);
    if (!nameTouched) values.name = baseName();
    renderStep();
  };

  /** Step 3 — the account itself: size, name, start day, then the rules.
   *  Personal and demo stop after the identity, because no firm publishes rules.
   */
  const renderAccount = () => {
    const sizeSect = body.createDiv({ cls: "tj-wz-sect" });
    sizeSect.createDiv({ cls: "tj-wz-sectitle", text: "Account size" });
    const sizeF = sizeSect.createDiv({ cls: "tj-wz-field" });
    dropdown(
      sizeF,
      [...SIZE_OPTIONS, { id: "custom", label: "Custom…" }],
      sizeDropdownValue(),
      applySize,
      "wizard-size",
      customSize && values.size ? `Custom · $${(values.size / 1000).toFixed(0)}K` : "Choose a size"
    );
    if (customSize) {
      const wrap = sizeF.createDiv({ cls: "tj-wz-affix" });
      wrap.createSpan({ cls: "tj-wz-affix-pre", text: "$" });
      const sizeInput = freeNumeric(
        wrap.createEl("input", {
          cls: "tj-wz-input",
          attr: { type: "number", placeholder: "Account size", value: values.size ? String(values.size) : "" },
        })
      );
      const nameLive = () => {
        const nameEl = body.querySelector("input[data-tour='wizard-name']") as HTMLInputElement | null;
        if (nameEl && !nameTouched) nameEl.value = baseName();
      };
      sizeInput.addEventListener("input", () => {
        values.size = parseFloat(sizeInput.value) || 0;
        if (isProp(values.type)) applySizeRules(values.size);
        if (!nameTouched) values.name = baseName();
        nameLive();
      });
      // Re-render on leaving the field; re-rendering on every keystroke would
      // steal the caret, so the rules catch up when the trader is done typing.
      sizeInput.addEventListener("change", () => renderStep());
    }

    const basics = body.createDiv({ cls: "tj-wz-sect" });
    basics.createDiv({ cls: "tj-wz-sectitle", text: "Account" });
    const row = basics.createDiv({ cls: "tj-wz-row-2" });
    const nameF = row.createDiv({ cls: "tj-wz-field" });
    nameF.createEl("label", { text: "Account name", cls: "tj-wz-label" });
    const nameInput = nameF.createEl("input", {
      cls: "tj-wz-input",
      attr: { type: "text", placeholder: suggestedName(), value: nameTouched ? values.name : baseName(), "data-tour": "wizard-name" },
    });
    nameInput.addEventListener("input", () => {
      values.name = nameInput.value;
      nameTouched = nameInput.value.trim().length > 0;
      updateNext();
    });

    // When the account started. Mandatory: a trade dated before it is treated as
    // someone else's history, so the trader states the day out loud.
    const startF = row.createDiv({ cls: "tj-wz-field" });
    startF.createEl("label", { text: "Started on", cls: "tj-wz-label" });
    mountDateField(startF, {
      value: values.createdAt,
      format: plugin.settings.dateFormat,
      className: "tj-wz-dateinput",
      zone: plugin.settings.timeZone,
      onChange: (iso) => {
        values.createdAt = iso;
        updateNext();
      },
    });
    const hint = basics.createDiv({ cls: "tj-wz-secthint" });
    sizeHint = hint;

    if (!isProp(values.type)) return;

    const sect = body.createDiv({ cls: "tj-wz-sect" });
    sect.createDiv({ cls: "tj-wz-sectitle", text: "Rules" });
    sect.createDiv({
      cls: "tj-wz-secthint",
      text:
        values.type === "eval"
          ? "The numbers your firm needs to pass. Leave a field empty if the rule does not exist."
          : values.type === "funded"
            ? "The numbers your firm applies to payouts. Leave a field empty if the rule does not exist."
            : "The limits your account runs under. Leave a field empty if the rule does not exist.",
    });

    const grid = sect.createDiv({ cls: "tj-wz-rulegrid" });
    amountField(grid, "Profit target", values.rules.target, values.rules.targetPct, (d, p) => {
      values.rules.target = d;
      values.rules.targetPct = p;
    });
    amountField(grid, "Max loss", values.rules.maxLoss, values.rules.maxLossPct, (d, p) => {
      values.rules.maxLoss = d;
      values.rules.maxLossPct = p;
    });
    affixField(grid, "Daily loss limit (optional)", { prefix: "$" }, values.rules.dailyLoss ?? 0, (v) => (values.rules.dailyLoss = v || undefined));
    affixField(grid, "Consistency % (optional)", { suffix: "%" }, values.rules.consistency ?? 0, (v) => (values.rules.consistency = v || undefined));

    const ddF = grid.createDiv({ cls: "tj-wz-field" });
    ddF.createEl("label", { text: "Drawdown type", cls: "tj-wz-label" });
    dropdown(
      ddF,
      DD_TYPES,
      values.rules.maxLossType ?? "eod-trailing",
      (v) => {
        values.rules.maxLossType = v as AccountRules["maxLossType"];
        renderStep();
      },
      "wizard-dd"
    );

    if (values.rules.maxLossType !== "static" && values.rules.maxLossType !== "eod-trailing-open") {
      affixField(grid, "Locks above balance (optional)", { prefix: "$" }, values.rules.ddLockOffset ?? 0, (v) => (values.rules.ddLockOffset = v || undefined));
    }

    const posF = grid.createDiv({ cls: "tj-wz-field tj-wz-wide" });
    posF.createEl("label", { text: "Position size (optional)", cls: "tj-wz-label" });
    const posInput = posF.createEl("input", {
      cls: "tj-wz-input",
      attr: { type: "text", placeholder: "e.g. 5 mini / 50 micro", value: values.rules.posSize ?? "" },
    });
    posInput.addEventListener("input", () => (values.rules.posSize = posInput.value.trim() || undefined));

    affixField(
      grid,
      values.type === "funded" ? "Payout winning days (optional)" : "Minimum trading days (optional)",
      { suffix: "days" },
      values.rules.minDays ?? 0,
      (v) => (values.rules.minDays = v || undefined)
    );

    const disc = sect.createDiv({ cls: "tj-wz-disclaimer" });
    const discIco = disc.createSpan({ cls: "tj-wz-disclaimer-ico", attr: { "aria-hidden": "true" } });
    setIcon(discIco, "alert-triangle");
    disc.createSpan({
      text: "Prop firms change their rules often — double-check the numbers before saving. Nothing here is enforced; the journal only reports against them.",
    });
  };

  const renderReview = () => {
    const box = body.createDiv({ cls: "tj-wz-review", attr: { "data-tour": "wizard-review" } });

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

    const size = values.size;
    const accLine = card(TYPE_CATALOG.find((t) => t.id === values.type)?.label ?? values.type);
    accLine("Logo", values.custom ? `Initials (${(values.initials || initialsFrom(values.name || baseName())).toUpperCase()})` : firmLabel(values.logoId) ?? values.logoId);
    accLine(isProp(values.type) ? "Initial balance" : "Starting balance", `$${size.toLocaleString()}`);
    if (isProp(values.type)) {
      const t = amountOf(values.rules.target, values.rules.targetPct, values.size);
      const m = amountOf(values.rules.maxLoss, values.rules.maxLossPct, values.size);
      accLine("Profit target", t ? `$${t.toLocaleString()}` : "—");
      accLine("Max loss", m ? `-$${m.toLocaleString()}` : "—");
      accLine("Daily loss", values.rules.dailyLoss ? `-$${values.rules.dailyLoss.toLocaleString()}` : "None");
      accLine("Consistency", values.rules.consistency ? `${values.rules.consistency}%` : "None");
      accLine("Drawdown", DD_TYPES.find((d) => d.id === (values.rules.maxLossType ?? "eod-trailing"))?.label ?? "End-of-day trailing");
    }
    const bulkNames = namesFor(createCount);
    accLine("Name", createCount > 1 ? `${bulkNames[0]} + ${createCount - 1} more` : values.name || suggestedName());
    if (values.createdAt) accLine("Started on", formatDate(values.createdAt, plugin.settings.dateFormat));

    const many = box.createDiv({ cls: "tj-wz-many" });
    const manyHead = many.createDiv({ cls: "tj-wz-many-head" });
    manyHead.createSpan({ cls: "tj-wz-many-lbl", text: "How many accounts" });
    const namesEl = many.createDiv({ cls: "tj-wz-many-names" });

    const drawMany = () => {
      namesEl.empty();
      next.setText(createCount > 1 ? `Create ${createCount} accounts` : "Create account");
      if (createCount < 2) return;
      namesEl.createDiv({ cls: "tj-wz-many-note", text: "Same size, rules and start date — only the name changes:" });
      for (const n of namesFor(createCount)) namesEl.createDiv({ cls: "tj-wz-many-name", text: n });
    };

    const stepper = manyHead.createDiv({ cls: "tj-wz-stepper" });
    const dec = stepper.createEl("button", { cls: "tj-wz-stepper-btn", text: "−", attr: { type: "button", "aria-label": "One fewer" } });
    const val = stepper.createSpan({ cls: "tj-wz-stepper-val", text: String(createCount) });
    const inc = stepper.createEl("button", { cls: "tj-wz-stepper-btn", text: "+", attr: { type: "button", "aria-label": "One more" } });
    const bump = (d: number) => {
      createCount = Math.min(MAX_BULK, Math.max(1, createCount + d));
      val.setText(String(createCount));
      drawMany();
    };
    dec.addEventListener("click", () => bump(-1));
    inc.addEventListener("click", () => bump(1));
    drawMany();
  };

  /**
   * Whether the wizard can move on. Step 3 needs both a size and a start date:
   * a trade dated before the start day is treated as someone else's history, so
   * an account without a day would silently hide its own trades.
   */
  const updateNext = () => {
    if (step !== 2) {
      next.disabled = false;
      return;
    }
    const hasSize = values.size > 0;
    const hasDate = !!values.createdAt;
    const ready = hasSize && hasDate;
    next.disabled = !ready;
    if (sizeHint) {
      sizeHint.textContent = !hasSize && !hasDate
        ? "Choose a size and a start date to continue."
        : !hasSize
          ? "Choose a size to continue."
          : "Choose a start date to continue.";
      sizeHint.style.display = ready ? "none" : "";
    }
  };

  const renderStep = () => {
    body.empty();
    sizeHint = null;
    renderSteps();
    if (step === 0) renderType();
    else if (step === 1) renderBrand();
    else if (step === 2) renderAccount();
    else renderReview();

    back.style.visibility = step === 0 ? "hidden" : "visible";
    next.setText(step !== 3 ? "Next" : createCount > 1 ? `Create ${createCount} accounts` : "Create account");
    another.style.display = step === 3 ? "inline-flex" : "none";
    updateNext();
    opts.onStep?.(step);
  };

  const cleanRules = (r: AccountRules): AccountRules => {
    const out: AccountRules = {};
    if (r.target !== undefined && r.target !== 0) out.target = r.target;
    if (r.targetPct !== undefined && r.targetPct !== 0) out.targetPct = r.targetPct;
    if (r.maxLoss !== undefined && r.maxLoss !== 0) out.maxLoss = r.maxLoss;
    if (r.maxLossPct !== undefined && r.maxLossPct !== 0) out.maxLossPct = r.maxLossPct;
    if (r.dailyLoss) out.dailyLoss = r.dailyLoss;
    if (r.consistency) out.consistency = r.consistency;
    if (r.consistencyBasis) out.consistencyBasis = r.consistencyBasis;
    if (r.maxLossType) out.maxLossType = r.maxLossType;
    if (r.ddLockOffset) out.ddLockOffset = r.ddLockOffset;
    if (r.minDays) out.minDays = r.minDays;
    if (r.posSize) out.posSize = r.posSize;
    if (r.dailyLossNote) out.dailyLossNote = r.dailyLossNote;
    return out;
  };

  /**
   * One account from the current values. Every field but the name is shared,
   * which is the entire point of a batch.
   */
  const build = (name: string): PropAccount => {
    const taken = (plugin.settings.propAccounts || []).map((a) => a.name);
    const acc: PropAccount = {
      id: "pa_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: uniqueAccountName((name || "").trim() || baseName(), taken),
      firmId: values.logoId || "own",
      programId: values.type,
      size: values.size,
      type: values.type,
      createdAt: values.createdAt,
    };
    if (isProp(values.type)) {
      const r = cleanRules(values.rules);
      if (Object.keys(r).length) acc.rules = r;
    }
    const initials = (values.initials || initialsFrom(acc.name)).toUpperCase().slice(0, 2);
    acc.branding = values.custom ? { kind: "initials", initials } : { kind: "packaged", id: values.logoId };
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

    void plugin.saveSettings().then(() => plugin.reloadAllViews());
    opts.onDone?.(acc, another);

    if (another) {
      values.name = "";
      nameTouched = false;
      values.size = 0;
      values.createdAt = "";
      values.rules = {};
      customSize = false;
      createCount = 1;
      step = 0;
      renderStep();
    } else {
      close();
    }
  };

  back.addEventListener("click", () => {
    const f = flow();
    const idx = f.indexOf(step);
    if (idx > 0) {
      step = f[idx - 1];
      renderStep();
    }
  });
  next.addEventListener("click", () => {
    const f = flow();
    const idx = f.indexOf(step);
    if (idx < f.length - 1) {
      step = f[idx + 1];
      renderStep();
    } else {
      create(createCount, false);
    }
  });

  const another = foot.createEl("button", { text: "Create & add another", cls: "tj-btn", attr: { type: "button" } });
  another.addEventListener("click", () => create(createCount, true));
  another.style.display = "none";

  renderStep();
  opts.onOpen?.(root);

  return { close };
}
