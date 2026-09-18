import { ItemView, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { CopyConfigEntry, CopyPeriod, PropAccount, Trade } from "../types";
import { openPayoutsModal } from "./payoutModal";
import { effectiveSize, getFirm, getProgram, getSize, uniqueAccountName } from "../props";
import { attachTooltip, kpiCard, openPluginSettings as openSettings, renderAppShell } from "../ui";
import { fmtMoney, fmtMoneyCompact, isFiniteNumber, todayKey, toZoneDate } from "../tz";
import { closeCopyPeriods, openCopyPeriod, todayIso } from "../lib/copy";
import { renderLineChart } from "../lib/lineChart";
import { formatDate, mountDateField } from "../lib/dates";
import { computeAccountMetrics, computeDrawdownEpisodes } from "../lib/accountMetrics";
import { sessionLabel, sessionRank } from "../lib/sessions";
import { renderTradeTable, resolveOrder } from "../lib/tradeTable";
import { attachTip } from "../lib/tip";
import { killTip, moveTip, showTip } from "../lib/tip";

export const ACCOUNT_DASH_VIEW_TYPE = "tradebook-account-dash-view";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Columns an account's own ledger shows — the Trade Log adds account, prints and review. */
const ACCOUNT_TABLE_COLUMNS = ["date", "symbol", "side", "qty", "entryexit", "hold", "r", "pnl", "setup"];

export class AccountDashboardView extends ItemView {
  plugin: TradebookPlugin;
  accountId: string | null = null;
  trades: Trade[] = [];

  constructor(leaf: any, plugin: TradebookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return ACCOUNT_DASH_VIEW_TYPE;
  }

  getDisplayText(): string {
    const acc = this.account();
    return acc ? `Accounts — ${acc.name}` : "Accounts";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  getState(): any {
    return { accountId: this.accountId };
  }

  async setState(state: any, result: any): Promise<void> {
    this.accountId = typeof state?.accountId === "string" ? state.accountId : null;
    await this.refresh();
  }

  async onOpen(): Promise<void> {
    this.trades = await this.plugin.loadTradesExpanded();
    this.render();
  }

  async onClose(): Promise<void> {}

  account() {
    const accounts = this.plugin.settings.propAccounts || [];
    // When an explicit account is requested, never silently show a different one.
    if (this.accountId) return accounts.find((a) => a.id === this.accountId);
    return accounts.find((a) => a.id === this.plugin.getPrimaryAccount()?.id) ?? accounts[0];
  }

  /** Dropdown to switch between configured accounts. */
  accountPicker(parent: HTMLElement, acc: { id: string; name: string; size: number; type: string }): void {
    const accounts = this.plugin.settings.propAccounts || [];
    const sel = parent.createEl("select", { cls: "dropdown tj-account-picker" });
    sel.setAttr("aria-label", "Switch account");
    for (const a of accounts) {
      const opt = sel.createEl("option", { value: a.id, text: `${a.name} · $${(a.size / 1000).toFixed(0)}K` });
      if (a.id === acc.id) opt.setAttr("selected", "selected");
    }
    sel.value = acc.id;
    sel.addEventListener("change", () => {
      this.accountId = sel.value;
      this.render();
    });
  }

  scoped(): Trade[] {
    const acc = this.account();
    if (!acc) return [];
    return this.trades
      .filter((t) => {
        if (!isFiniteNumber(t.pnl) || !t.date) return false;
        const mapped = this.plugin.mappedAccount(t.account);
        const matches = mapped ? mapped.id === acc.id : (t.account || "").trim().toLowerCase() === (acc.name || "").trim().toLowerCase();
        if (!matches) return false;
        // Never count trades dated before the account was created.
        if (acc.createdAt && t.date < acc.createdAt) return false;
        return true;
      })
      .sort((a, b) => {
        const ka = this.dayKey(a);
        const kb = this.dayKey(b);
        return ka.localeCompare(kb) || (a.id || "").localeCompare(b.id || "");
      });
  }

  dayKey(t: Trade): string {
    return toZoneDate(t.date, t.entryTime, this.plugin.settings.timeZone);
  }

  todayKey(): string {
    return todayKey(this.plugin.settings.timeZone);
  }

  async refresh(): Promise<void> {
    this.trades = await this.plugin.loadTradesExpanded();
    this.render();
  }

  /** Open the plugin's own Settings tab (not the general Obsidian settings). */
  openPluginSettings(): void {
    try {
      openSettings(this.app, this.plugin, "accounts");
      (this.app as any)?.setting?.open?.();
    } catch (err) {
      console.error("[tradebook] could not open settings:", err);
    }
  }

  /** Open the account settings modal — tabbed (General / Rules / Copy / Danger). */
  /**
   * The account's copy memory, on one line under the title: who it mirrors (or
   * who mirrors it), at what ratio, and every stretch it went through. Periods
   * are the reason changing a leader never rewrites older trades — so they are
   * worth showing instead of hiding under a settings tab.
   */
  private renderCopyBar(host: HTMLElement, acc: PropAccount): void {
    const accounts = this.plugin.settings.propAccounts ?? [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const copiers = accounts.filter((a) => a.id !== acc.id && a.copyBaseId === acc.id);
    if (!acc.copyRole && !copiers.length) return;

    const periods = [...(acc.copyPeriods ?? [])].sort((a, b) => String(a.start ?? "").localeCompare(String(b.start ?? "")));
    const openPeriod = periods.find((p) => !p.end);
    const leader = acc.copyBaseId ? byId.get(acc.copyBaseId) : undefined;

    const bar = host.createDiv({ cls: "tj-acc-copybar" });
    bar.createDiv({ cls: "tj-acc-k", text: "Trading group" });
    const chip = bar.createDiv({ cls: "tj-acc-copychip" });
    if (acc.copyRole === "copier") {
      chip.addClass("is-copier");
      const mult = openPeriod?.multiplier ?? acc.copyMultiplier ?? 1;
      const from = openPeriod?.start;
      // Short on purpose: the chip reads like the tag on the account cards. The
      // leader (and when it started) lives in the tooltip.
      chip.createSpan({ cls: "tj-acc-copychip-t", text: `Copier ×${mult}` });
      chip.setAttr(
        "title",
        `Copies ${leader?.name ?? "an unknown account"}${from ? ` · since ${from === "0000-01-01" ? "the beginning" : formatDate(from)}` : ""}`,
      );
    } else {
      chip.addClass("is-leader");
      chip.createSpan({ cls: "tj-acc-copychip-t", text: "👑 Leader" });
      if (copiers.length) {
        chip.createSpan({
          cls: "tj-acc-copychip-sub",
          text: `${copiers.length} copier${copiers.length === 1 ? "" : "s"}`,
        });
        attachTip(chip, { title: "Leader", sub: `mirrored by ${copiers.map((c) => c.name).join(", ")}` });
      }
    }

    if (periods.length > 1 || (periods.length === 1 && periods[0].baseId)) {
      const hist = host.createDiv({ cls: "tj-acc-copyhist" });
      hist.createDiv({ cls: "tj-acc-k", text: "Copy history" });
      const list = hist.createDiv({ cls: "tj-acc-copyrows" });
      for (const p of periods.slice(-4)) {
        const who = (p.baseId ? byId.get(p.baseId)?.name : undefined) ?? "—";
        const from = p.start && p.start !== "0000-01-01" ? formatDate(p.start) : "all history";
        list.createDiv({
          cls: "tj-acc-copyrow",
          text: `${who} · ${p.multiplier ?? acc.copyMultiplier ?? 1}x · ${from} → ${p.end ? formatDate(p.end) : "now"}`,
        });
      }
    }
  }

  openEditAccountModal(acc: any, size: any, net: number): void {
    const firm = getFirm(acc.firmId);
    const program = getProgram(firm, acc.programId);
    const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    const autoName = (sz: number) => `${firm?.name ?? ""} · ${program?.label ?? ""} · $${(sz / 1000).toFixed(0)}K`;
    const initials = (n: string) =>
      (n || "?")
        .replace(/[^a-zA-Z0-9 ]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join("") || "?";

    const overlay = document.body.createDiv({ cls: "tj-modal-overlay" });
    const modal = overlay.createDiv({ cls: "tj-modal tj-acc-settings" });

    // ---- Header ----
    const head = modal.createDiv({ cls: "tj-as-head" });
    const avatar = head.createDiv({ cls: "tj-as-avatar" });
    const logoUrl = this.plugin.firmLogoUrl(acc.firmId);
    if (logoUrl) {
      const img = avatar.createEl("img", { cls: "tj-as-avatar-img", attr: { alt: firm?.name ?? "" } });
      img.src = logoUrl;
      img.addEventListener("error", () => { img.remove(); avatar.setText(initials(acc.name)); });
    } else {
      avatar.setText(initials(acc.name));
    }
    const headText = head.createDiv({ cls: "tj-as-headtext" });
    const headTitle = headText.createEl("h3", { text: acc.name });
    headText.createDiv({ cls: "tj-as-meta", text: [firm?.name, program?.label, typeLabel(acc.type)].filter(Boolean).join(" · ") });
    const closeAs = head.createEl("button", { cls: "tj-as-close", text: "\u2715", attr: { type: "button", "aria-label": "Close" } });
    attachTip(closeAs, { title: "Close" });
    closeAs.addEventListener("click", () => overlay.remove());

    // ---- Tabs ----
    const tabs = modal.createDiv({ cls: "tj-as-tabs" });
    const panes = modal.createDiv({ cls: "tj-as-panes" });
    const tabDefs: Array<{ id: string; label: string; dng?: boolean }> = [
      { id: "general", label: "General" },
      { id: "rules", label: "Rules" },
      { id: "copy", label: "Copy trading" },
      { id: "danger", label: "Deletion", dng: true },
    ];
    const paneEls: Record<string, HTMLElement> = {};
    let activeTab = "general";
    const showTab = (id: string) => {
      activeTab = id;
      for (const p of tabDefs) {
        paneEls[p.id].style.display = p.id === id ? "" : "none";
        tabBtns[p.id].toggleClass("is-active", p.id === id);
      }
      modal.toggleClass("is-danger-tab", id === "danger");
    };
    const tabBtns: Record<string, HTMLElement> = {};
    for (const t of tabDefs) {
      const b = tabs.createEl("button", { cls: "tj-as-tab" + (t.dng ? " tj-as-tab-dng" : ""), text: t.label, attr: { type: "button" } });
      b.addEventListener("click", () => showTab(t.id));
      tabBtns[t.id] = b;
      paneEls[t.id] = panes.createDiv({ cls: "tj-as-pane" });
    }

    // ======== Rows + drawers (shared across all tabs) ========
    const mkRow = (host: HTMLElement, label: string): HTMLElement => {
      const row = host.createDiv({ cls: "tj-as-row" });
      row.createSpan({ cls: "tj-as-rowlabel", text: label });
      return row.createSpan({ cls: "tj-as-rowval" });
    };
    type Drawer = { drawer: HTMLElement; btn: HTMLElement; setCurrent: (t: string) => void };
    let drawers: Drawer[] = [];
    const closeAllDrawers = () => {
      drawers.forEach((d) => { d.drawer.removeClass("open"); d.btn.removeClass("open"); });
      drawers = drawers.filter((d) => d.drawer.isConnected);
    };
    const makeDrawer = (
      host: HTMLElement,
      label: string,
      opts: Array<{ text: string; title?: string; selected?: boolean }>,
      onSelect: (idx: number) => void
    ): Drawer => {
      let currentIdx = Math.max(0, opts.findIndex((o) => o.selected));
      const val = mkRow(host, label);
      const drawer = val.createSpan({ cls: "tj-as-drawer" });
      const btn = val.createEl("button", { cls: "tj-as-valbtn", attr: { type: "button" } });
      btn.createSpan({ cls: "tj-as-chev", text: "\u2039" });
      const cur = btn.createSpan({ cls: "tj-as-cur" });
      const api: Drawer = { drawer, btn, setCurrent: (t) => cur.setText(t) };
      const renderOpts = () => {
        drawer.empty();
        cur.setText(opts[currentIdx]?.text ?? "\u2014");
        opts.forEach((o, i) => {
          if (i === currentIdx) return; // the selected one is the anchor, not repeated
          const el = drawer.createEl("button", { cls: "tj-as-opt", text: o.text, attr: { type: "button" } });
          if (o.title) attachTip(el, { title: o.text, sub: o.title });
          el.addEventListener("click", () => {
            currentIdx = i;
            renderOpts();
            closeAllDrawers();
            onSelect(i);
          });
        });
      };
      renderOpts();
      btn.addEventListener("click", () => {
        const wasOpen = drawer.hasClass("open");
        closeAllDrawers();
        if (!wasOpen) { drawer.addClass("open"); btn.addClass("open"); }
      });
      drawers.push(api);
      return api;
    };

    /** Vertical list picker — scales to any number of options (e.g. 30 accounts). */
    const makeListPicker = (
      host: HTMLElement,
      label: string,
      opts: Array<{ text: string; selected?: boolean }>,
      onSelect: (idx: number) => void
    ) => {
      let currentIdx = Math.max(0, opts.findIndex((o) => o.selected));
      const val = mkRow(host, label);
      const btn = val.createEl("button", { cls: "tj-as-valbtn", attr: { type: "button" } });
      btn.createSpan({ cls: "tj-as-chev", text: "\u2039" });
      const cur = btn.createSpan({ cls: "tj-as-cur" });
      const panel = host.createDiv({ cls: "tj-as-listpanel" });
      const renderList = () => {
        cur.setText(opts[currentIdx]?.text ?? "\u2014");
        panel.empty();
        opts.forEach((o, i) => {
          if (i === currentIdx) return;
          const el = panel.createEl("button", { cls: "tj-as-lopt", text: o.text, attr: { type: "button" } });
          el.addEventListener("click", () => {
            currentIdx = i;
            renderList();
            panel.removeClass("open");
            btn.removeClass("open");
            onSelect(i);
          });
        });
      };
      renderList();
      btn.addEventListener("click", () => {
        const wasOpen = panel.hasClass("open");
        panel.toggleClass("open", !wasOpen);
        btn.toggleClass("open", !wasOpen);
      });
      return { refresh: renderList };
    };

    // ======== GENERAL ========
    const gen = paneEls.general;
    const nameInput = mkRow(gen, "Account name").createEl("input", { type: "text", cls: "tj-as-nameinput" });
    nameInput.value = acc.name;

    const startedVal = mkRow(gen, "Started on");
    // Same date field as everywhere else, so this one follows the Date format
    // chosen in Settings too (a native input shows the operating system's).
    let startedValue = acc.createdAt ?? "";
    mountDateField(startedVal, {
      value: startedValue,
      format: this.plugin.settings.dateFormat,
      className: "tj-as-nameinput",
      onChange: (iso) => (startedValue = iso),
    });

    let selectedSize = acc.size;
    const offered = (program?.sizes ?? []).map((s: any) => s.size);
    const allSizes = Array.from(new Set([...offered, acc.size])).sort((a, b) => a - b);
    makeDrawer(
      gen,
      "Account size",
      allSizes.map((sz) => ({
        text: `$${(sz / 1000).toFixed(0)}K`,
        title: (program?.sizes ?? []).find((s: any) => s.size === sz)?.price ?? "",
        selected: sz === acc.size,
      })),
      (i) => {
        selectedSize = allSizes[i];
        if (nameIsAuto) {
          nameInput.value = autoName(selectedSize);
          headTitle.setText(autoName(selectedSize));
        }
      }
    );

    const ACCOUNT_TYPES = ["eval", "funded", "live", "personal", "demo"] as const;
    let selectedType: string = acc.type;
    makeDrawer(
      gen,
      "Account type",
      ACCOUNT_TYPES.map((t) => ({ text: typeLabel(t), selected: t === acc.type })),
      (i) => { selectedType = ACCOUNT_TYPES[i]; }
    );

    const genHint = gen.createDiv({ cls: "tj-as-hint", text: "" });
    const setHint = () => genHint.setText(nameIsAuto ? "Name is auto-generated \u2014 edit it to set a custom name." : "Custom name \u2014 size changes won't overwrite it.");

    // Name auto-follow logic
    const wasAuto = acc.name === autoName(acc.size) || !acc.name;
    if (wasAuto) nameInput.value = autoName(acc.size);
    let nameIsAuto = wasAuto;
    setHint();
    nameInput.addEventListener("input", () => {
      nameIsAuto = false;
      setHint();
      headTitle.setText(nameInput.value || acc.name);
    });

    // ======== RULES ========
    const rulesPane = paneEls.rules;
    rulesPane.createDiv({ cls: "tj-as-section", text: "Rule overrides" });
    rulesPane.createDiv({ cls: "tj-as-hint", text: "Leave off to use the firm's defaults. Turn on to override a specific account." });
    // Firm defaults (without this account's overrides) for the Rules tab.
    const firmDefault = program ? getSize(program, acc.size) : null;
    const ruleDefs: Array<{ key: string; label: string; hint: string; def: any; type: string }> = [
      { key: "target", label: "Profit target ($)", hint: "Firm default", def: firmDefault?.target, type: "number" },
      { key: "maxLoss", label: "Max loss ($)", hint: "Firm default", def: firmDefault?.maxLoss, type: "number" },
      { key: "dailyLoss", label: "Daily loss ($)", hint: "Firm default", def: firmDefault?.dailyLoss, type: "number" },
      { key: "consistency", label: "Consistency (%)", hint: "Firm default", def: firmDefault?.consistency, type: "number" },
      { key: "posSize", label: "Position size", hint: "Firm default", def: firmDefault?.posSize, type: "text" },
    ];
    const ruleInputs: Record<string, HTMLInputElement> = {};
    const ruleToggles: Record<string, boolean> = {};
    for (const r of ruleDefs) {
      const isOn = acc.rules?.[r.key] !== undefined;
      ruleToggles[r.key] = isOn;
      const row = rulesPane.createDiv({ cls: "tj-as-ov" });
      const sw = row.createDiv({ cls: "tj-as-sw" + (isOn ? " on" : "") });
      const meta = row.createDiv({ cls: "tj-as-ovmeta" });
      meta.createDiv({ cls: "tj-as-ovlabel", text: r.label });
      const sub = meta.createDiv({ cls: "tj-as-ovsub" });
      const inp = document.createElement("input");
      inp.type = r.type;
      inp.className = "tj-as-ovinput";
      inp.value = String(acc.rules?.[r.key] ?? r.def ?? "");
      inp.disabled = !isOn;
      ruleInputs[r.key] = inp;
      const showDefault = () => {
        sub.setText(inp.disabled ? `Using firm default: ${r.def ?? "—"}` : "Overriding the firm default");
      };
      showDefault();
      const toggle = () => {
        ruleToggles[r.key] = !ruleToggles[r.key];
        sw.toggleClass("on", ruleToggles[r.key]);
        inp.disabled = !ruleToggles[r.key];
        if (ruleToggles[r.key] && !inp.value) inp.value = String(r.def ?? "");
        showDefault();
      };
      sw.addEventListener("click", toggle);
      row.appendChild(inp);
    }

    // How the limits move, in one line: the mechanism matters more than the number.
    if (firmDefault && firmDefault.maxLoss > 0) {
      const ddText =
        firmDefault.maxLossType === "eod-trailing-open"
          ? "Drawdown trails your highest end-of-day balance and never locks — it keeps rising with your best close."
          : firmDefault.maxLossType === "static"
            ? "Drawdown is fixed: it does not trail your balance."
            : `Drawdown trails your highest end-of-day balance and locks ${
                firmDefault.ddLockOffset ? `${fmtMoney(firmDefault.ddLockOffset)} above your starting balance` : "at your starting balance"
              }.`;
      rulesPane.createDiv({ cls: "tj-as-hint", text: ddText + (firmDefault.dailyLossNote ? ` ${firmDefault.dailyLossNote}` : "") });
    }

    // ======== COPY TRADING ========
    const copyPane = paneEls.copy;
    let role: "none" | "base" | "copier" = acc.copyRole === "base" ? "base" : acc.copyRole === "copier" ? "copier" : "none";
    let selectedBaseId = acc.copyBaseId ?? "";
    let selectedMultiplier = acc.copyMultiplier ?? 1;
    const openPeriod = (acc.copyPeriods ?? []).find((p: CopyPeriod) => !p.end);
    const openStart = openPeriod?.start ?? "";
    let copyAllHistory = openStart === "0000-01-01";
    let copyStart = openStart && openStart !== "0000-01-01" ? openStart : todayIso();

    /** Trade counts per account, so the leader picker shows what each one holds. */
    const accountCounts = new Map<string, number>();
    const subText = (c: PropAccount): string => {
      const n = accountCounts.get(c.id);
      const head = `$${Math.round(c.size / 1000)}K · ${n === undefined ? "…" : `${n} trade${n === 1 ? "" : "s"}`}`;
      return c.copyRole === "base" ? `${head} · 👑 Leader` : head;
    };
    const ROLE_DEFS: Array<{ id: "none" | "base" | "copier"; t: string; d: string }> = [
      { id: "none", t: "Not in a group", d: "No copy link" },
      { id: "base", t: "👑 Leader", d: "Others copy me" },
      { id: "copier", t: "Copier", d: "I copy a leader" },
    ];
    // Flat segment, exactly like the Add account wizard: one control language in
    // both places, so the copy story reads the same wherever you meet it.
    const rolesWrap = copyPane.createDiv({ cls: "tj-wz-seg" });
    const roleEls: Record<string, HTMLElement> = {};
    const syncRoles = () => ROLE_DEFS.forEach((r) => roleEls[r.id].toggleClass("on", r.id === role));
    for (const r of ROLE_DEFS) {
      const el = rolesWrap.createDiv({ cls: "tj-wz-seg-opt", text: r.t });
      if (r.d) attachTip(el, { title: r.t, sub: r.d });
      el.addEventListener("click", () => { role = r.id; syncRoles(); renderCopyDetail(); });
      roleEls[r.id] = el;
    }
    const detailHost = copyPane.createDiv({ cls: "tj-as-copydetail" });
    /** Fill every `[data-count]` span once the trade list is available. */
    const refreshCounts = () => {
      void this.plugin.loadTradesExpanded().then((trades) => {
        if (!detailHost.isConnected) return;
        accountCounts.clear();
        for (const t of trades) {
          const a = this.plugin.mappedAccount(t.account);
          if (a) accountCounts.set(a.id, (accountCounts.get(a.id) ?? 0) + 1);
        }
        detailHost.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
          const c = (this.plugin.settings.propAccounts || []).find((x: PropAccount) => x.id === el.dataset.count);
          if (c) el.setText(subText(c));
        });
      });
    };

    const renderCopyDetail = () => {
      detailHost.empty();
      const accounts: PropAccount[] = this.plugin.settings.propAccounts || [];

      if (role === "copier") {
        const others = accounts.filter((a) => a.id !== acc.id);
        // Same reading order as the Add account wizard: leaders first, then the
        // accounts that stand alone, then the ones already taken — shown greyed
        // instead of hidden, so the whole picture stays on screen.
        const leaders = others.filter((a) => a.copyRole === "base");
        const standalone = others.filter((a) => a.copyRole !== "base" && a.copyRole !== "copier");
        const taken = others.filter((a) => a.copyRole === "copier");
        const nameOf = (id?: string) => accounts.find((a) => a.id === id)?.name ?? "another account";

        detailHost.createDiv({ cls: "tj-as-section", text: "Leader account" });
        if (!leaders.length && !standalone.length && !taken.length) {
          detailHost.createDiv({ cls: "tj-as-hint", text: "No account can lead yet — create another account first." });
        } else {
          const list = detailHost.createDiv({ cls: "tj-wz-leader-list" });
          const group = (title: string | null, rows: PropAccount[], isTaken: boolean) => {
            if (!rows.length) return;
            if (title) list.createDiv({ cls: "tj-wz-listsep", text: title });
            for (const c of rows) {
              const row = list.createDiv({
                cls: "tj-wz-leader" + (isTaken ? " is-taken" : c.id === selectedBaseId ? " on" : ""),
              });
              row.createDiv({ cls: "tj-wz-leader-dot" });
              const body = row.createDiv({ cls: "tj-wz-leader-body" });
              body.createDiv({ cls: "tj-wz-leader-nm", text: c.name });
              const sub = body.createDiv({
                cls: "tj-wz-leader-sub",
                text: isTaken ? `already copies ${nameOf(c.copyBaseId)}` : subText(c),
              });
              if (isTaken) {
                attachTip(row, { title: "Already in a group", sub: "Unlink it there first — a copier cannot lead another group." });
                continue;
              }
              sub.dataset.count = c.id;
              row.addEventListener("click", () => {
                selectedBaseId = c.id;
                list.querySelectorAll(".tj-wz-leader").forEach((el) => el.removeClass("on"));
                row.addClass("on");
              });
            }
          };
          group(leaders.length ? "Leaders" : null, leaders, false);
          group(leaders.length && standalone.length ? "Not in a group" : null, standalone, false);
          group("Already in a group", taken, true);
        }

        const mulVal = mkRow(detailHost, "Multiplier");
        const mulInp = mulVal.createEl("input", { type: "number", cls: "tj-as-nameinput", attr: { step: "0.1", min: "0.1" } });
        mulInp.value = String(selectedMultiplier);
        mulInp.addEventListener("input", () => { selectedMultiplier = Math.max(0.1, parseFloat(mulInp.value) || 1); });

        const fromVal = mkRow(detailHost, "Copy from");
        const seg = fromVal.createDiv({ cls: "tj-wz-seg" });
        const optAll = seg.createDiv({ cls: "tj-wz-seg-opt" + (copyAllHistory ? " on" : ""), text: "All history" });
        const optDate = seg.createDiv({ cls: "tj-wz-seg-opt" + (copyAllHistory ? "" : " on"), text: "From a date" });
        optAll.addEventListener("click", () => { copyAllHistory = true; renderCopyDetail(); });
        optDate.addEventListener("click", () => { copyAllHistory = false; renderCopyDetail(); });
        if (!copyAllHistory) {
          // The date lives on its own row: squeezed next to the segment it was
          // clipped and it was hard to tell what it belonged to.
          const dateVal = mkRow(detailHost, "Start date");
          mountDateField(dateVal, {
            value: copyStart,
            format: this.plugin.settings.dateFormat,
            onChange: (iso) => {
              if (iso) copyStart = iso;
            },
          });
        }

        detailHost.createDiv({
          cls: "tj-as-hint",
          text: copyAllHistory
            ? "The leader's whole past is mirrored into this account, plus every new trade from now on."
            : `Only trades dated ${copyStart} or later are mirrored. Anything already in this account stays untouched.`,
        });

        const warn = detailHost.createDiv({ cls: "tj-as-copy-warn", text: "Checking what this account already holds…" });
        void this.plugin.loadTradesExpanded().then((trades) => {
          if (!warn.isConnected) return;
          const mine = trades.filter((t) => this.plugin.mappedAccount(t.account)?.id === acc.id);
          if (!mine.length) { warn.remove(); return; }
          warn.setText(`${mine.length} trade${mine.length === 1 ? "" : "s"} already in this account stay exactly as they are — the link only adds trades from the leader.`);
        });

        const periods = (acc.copyPeriods ?? []).slice().sort((a: CopyPeriod, b: CopyPeriod) => (a.start ?? "").localeCompare(b.start ?? ""));
        if (periods.length) {
          detailHost.createDiv({ cls: "tj-as-section", text: "Copy history" });
          const hist = detailHost.createDiv({ cls: "tj-as-periods" });
          for (const p of periods) {
            const lead = accounts.find((a) => a.id === p.baseId);
            const who = p.baseId ? (lead?.name ?? "removed account") : "—";
            const from = !p.start || p.start === "0000-01-01" ? "all history" : formatDate(p.start);
            hist.createDiv({ cls: "tj-as-period", text: `${who} · ${p.multiplier ?? 1}x · ${from} → ${p.end ? formatDate(p.end) : "now"}` });
          }
          detailHost.createDiv({ cls: "tj-as-hint", text: "Each stretch keeps its own leader, so changing leaders never rewrites numbers you already have." });
        }
      } else if (role === "base") {
        const copiers = accounts.filter((a) => a.copyBaseId === acc.id && a.copyRole === "copier");
        detailHost.createDiv({ cls: "tj-as-section", text: "Copiers" });
        if (copiers.length) {
          for (const c of copiers) {
            const stillOpen = (c.copyPeriods ?? []).some((p) => !p.end);
            const val = mkRow(detailHost, c.name);
            val.createSpan({ cls: "tj-as-cur", text: `${c.copyMultiplier ?? 1}x${stillOpen ? "" : " · paused"}` });
          }
        } else {
          detailHost.createDiv({ cls: "tj-as-hint", text: "No accounts copy from this one yet." });
        }
      } else {
        detailHost.createDiv({ cls: "tj-as-hint", text: "This account isn't linked to any copy group." });
      }
      refreshCounts();
    };
    syncRoles();
    renderCopyDetail();

    // ======== DANGER ZONE ========
    const dng = paneEls.danger;
    const archCard = dng.createDiv({ cls: "tj-as-dngcard" });
    const archRow = archCard.createDiv({ cls: "tj-as-dngrow" });
    const archInfo = archRow.createDiv();
    archInfo.createDiv({ cls: "tj-as-dngt", text: "Archive account" });
    archInfo.createDiv({ cls: "tj-as-dngd", text: "Hide from all views, metrics and dashboards. Data is preserved \u2014 restore anytime." });
    const archBtn = archRow.createEl("button", { text: "\uD83D\uDCE6 Archive", cls: "tj-as-btn", attr: { type: "button" } });
    archBtn.addEventListener("click", async () => {
      // An eval still in progress is not a finished thing: say so before hiding it.
      const inProgress =
        acc.type === "eval" && !acc.passedAt && !acc.passKept && !acc.linkedFundedId;
      const doIt = async () => {
        await this.plugin.archiveAccount(acc.id);
        overlay.remove();
        void this.plugin.openAccounts();
      };
      if (inProgress) this.showArchiveConfirm(archCard, acc, doIt);
      else await doIt();
    });
    const delCard = dng.createDiv({ cls: "tj-as-dngcard" });
    const delRow = delCard.createDiv({ cls: "tj-as-dngrow" });
    const delInfo = delRow.createDiv();
    delInfo.createDiv({ cls: "tj-as-dngt", text: "Delete account" });
    delInfo.createDiv({ cls: "tj-as-dngd", text: "Permanent \u2014 removes the account, payouts and deposits. Trade files stay in your vault." });
    delRow.createEl("button", { text: "\uD83D\uDDD1\uFE0F Delete", cls: "tj-as-btn tj-as-btn-del", attr: { type: "button" } }).addEventListener("click", () => {
      const confOverlay = document.body.createDiv({ cls: "tj-modal-overlay" });
      this.showDeleteConfirm(confOverlay, acc, 1, async () => {
        confOverlay.remove();
        await this.plugin.removeAccount(acc.id);
        overlay.remove();
        void this.plugin.openAccounts();
      });
    });

    // ---- Footer ----
    const foot = modal.createDiv({ cls: "tj-as-foot" });
    foot.createEl("button", { text: "Cancel", cls: "tj-as-btn", attr: { type: "button" } }).addEventListener("click", () => overlay.remove());
    foot.createEl("button", { text: "Save changes", cls: "tj-as-btn tj-as-btn-cta", attr: { type: "button" } }).addEventListener("click", async () => {
      // Keep names unique so two accounts never share trades/data.
      const taken = (this.plugin.settings.propAccounts || []).filter((a: any) => a.id !== acc.id).map((a: any) => a.name);
      const desired = uniqueAccountName(nameInput.value.trim() || acc.name, taken);
      if (desired !== acc.name) {
        // Rename + re-index every trade of this account so nothing is lost.
        await this.plugin.renameAccount(acc.id, desired);
      }
      if (startedValue) acc.createdAt = startedValue;
      else delete acc.createdAt;
      acc.size = selectedSize || acc.size;
      acc.type = selectedType;
      // A funded account must not keep the evaluation's rules: when the type
      // changes, snap the program to one of the right phase (Select eval →
      // Select Funded, Growth → Growth Funded, and so on).
      const firmObj = getFirm(acc.firmId);
      const currentProgram = getProgram(firmObj, acc.programId);
      if (firmObj && currentProgram && selectedType !== "unknown" && currentProgram.phase && currentProgram.phase !== selectedType) {
        const match = firmObj.programs.find((pr) => pr.phase === selectedType);
        if (match) acc.programId = match.id;
      }
      // Rules
      const rules: any = {};
      for (const r of ruleDefs) {
        if (ruleToggles[r.key]) {
          const raw = ruleInputs[r.key].value;
          rules[r.key] = r.type === "number" ? (parseFloat(raw) || 0) : raw;
        }
      }
      acc.rules = Object.keys(rules).length ? rules : undefined;
      // Copy role — every change closes the current stretch and opens a new one,
      // so trades already generated are never recalculated or lost.
      if (role === "copier") {
        const mult = Math.max(0.1, selectedMultiplier || 1);
        const start = copyAllHistory ? "0000-01-01" : copyStart || todayIso();
        const stillOpen = (acc.copyPeriods ?? []).find((p: CopyPeriod) => !p.end);
        const unchanged =
          acc.copyRole === "copier" && acc.copyBaseId === selectedBaseId && (acc.copyMultiplier ?? 1) === mult && (stillOpen?.start ?? "") === start;
        acc.copyRole = "copier";
        if (selectedBaseId) acc.copyBaseId = selectedBaseId;
        acc.copyMultiplier = mult;
        if (!unchanged && selectedBaseId) {
          openCopyPeriod(acc, selectedBaseId, mult, start);
          const hist = (acc.copyConfigHistory ?? []).slice();
          const last = hist.slice().sort((a: CopyConfigEntry, b: CopyConfigEntry) => a.from.localeCompare(b.from)).pop();
          if (!last || last.ratio !== mult || last.from !== start) {
            hist.push({ from: start, ratio: mult });
            acc.copyConfigHistory = hist;
          }
        }
      } else if (role === "base") {
        closeCopyPeriods(acc);
        acc.copyRole = "base";
        delete acc.copyBaseId;
        delete acc.copyMultiplier;
      } else {
        closeCopyPeriods(acc);
        delete acc.copyRole;
        delete acc.copyBaseId;
        delete acc.copyMultiplier;
      }
      await this.plugin.saveSettings();
      await this.plugin.reloadAllViews();
      overlay.remove();
      this.render();
    });

    showTab("general");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  }

  render(): void {
    const fmtDuration = (mins: number) => {
      const totalSec = Math.round(mins * 60);
      if (totalSec < 60) return `${totalSec}s`;
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      if (h > 0) return s ? `${h}h ${m}m ${s}s` : m ? `${h}h ${m}m` : `${h}h`;
      return s ? `${m}m ${s}s` : `${m}m`;
    };
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-account-dash");
    const main = renderAppShell(root, this.plugin, "accounts");

    const acc = this.account();
    if (!acc) {
      const empty = main.createDiv({ cls: "tj-empty" });
      empty.createDiv({
        text: this.accountId
          ? "This account no longer exists (it may have been deleted or archived)."
          : "No accounts configured yet — add your first account in Settings to see its dashboard here.",
      });
      empty.createEl("button", { text: "Open Settings", cls: "mod-cta tj-btn", attr: { type: "button" } }).addEventListener("click", () => {
        this.openPluginSettings();
      });
      return;
    }
    const firm = getFirm(acc.firmId);
    const program = getProgram(firm, acc.programId);
    const size = effectiveSize(getSize(program, acc.size), acc.rules);
    if (!firm || !program || !size) {
      main.createDiv({ cls: "tj-empty", text: "Unknown firm/program — please re-create this account in the Accounts tab." });
      return;
    }
    const header = main.createDiv({ cls: "tj-acc-header" });
    const titleWrap = header.createDiv({ cls: "tj-acc-titlewrap" });
    const backBtn = titleWrap.createEl("button", {
      cls: "tj-acc-back",
      text: "←",
      attr: { type: "button", "aria-label": "Back to Accounts" },
    });
    attachTip(backBtn, { title: "Back to Accounts" });
    backBtn.addEventListener("click", () => void this.plugin.openAccounts());
    const title = titleWrap.createDiv();
    title.createEl("h1", { text: acc.name });
    const headerActions = header.createDiv({ cls: "tj-acc-actions" });

    // What is out of the account sits with the doors that open it: the gold
    // badge reads first, then the two squares (payouts, settings).
    this.renderPayoutLine(headerActions, acc);

    // Two squares, side by side: payouts, then settings. Both use the same
    // icon-button recipe so they line up as a pair instead of drifting.
    if (acc.type === "funded" || acc.type === "live" || acc.type === "personal") {
      const payBtn = headerActions.createEl("button", {
        cls: "tj-iconbtn",
        attr: { type: "button", "aria-label": "Payouts" },
      });
      setIcon(payBtn, "banknote");
      attachTip(payBtn, {
        title: "Payouts",
        sub: "Log what you took out — the account value and its distance to the limit follow.",
      });
      payBtn.addEventListener("click", () => openPayoutsModal(this.plugin, acc.id, () => this.render()));
    }

    const gearBtn = headerActions.createEl("button", {
      cls: "tj-iconbtn",
      attr: { type: "button", "aria-label": "Edit account settings" },
    });
    setIcon(gearBtn, "sliders-horizontal");
    attachTip(gearBtn, { title: "Account settings", sub: "Rules, name, dates, copy role." });
    gearBtn.addEventListener("click", () => this.openEditAccountModal(acc, size, net));

    // The account's copy memory, on a line of its own under the title.
    this.renderCopyBar(main, acc);

    const scoped = this.scoped();
    const byDay = new Map<string, { net: number; count: number; wins: number }>();
    for (const t of scoped) {
      const key = this.dayKey(t);
      let bucket = byDay.get(key);
      if (!bucket) {
        bucket = { net: 0, count: 0, wins: 0 };
        byDay.set(key, bucket);
      }
      bucket.net += t.pnl;
      bucket.count += 1;
      if (t.pnl > 0) bucket.wins += 1;
    }
    // Cash that left or entered the account, per day. It is not trading: it only
    // moves the balance, and with it the distance to the loss limit. A payout
    // lowers the curve while the peak stays where it was, which is exactly what
    // the firm sees.
    const flowByDay = new Map<string, number>();
    for (const p of this.plugin.payoutsFor(acc.id)) flowByDay.set(p.date, (flowByDay.get(p.date) ?? 0) - Math.abs(p.amount));
    for (const d of this.plugin.depositsFor(acc.id)) flowByDay.set(d.date, (flowByDay.get(d.date) ?? 0) + Math.abs(d.amount));
    const days = [...new Set([...byDay.keys(), ...flowByDay.keys()])].sort();
    const series: { date: string; net: number; cum: number }[] = [];
    let runningTrades = 0;
    let runningBalance = 0;
    for (const d of days) {
      const dayNet = byDay.get(d)?.net ?? 0;
      const flow = flowByDay.get(d) ?? 0;
      runningTrades += dayNet;
      runningBalance += dayNet + flow;
      series.push({ date: d, net: dayNet, cum: runningBalance });
    }
    // Trading performance (target, consistency, win rate) ignores cash flows;
    // the balance does not.
    const net = runningTrades;
    const balance = acc.size + runningBalance;
    const peak = Math.max(0, ...series.map((s) => s.cum)) || 0;
    const floor = Math.min(peak - size.maxLoss, 0);
    const buffer = runningBalance - floor;
    const ddToLimit = Math.max(0, acc.size + peak - balance);
    // Day stats come from the trading days only: a payout on a day with no
    // trades is cash, not a trading day, and must not be read as one (it used to
    // crash here when that day had no entry in byDay).
    const dayNets = [...byDay.values()].map((b) => b.net);
    const grossProfit = dayNets.reduce((s, n) => s + Math.max(0, n), 0);
    const bestDay = dayNets.reduce((s, n) => Math.max(s, n), 0);
    const consBasis = size.consistencyBasis === "target" && size.target > 0 ? size.target : grossProfit;
    const consistency = consBasis > 0 ? (bestDay / consBasis) * 100 : 0;
    const consistencyNeed =
      size.consistency > 0 && bestDay > 0
        ? size.consistencyBasis === "target" && size.target > 0
          ? 0
          : bestDay / (size.consistency / 100) - grossProfit
        : 0;
    const todayNet = byDay.get(this.todayKey())?.net ?? 0;
    const tradeCount = scoped.length;
    const winCount = scoped.filter((t) => t.pnl > 0).length;
    const targetReached = size.target > 0 ? net >= size.target : false;
    const targetPct = size.target > 0 ? Math.min(100, (net / size.target) * 100) : 0;

    // Eval passed. Two states, and the difference matters: the celebration is
    // shown ONCE; the quiet band is the memory of it, so an eval that comes back
    // from the archive is never congratulated a second time.
    const passedState = acc.type === "eval" && !!(acc.passedAt || acc.passKept || acc.linkedFundedId);
    if (acc.type === "eval" && targetReached && !passedState) {
      const banner = main.createDiv({ cls: "tj-acc-passed-banner" });
      const bannerBody = banner.createDiv({ cls: "tj-acc-passed-body" });
      const ring = bannerBody.createDiv({ cls: "tj-acc-passed-ring" });
      ring.createDiv({ cls: "tj-acc-passed-ring-inner", text: "\u2713" });
      const bannerText = bannerBody.createDiv({ cls: "tj-acc-passed-text" });
      bannerText.createEl("h4", { text: "You passed the evaluation" });
      bannerText.createDiv({ cls: "tj-acc-passed-detail", text: `${fmtMoney(net)} net P\u0026L \u00b7 target of $${size.target.toLocaleString()} reached` });
      const doUpgrade = async (action: "keep" | "archive" | "delete") => {
        const newId = await this.plugin.upgradeAccountToFunded(acc.id, action);
        if (newId) await this.plugin.openAccountDashboard(this.leaf, newId);
      };
      const btns = banner.createDiv({ cls: "tj-acc-passed-btns" });
      const goArchive = btns.createEl("button", { text: "Upgrade & archive", cls: "mod-cta tj-btn", attr: { type: "button" } });
      attachTip(goArchive, { title: "Upgrade & archive", sub: "Creates the funded account and files this eval away. Its trades stay in the vault." });
      goArchive.addEventListener("click", () => doUpgrade("archive"));
      const goDelete = btns.createEl("button", { text: "Upgrade & delete", cls: "tj-btn tj-del", attr: { type: "button" } });
      attachTip(goDelete, { title: "Upgrade & delete", sub: "Creates the funded account and removes this eval for good. Asks twice." });
      goDelete.addEventListener("click", async () => {
        this.showDeleteConfirm(banner, acc, 1, async () => { await doUpgrade("delete"); });
      });
      const goKeep = btns.createEl("button", { text: "Keep for now", cls: "tj-btn", attr: { type: "button" } });
      attachTip(goKeep, { title: "Keep for now", sub: "Creates the funded account and leaves this eval here until you archive it." });
      goKeep.addEventListener("click", () => doUpgrade("keep"));
    } else if (passedState) {
      // The memory: quiet, factual, and the archive is always the first offer.
      const band = main.createDiv({ cls: "tj-acc-passed-band" });
      const bandBody = band.createDiv({ cls: "tj-acc-passed-body" });
      bandBody.createDiv({ cls: "tj-acc-passed-ring" }).createDiv({ cls: "tj-acc-passed-ring-inner", text: "\u2713" });
      const bandText = bandBody.createDiv({ cls: "tj-acc-passed-text" });
      bandText.createEl("h4", {
        text: acc.passedAt ? `Passed on ${formatDate(acc.passedAt, this.plugin.settings.dateFormat)}` : "Passed",
      });
      const props = (this.plugin.settings.propAccounts ?? []) as PropAccount[];
      const linked = acc.linkedFundedId ? props.find((a) => a.id === acc.linkedFundedId) : undefined;
      // No link? Look for the funded this eval most likely produced before
      // offering to create one: same firm, program and size, and not already
      // claimed by another eval. With five fundeds around, "create" must be the
      // last resort, never the first button.
      const candidate =
        !linked
          ? props.find(
              (a) =>
                a.type === "funded" &&
                a.id !== acc.id &&
                a.firmId === acc.firmId &&
                a.programId === acc.programId &&
                a.size === acc.size &&
                (!a.linkedEvalId || a.linkedEvalId === acc.id),
            )
          : undefined;
      bandText.createDiv({
        cls: "tj-acc-passed-detail",
        text: linked
          ? `This eval is done — it went on to ${linked.name}. Everything below is its history.`
          : candidate
            ? `This eval is done. ${candidate.name} looks like the account it produced — you can link the two.`
            : "This eval is done. No funded account is linked to it.",
      });
      const bandBtns = band.createDiv({ cls: "tj-acc-passed-btns" });
      if (linked) {
        // Named, and it only opens: no button here can create a second funded.
        const openFunded = bandBtns.createEl("button", { text: `Open ${linked.name}`, cls: "mod-cta tj-btn", attr: { type: "button" } });
        attachTip(openFunded, { title: `Open ${linked.name}`, sub: "Opens the funded account this eval is linked to. Nothing is created." });
        openFunded.addEventListener("click", () => void this.plugin.openAccountDashboard(this.leaf, linked.id));
        const relink = bandBtns.createEl("button", { text: "Not this one?", cls: "tj-btn", attr: { type: "button" } });
        attachTip(relink, { title: "Not this one?", sub: "Point this eval at a different funded account, or at none at all." });
        relink.addEventListener("click", () => this.showRelinkFunded(band, acc, props));
      } else if (candidate) {
        const linkBtn = bandBtns.createEl("button", { text: `Link to ${candidate.name}`, cls: "mod-cta tj-btn", attr: { type: "button" } });
        attachTip(linkBtn, { title: `Link to ${candidate.name}`, sub: "Connects the two accounts and nothing else — no account is created, no trade is touched." });
        linkBtn.addEventListener("click", () => void this.plugin.linkEvalToFunded(acc.id, candidate.id));
        const fresh = bandBtns.createEl("button", { text: "Create a new one", cls: "tj-btn", attr: { type: "button" } });
        attachTip(fresh, { title: "Create a new funded account", sub: "Only if that account is not the one this eval produced." });
        fresh.addEventListener("click", () => {
          this.showFundedCreateConfirm(band, acc, () => this.plugin.upgradeAccountToFunded(acc.id, "keep"));
        });
      } else {
        const create = bandBtns.createEl("button", { text: "Create the funded account", cls: "mod-cta tj-btn", attr: { type: "button" } });
        attachTip(create, { title: "Create the funded account", sub: "No funded account is linked to this eval — this makes one and links the two." });
        create.addEventListener("click", () => {
          this.showFundedCreateConfirm(band, acc, () => this.plugin.upgradeAccountToFunded(acc.id, "keep"));
        });
      }
      const bandArchive = bandBtns.createEl("button", { text: "Archive", cls: "tj-btn", attr: { type: "button" } });
      attachTip(bandArchive, { title: "Archive", sub: "Files it away for good: out of every view, still restorable from the Accounts page." });
      bandArchive.addEventListener("click", async () => {
        await this.plugin.archiveAccount(acc.id);
        void this.plugin.openAccounts();
      });
      const bandDelete = bandBtns.createEl("button", { text: "Delete", cls: "tj-btn tj-del", attr: { type: "button" } });
      attachTip(bandDelete, { title: "Delete", sub: "Removes the account, its payouts and deposits. Trade files stay in the vault." });
      bandDelete.addEventListener("click", () => {
        this.showDeleteConfirm(band, acc, 1, async () => {
          await this.plugin.removeAccount(acc.id);
          void this.plugin.openAccounts();
        });
      });
    }

    // ================= HERO: equity (0 = account value) + Risk ↔ Target =================
    // A funded account can offer more than one payout route, each with its own
    // rulebook (TopStep XFA: 5 winning days of $150+, or 3 days at 40%). The
    // route the trader picked wins over the firm's headline numbers.
    const M = computeAccountMetrics({
      trades: scoped,
      size: acc.size,
      target: size.target,
      maxLoss: size.maxLoss,
      ddLockOffset: size.ddLockOffset,
      ddNoLock: size.maxLossType === "eod-trailing-open",
      dailyLoss: size.dailyLoss,
      consistency: size.consistency,
      consistencyBasis: size.consistencyBasis,
      dayKey: (t) => this.dayKey(t),
      todayKey: this.todayKey(),
      withdrawn: this.plugin.accountPayoutsTotal(acc.id),
      cashflows: [
        ...this.plugin.payoutsFor(acc.id).map((p) => ({ date: p.date, amount: -Math.abs(p.amount) })),
        ...this.plugin.depositsFor(acc.id).map((d) => ({ date: d.date, amount: Math.abs(d.amount) })),
      ],
    });

    // ---- Drawdown episodes ----
    const ddAnalysis = computeDrawdownEpisodes(series.map((s) => ({ date: s.date, balance: acc.size + s.cum })), acc.size);

    // ---------- Discipline (shown on the back of the hero card) ----------
    const renderDisciplineCard = (host: HTMLElement) => {
      const top = host.createDiv({ cls: "tj-acc-disc-top" });
      const gauge = (label: string, pct: number, invert: boolean) => {
        const box = top.createDiv({ cls: "tj-acc-disc-gauge" });
        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "0 0 72 72");
        const r = document.createElementNS(NS, "circle");
        r.setAttribute("cx", "36"); r.setAttribute("cy", "36"); r.setAttribute("r", "30");
        r.setAttribute("fill", "none"); r.setAttribute("stroke", "rgba(255,255,255,.07)"); r.setAttribute("stroke-width", "7");
        const a = document.createElementNS(NS, "circle");
        a.setAttribute("cx", "36"); a.setAttribute("cy", "36"); a.setAttribute("r", "30");
        a.setAttribute("fill", "none");
        const good = invert ? pct <= 10 : pct >= 80;
        const mid = invert ? pct <= 30 : pct >= 40;
        a.setAttribute("stroke", good ? "var(--color-green-bright, #34d17a)" : mid ? "#d9a441" : "var(--color-red-bright, #ff5d48)");
        a.setAttribute("stroke-width", "7"); a.setAttribute("stroke-linecap", "round");
        a.setAttribute("pathLength", "100");
        a.setAttribute("stroke-dasharray", `${Math.max(1, Math.min(100, pct))} 100`);
        a.setAttribute("transform", "rotate(-90 36 36)");
        svg.appendChild(r); svg.appendChild(a);
        box.appendChild(svg as unknown as Node);
        box.createDiv({ cls: "tj-acc-disc-num", text: `${pct.toFixed(0)}%` });
        box.createDiv({ cls: "tj-acc-disc-lbl", text: label });
      };
      gauge("Mistakes", M.mistakeRate, true);
      gauge("Reviewed", M.reviewedPct, false);

      // Discipline score: a bar with the same visual language as Risk ↔ Target.
      const score = Math.round(
        0.3 * Math.max(0, 100 - M.mistakeRate) +
          0.25 * M.reviewedPct +
          0.2 * M.stopDefinedPct +
          0.15 * M.reviewCompletePct +
          0.1 * ((M.avgRating / 5) * 100)
      );
      const band = score >= 70 ? "var(--color-green-bright, #34d17a)" : score >= 45 ? "#d9a441" : "var(--color-red-bright, #ff5d48)";
      const scoreRow = top.createDiv({ cls: "tj-acc-dscore" });
      const scoreLeft = scoreRow.createDiv();
      scoreLeft.createDiv({ cls: "tj-acc-k", text: "Discipline score" });
      const scoreTrack = scoreRow.createDiv({ cls: "tj-acc-risktrack" });
      const scoreFill = scoreTrack.createDiv({ cls: "tj-acc-dscore-fill" });
      scoreFill.style.width = `${Math.max(2, Math.min(100, score))}%`;
      scoreFill.style.background = band;
      scoreRow.createDiv({ cls: "tj-acc-dscore-num", text: String(score) });
      attachTip(scoreTrack, { title: "Discipline score", sub: "Weighted from mistakes, reviews, stops, journal completeness and rating." });
      const cols = host.createDiv({ cls: "tj-acc-mcols" });
      const habits = cols.createDiv({ cls: "tj-acc-mcol" });
      const behaviour = cols.createDiv({ cls: "tj-acc-mcol" });
      const dRow = (col: HTMLElement, label: string, value: string, tone: string, info: string) => {
        const row = col.createDiv({ cls: "tj-acc-mrow" });
        const k = row.createDiv({ cls: "tj-acc-mlabel" });
        k.createSpan({ text: label });
        const dot = k.createSpan({ cls: "tj-info-dot tj-tip-anchor", text: "i" });
        row.createEl("b", { cls: `tj-acc-mvalue ${tone}`.trim(), text: value });
        dot.addEventListener("mouseenter", () => showTip({ title: label, sub: info }, "tj-acc-facttip"));
        dot.addEventListener("mousemove", (e) => moveTip(e));
        dot.addEventListener("mouseleave", () => killTip());
      };
      habits.createDiv({ cls: "tj-acc-mgroup", text: "Habits" });
      dRow(habits, "Reviewed", `${M.reviewedPct.toFixed(0)}%`, M.reviewedPct >= 80 ? "tj-pos" : "tj-warn", "Trades you marked as reviewed (batch flag).");
      dRow(habits, "Journal complete", `${M.reviewCompletePct.toFixed(0)}%`, M.reviewCompletePct >= 80 ? "tj-pos" : "tj-warn", "Trades with the full checklist: print, strategy, review and rating.");
      dRow(habits, "Stop defined", `${M.stopDefinedPct.toFixed(0)}%`, M.stopDefinedPct >= 90 ? "tj-pos" : "tj-warn", "Trades where you recorded a stop loss (risk defined up front).");
      dRow(habits, "Strategy tagged", `${(100 - M.untaggedPct).toFixed(0)}%`, M.untaggedPct > 30 ? "tj-warn" : "tj-pos", "Trades with a strategy tag.");
      dRow(habits, "Rating avg", M.avgRating ? M.avgRating.toFixed(1) : "—", M.avgRating >= 4 ? "tj-pos" : "", "Average execution/quality rating you gave yourself.");

      behaviour.createDiv({ cls: "tj-acc-mgroup", text: "Behaviour" });
      dRow(behaviour, "Trades / day", M.tradesPerDay ? M.tradesPerDay.toFixed(1) : "—", "", "Average trades per active day.");
      dRow(behaviour, "Max / day", String(M.maxTradesInDay), "", "Most trades taken in a single day.");
      dRow(behaviour, "Revenge trades", `${M.revengeCount} (${M.revengeRate.toFixed(0)}%)`, M.revengeCount > 0 ? "tj-warn" : "", "Trades opened within 15 minutes of a losing trade.");
      dRow(behaviour, "After 2 losses", String(M.afterTwoLosses), M.afterTwoLosses > 0 ? "tj-warn" : "", "Trades opened right after two consecutive losses (tilt).");
      dRow(behaviour, "Trades < 1 min", `${M.fastTradesPct.toFixed(0)}%`, M.fastTradesPct > 20 ? "tj-warn" : "", "Trades closed in under a minute (impulsive entries).");
      dRow(behaviour, "Streak now", M.streakCurrent === 0 ? "—" : `${Math.abs(M.streakCurrent)} ${M.streakCurrent > 0 ? "wins" : "losses"}`, M.streakCurrent < 0 ? "tj-neg" : M.streakCurrent > 0 ? "tj-pos" : "", "Current win/loss streak.");
      dRow(behaviour, "Best / worst streak", `${M.streakWinBest}W / ${M.streakLossWorst}L`, "", "Longest winning and losing runs.");
      dRow(behaviour, "Hold W / L", `${fmtDuration(M.avgHoldWinMin)} / ${fmtDuration(M.avgHoldLossMin)}`, "", "Average holding time for winners vs losers.");
    };

    const wFacts = (host: HTMLElement) => host.createDiv({ cls: "tj-acc-perffacts" });
    const wFact = (host: HTMLElement, label: string, value: string, tone = "") => {
      const f = host.createDiv({ cls: "tj-acc-pfact" });
      f.createDiv({ cls: "tj-acc-k", text: label });
      f.createDiv({ cls: `tj-acc-factv ${tone}`.trim(), text: value });
    };
    const mkDonut = (host: HTMLElement, label: string, pct: number, sub: string) => {
      const box = host.createDiv({ cls: "tj-acc-dial" });
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 104 104");
      svg.setAttribute("class", "tj-acc-donut");
      const ring = document.createElementNS(NS, "circle");
      ring.setAttribute("cx", "52"); ring.setAttribute("cy", "52"); ring.setAttribute("r", "44");
      ring.setAttribute("fill", "none"); ring.setAttribute("stroke", "rgba(255,255,255,.07)"); ring.setAttribute("stroke-width", "9");
      const arc = document.createElementNS(NS, "circle");
      arc.setAttribute("cx", "52"); arc.setAttribute("cy", "52"); arc.setAttribute("r", "44");
      arc.setAttribute("fill", "none");
      arc.setAttribute("stroke", pct >= 50 ? "var(--color-green-bright, #34d17a)" : pct >= 40 ? "#d9a441" : "var(--color-red-bright, #ff5d48)");
      arc.setAttribute("stroke-width", "9"); arc.setAttribute("stroke-linecap", "round");
      arc.setAttribute("pathLength", "100");
      arc.setAttribute("stroke-dasharray", `${Math.max(0, Math.min(100, pct))} 100`);
      arc.setAttribute("transform", "rotate(-90 52 52)");
      svg.appendChild(ring); svg.appendChild(arc);
      box.appendChild(svg as unknown as Node);
      box.createDiv({ cls: "tj-acc-dial-num", text: `${pct.toFixed(0)}%` });
      box.createDiv({ cls: "tj-acc-dial-lbl", text: label });
      box.createDiv({ cls: "tj-acc-dial-sub", text: sub });
    };
    const hero = main.createDiv({ cls: "tj-acc-hero" });
    const heroLeft = hero.createDiv({ cls: "tj-acc-heroleft" });

    const eqCard = heroLeft.createDiv({ cls: "tj-acc-eqcard" });
    const eqHead = eqCard.createDiv({ cls: "tj-acc-eqhead" });
    const eqTitleRow = eqHead.createDiv({ cls: "tj-acc-eqtitlerow" });
    eqTitleRow.createDiv({ cls: "tj-acc-k", text: `Equity — ${firm.name} ${program.label} $${(acc.size / 1000).toFixed(0)}K ${acc.type.charAt(0).toUpperCase() + acc.type.slice(1)}` });
    // Streak dots (last 20 trading days) — top right, same line as title
    if (days.length > 0) {
      const eqRight = eqTitleRow.createDiv({ cls: "tj-acc-eqright" });
      const streakRow = eqRight.createDiv({ cls: "tj-acc-streakrow" });
      const last20 = [...byDay.keys()].sort().slice(-20);
      for (const d of last20) {
        const b = byDay.get(d)!;
        const dot = streakRow.createDiv({
          cls: "tj-acc-streakdot " + (b.net > 0 ? "tj-acc-streak-win" : b.net < 0 ? "tj-acc-streak-loss" : "tj-acc-streak-be"),
          attr: { "aria-label": `${d}: ${fmtMoney(b.net)} (${b.count} trades)` },
        });
        attachTip(dot, { title: d, value: fmtMoney(b.net), tone: b.net >= 0 ? "pos" : "neg", sub: `${b.count} trades` });
      }
    }
    const eqVal = eqHead.createDiv({ cls: "tj-acc-eqval" });
    eqVal.createSpan({ cls: "tj-acc-big", text: `$${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}` });
    eqVal.createSpan({
      cls: "tj-acc-growth " + (net >= 0 ? "tj-pos" : "tj-neg"),
      text: `${fmtMoney(net)} (${acc.size ? ((net / acc.size) * 100).toFixed(1) : "0"}%)`,
    });
    const eqChart = eqCard.createDiv({ cls: "tj-acc-eqchart" });
    if (series.length) {
      const balances = [acc.size, ...series.map((s2) => acc.size + s2.cum)];
      const ddLevels: number[] = [];
      if (size.maxLoss) {
        let runPeak = acc.size;
        for (const bal of balances) {
          runPeak = Math.max(runPeak, bal);
          // Trails the running peak, then locks at the firm's point (Tradeify
          // +$100 above the starting balance; TopStep locks at break-even).
          // A firm that never locks keeps the floor on the peak instead.
          const locked = Math.min(acc.size + (size.ddLockOffset ?? 0), runPeak - size.maxLoss);
          ddLevels.push(Math.round(size.maxLossType === "eod-trailing-open" ? runPeak - size.maxLoss : locked));
        }
      }
      renderLineChart(eqChart, {
        values: balances,
        dates: [series[0]?.date ?? "", ...series.map((s2) => s2.date)],
        baseline: acc.size,
        baseLine: acc.size,
        fadeFloor: acc.size,
        targetLine: size.target ? acc.size + size.target : undefined,
        ddLine: ddLevels.length === balances.length ? ddLevels : undefined,
        dayDeltas: [0, ...series.map((s2) => s2.net)],
        // A day this account paid out is marked in gold, not green or red:
        // the money left, the trading did not lose it.
        dayCash: [0, ...series.map((s2, k) => ((flowByDay.get(s2.date) ?? 0) < 0 ? k + 1 : -1)).filter((i) => i >= 0)],
        hoverLines: (i) => {
          const s2 = i > 0 ? series[i - 1] : undefined;
          const rows2: Array<[string, string, string]> = [
            ["Trades", s2 ? String(byDay.get(s2.date)?.count ?? 0) : "0", ""],
            ["Day P&L", s2 ? fmtMoney(s2.net) : "—", s2 && s2.net < 0 ? "tj-neg" : s2 && s2.net > 0 ? "tj-pos" : ""],
          ];
          const flow = s2 ? flowByDay.get(s2.date) ?? 0 : 0;
          if (flow < 0) rows2.push(["Payout", fmtMoney(Math.abs(flow)), "tj-cash"]);
          if (flow > 0) rows2.push(["Deposit", fmtMoney(flow), "tj-pos"]);
          if (ddLevels.length) rows2.push(["Drawdown level", fmtMoney(ddLevels[i] ?? 0), ""]);
          if (size.target) rows2.push(["Target", fmtMoney(acc.size + size.target), "tj-pos"]);
          return rows2;
        },
        key: `account:${acc.id}`,
        format: this.plugin.settings.dateFormat,
        showDates: this.plugin.settings.chartDates !== false,
        animations: this.plugin.settings.animations !== false,
      });
    } else {
      eqChart.createDiv({ cls: "tj-empty", text: "No trades yet." });
    }

    const heroBreak = heroLeft.createDiv({ cls: "tj-acc-herobreak" });
    const riskCard = hero.createDiv({ cls: "tj-acc-riskcard tj-acc-flipcard" });
    let flipped = false;
    const flipBtn = riskCard.createEl("button", { cls: "tj-acc-flipbtn", text: "⇋", attr: { type: "button", "aria-label": "Flip card" } });
    attachTip(flipBtn, { title: "Flip card", sub: "Limits on one side, discipline on the other." });
    const front = riskCard.createDiv({ cls: "tj-acc-flipface tj-acc-ffront" });
    const back = riskCard.createDiv({ cls: "tj-acc-flipface tj-acc-fback" });
    back.addClass("is-hidden");
    const backHead = back.createDiv({ cls: "tj-acc-riskhead" });
    backHead.createDiv({ cls: "tj-acc-k", text: "Discipline · habits & behaviour" });
    const riskHead = front.createDiv({ cls: "tj-acc-riskhead" });
    riskHead.createDiv({ cls: "tj-acc-k", text: "Key metrics" });
    const riskChart = front.createDiv({ cls: "tj-acc-riskchart" });
    const riskDials = riskChart.createDiv({ cls: "tj-acc-riskdials" });
    mkDonut(riskDials, "Win rate", M.winRate, "");
    mkDonut(riskDials, "Day win rate", M.dayWinRate, "");
    const barCol = riskChart.createDiv({ cls: "tj-acc-riskbarcol" });
    // labels + values ABOVE the bar so the bar can run full width
    const barHead = barCol.createDiv({ cls: "tj-acc-barhead" });
    const ddSide = barHead.createDiv({ cls: "tj-acc-riskside" });
    ddSide.createDiv({ cls: "tj-acc-riskside-v", text: size.maxLoss ? `-$${size.maxLoss.toLocaleString()}` : "—" });
    const tgtSide = barHead.createDiv({ cls: "tj-acc-riskside tj-acc-riskside-right" });
    tgtSide.createDiv({ cls: "tj-acc-riskside-v tj-pos", text: size.target ? `+$${size.target.toLocaleString()}` : "—" });

    const track = barCol.createDiv({ cls: "tj-acc-risktrack" });
    const span = (size.maxLoss || 0) + (size.target || 0);
    if (span > 0) {
      const zeroPct = ((size.maxLoss || 0) / span) * 100;
      const posPct = Math.max(1, Math.min(99, (((size.maxLoss || 0) + net) / span) * 100));
      const zl = track.createDiv({ cls: "tj-acc-zone tj-acc-zone-loss" });
      zl.style.width = `${zeroPct}%`;
      const zr = track.createDiv({ cls: "tj-acc-zone tj-acc-zone-gain" });
      zr.style.left = `${zeroPct}%`;
      const mid = track.createDiv({ cls: "tj-acc-zone-mid" });
      mid.style.left = `${zeroPct}%`;
      const mk = track.createDiv({ cls: "tj-acc-marker" });
      mk.style.left = `calc(${posPct}% - 1px)`;
      track.addClass("tj-tip-anchor");
      track.addEventListener("mouseenter", () => {
        const ddPct = size.maxLoss ? Math.round((Math.max(0, -net) / size.maxLoss) * 100) : 0;
        showTip(
          {
            title: "Key metrics",
            value: fmtMoney(net),
            tone: net >= 0 ? "pos" : "neg",
            sub: `${ddPct}% of max loss used · buffer ${fmtMoney(Math.max(0, M.buffer))}`,
          },
          "tj-acc-risktip"
        );
      });
      track.addEventListener("mousemove", (e) => moveTip(e));
      track.addEventListener("mouseleave", () => killTip());
    }
    const riskAxis = barCol.createDiv({ cls: "tj-acc-riskaxis" });
    const axM = riskAxis.createSpan({ text: "$0" });
    if (span > 0) {
      axM.style.left = `${((size.maxLoss || 0) / span) * 100}%`;
      axM.style.transform = "translateX(-50%)";
    }

    // Drawdown limit used — progress bar (like Journalit)
    if (size.maxLoss) {
      const ddUsed = Math.max(0, M.ddCurrent);
      const ddPct = Math.min(100, (ddUsed / size.maxLoss) * 100);
      const ddStatus = ddPct >= 100 ? "breached" : ddPct >= 75 ? "critical" : ddPct >= 50 ? "warning" : "safe";
      const ddBox = front.createDiv({ cls: "tj-acc-ddbox" });
      const ddHead = ddBox.createDiv({ cls: "tj-acc-ddhead" });
      ddHead.createSpan({ cls: "tj-acc-k", text: "Drawdown used" });
      const badge = ddHead.createSpan({ cls: `tj-acc-ddbadge tj-acc-ddbadge-${ddStatus}` });
      badge.setText(ddStatus === "breached" ? "BREACHED" : ddStatus === "critical" ? "CRITICAL" : ddStatus === "warning" ? "WARNING" : "OK");
      const ddTrack = ddBox.createDiv({ cls: "tj-acc-ddtrack" });
      const ddFill = ddTrack.createDiv({ cls: `tj-acc-ddfill tj-acc-ddfill-${ddStatus}` });
      ddFill.style.width = `${ddPct}%`;
      const ddInfo = ddBox.createDiv({ cls: "tj-acc-ddinfo" });
      ddInfo.createSpan({ text: `${fmtMoney(ddUsed)} used` });
      ddInfo.createSpan({ text: `limit: -$${size.maxLoss.toLocaleString()}` });
      ddInfo.createSpan({ text: `remaining: ${fmtMoney(Math.max(0, M.buffer))}` });

      // DD episodes summary line
      if (ddAnalysis.totalEpisodes > 0) {
        const ddSummary = ddBox.createDiv({ cls: "tj-acc-ddsummary" });
        const parts: string[] = [];
        parts.push(`${ddAnalysis.totalEpisodes} episode${ddAnalysis.totalEpisodes === 1 ? "" : "s"}`);
        if (ddAnalysis.avgRecoveryDays > 0) parts.push(`avg recovery: ${Math.round(ddAnalysis.avgRecoveryDays)}d`);
        if (ddAnalysis.currentDD) parts.push(`current: -${ddAnalysis.currentDD.depthPct.toFixed(1)}%`);
        ddSummary.createSpan({ text: parts.join(" · ") });
      }
    }

    const metricCols = front.createDiv({ cls: "tj-acc-mcols" });
    const limitsCol = metricCols.createDiv({ cls: "tj-acc-mcol" });
    const perfCol = metricCols.createDiv({ cls: "tj-acc-mcol" });

    const mRow = (col: HTMLElement, label: string, value: string, tone: string, info: string) => {
      const row = col.createDiv({ cls: "tj-acc-mrow" });
      const k = row.createDiv({ cls: "tj-acc-mlabel" });
      k.createSpan({ text: label });
      const dot = k.createSpan({ cls: "tj-info-dot tj-tip-anchor", text: "i" });
      row.createEl("b", { cls: `tj-acc-mvalue ${tone}`.trim(), text: value });
      dot.addEventListener("mouseenter", () => showTip({ title: label, sub: info }, "tj-acc-facttip"));
      dot.addEventListener("mousemove", (e) => moveTip(e));
      dot.addEventListener("mouseleave", () => killTip());
    };

    limitsCol.createDiv({ cls: "tj-acc-mgroup", text: "Limits" });
    const todayTrades = scoped.filter((t) => this.dayKey(t) === this.todayKey()).length;
    mRow(limitsCol, "Today", todayTrades ? `${fmtMoney(M.todayNet)} · ${todayTrades}` : "—", M.todayNet < 0 ? "tj-neg" : M.todayNet > 0 ? "tj-pos" : "", "Today's net P&L and trades.");
    if (size.maxLoss) mRow(limitsCol, "Risk room", fmtMoney(Math.max(0, M.buffer)), M.buffer > 0 ? "tj-warn" : "tj-neg", "Money you can still lose before hitting the max-loss floor.");
    if (size.target) mRow(limitsCol, "Target progress", `${targetPct.toFixed(0)}%`, "", "How close you are to the profit target.");
    if (size.target && M.daysToTarget !== null) mRow(limitsCol, "Days to target", `~${M.daysToTarget}`, "", "At your current daily pace.");
    if (size.dailyLoss) mRow(limitsCol, "Daily room", fmtMoney(M.dailyLossRemaining), M.dailyLossRemaining > 0 ? "" : "tj-neg", "How much you can still lose today before the daily loss limit.");
    if (size.dailyLoss) mRow(limitsCol, "Worst day / limit", `${M.worstDayPctOfLimit.toFixed(0)}%`, M.worstDayPctOfLimit > 80 ? "tj-neg" : "", "Your worst day compared to the daily loss limit.");
    if (size.consistency > 0) {
      mRow(limitsCol, "Consistency", `${M.consistencyPct.toFixed(0)}% / ${size.consistency}%`, M.consistencyPct <= size.consistency ? "tj-pos" : "tj-neg", M.impliedTarget > size.target ? `Biggest day needs $${M.impliedTarget.toLocaleString()} total profit to satisfy the rule.` : "Best day stays within the limit.");
    }
    if (size.maxLoss) mRow(limitsCol, "DD from peak", fmtMoney(-M.ddCurrent), M.ddCurrent > 0 ? "tj-warn" : "", "Distance from the highest account balance.");
    if (size.maxLoss) mRow(limitsCol, "Max drawdown", fmtMoney(-M.maxDrawdown), "tj-neg", "Deepest peak-to-trough drawdown.");
    if (M.avgRiskMoney) mRow(limitsCol, "Avg risk / trade", `${fmtMoney(M.avgRiskMoney)} · ${M.avgRiskR.toFixed(2)}R`, "", "Average risk per trade.");

    perfCol.createDiv({ cls: "tj-acc-mgroup", text: "Performance" });
    mRow(perfCol, "Profit factor", Number.isFinite(M.profitFactor) ? M.profitFactor.toFixed(2) : M.profitFactor > 0 ? "∞" : "—", "", "Gross profit ÷ gross loss.");
    mRow(perfCol, "Expectancy", fmtMoney(M.expectancy), M.expectancy >= 0 ? "tj-pos" : "tj-neg", "Average P&L per trade.");
    mRow(perfCol, "Avg win / loss", M.avgLoss ? `${fmtMoney(M.avgWin)} / ${fmtMoney(-M.avgLoss)}` : fmtMoney(M.avgWin), "", "Average winning vs losing trade.");
    mRow(perfCol, "Winning trades", `${M.winCount} (${M.winRate.toFixed(0)}%)`, "", "Winners and win rate.");
    mRow(perfCol, "Trades ≥ 1R", M.pctGE1R ? `${M.pctGE1R.toFixed(0)}%` : "—", "", "How often a trade reached at least 1R.");
    mRow(perfCol, "Best day", fmtMoney(M.bestDay), "tj-pos", "Best single day.");
    mRow(perfCol, "Worst day", fmtMoney(M.worstDay), "tj-neg", "Worst single day.");
    if (M.revengeCount) mRow(perfCol, "Revenge trades", `${M.revengeCount} (${M.revengeRate.toFixed(0)}%)`, "tj-warn", "Trades opened within 15 minutes of a losing trade.");

    renderDisciplineCard(back);
    flipBtn.addEventListener("click", () => {
      flipped = !flipped;
      front.toggleClass("is-hidden", flipped);
      back.toggleClass("is-hidden", !flipped);
      const show = flipped ? back : front;
      show.addClass("tj-acc-flipin");
      window.setTimeout(() => show.removeClass("tj-acc-flipin"), 320);
      flipBtn.setText(flipped ? "⇋" : "⇋");
    });

    // ---------- aggregates used by the widgets ----------
    const dayWins = days.filter((d) => (byDay.get(d)?.net ?? 0) > 0).length;
    const dayWinRate = days.length ? (dayWins / days.length) * 100 : 0;
    const winRate = tradeCount ? (winCount / tradeCount) * 100 : 0;
    const grossWin = M.grossWin;
    const grossLoss = M.grossLoss;
    const profitFactor = M.profitFactor;
    const expectancy = M.expectancy;
    const avgWin = M.avgWin;
    const avgLoss = M.avgLoss;
    const maxDD = M.maxDrawdown;

    // active breakdown filter (drives the trades widget below — seamless transition)
    let bdFilter: { label: string; test: (t: Trade) => boolean } | null = null;
    let refreshTrades: () => void = () => {};

    const groupBy = (keyFn: (t: Trade) => string): Array<[string, { net: number; count: number; wins: number }]> => {
      const map = new Map<string, { net: number; count: number; wins: number }>();
      for (const t of scoped) {
        const k = keyFn(t) || "—";
        const b = map.get(k) ?? { net: 0, count: 0, wins: 0 };
        b.net += t.pnl; b.count += 1; if (t.pnl > 0) b.wins += 1;
        map.set(k, b);
      }
      return [...map.entries()].sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net));
    };
    const groupByAll = (keyFn: (t: Trade) => string): Array<[string, { net: number; count: number; wins: number }]> => {
      const map = new Map<string, { net: number; count: number; wins: number }>();
      for (const t of scoped) {
        const k = keyFn(t) || "—";
        const b = map.get(k) ?? { net: 0, count: 0, wins: 0 };
        b.net += t.pnl; b.count += 1; if (t.pnl > 0) b.wins += 1;
        map.set(k, b);
      }
      return [...map.entries()];
    };

    const renderBars = (
      host: HTMLElement,
      rows: Array<[string, { net: number; count: number; wins: number }]>,
      keyFn?: (t: Trade) => string
    ) => {
      if (!rows.length) {
        host.createDiv({ cls: "tj-empty", text: "No data." });
        return;
      }
      const totalNet = rows.reduce((a, [, b]) => a + b.net, 0);
      const totalTrades = rows.reduce((a, [, b]) => a + b.count, 0) || 1;
      const maxAbs = Math.max(...rows.map(([, b]) => Math.abs(b.net)), 1);

      // header
      const head = host.createDiv({ cls: "tj-acc-bhead" });
      head.createSpan({ text: `${rows.length} ${rows.length === 1 ? "group" : "groups"} · ${totalTrades} trades` });

      // compact treemap: tile width ∝ trades, colour ∝ result
      const MAXT = 6;
      let tiles = rows;
      if (rows.length > MAXT) {
        const head6 = rows.slice(0, MAXT);
        const rest = rows.slice(MAXT);
        const merged = rest.reduce(
          (a, [, b]) => ({ net: a.net + b.net, count: a.count + b.count, wins: a.wins + b.wins }),
          { net: 0, count: 0, wins: 0 }
        );
        tiles = [...head6, ["Other", merged]] as Array<[string, { net: number; count: number; wins: number }]>;
      }
      const moneyShort = (v: number) => {
        const a = Math.abs(v);
        const body = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : a.toFixed(0);
        return `${v < 0 ? "-" : "+"}$${body}`;
      };
      const map = host.createDiv({ cls: "tj-acc-treemap" });
      for (const [name, b] of tiles) {
        const tile = map.createDiv({ cls: "tj-acc-tile" });
        tile.style.flex = `${Math.max(1, b.count)} 1 0`;
        const win = winOf(b);
        const good = b.net >= 0;
        const strength = 0.14 + (Math.abs(b.net) / maxAbs) * 0.34;
        tile.style.background = good
          ? `linear-gradient(160deg, rgba(52,209,122,${strength.toFixed(2)}), rgba(34,122,74,${(strength * 0.5).toFixed(2)}))`
          : `linear-gradient(160deg, rgba(255,93,72,${strength.toFixed(2)}), rgba(143,43,30,${(strength * 0.5).toFixed(2)}))`;
        tile.createDiv({ cls: "tj-acc-tile-t", text: name });
        tile.createDiv({ cls: `tj-acc-tile-v ${good ? "tj-pos" : "tj-neg"}`, text: moneyShort(b.net) });
        tile.createDiv({ cls: "tj-acc-tile-w", text: `${Math.round(win)}% win` });
        // rich hover card (same language as the rest of the plugin)
        tile.addClass("tj-tip-anchor");
        const share = (b.count / totalTrades) * 100;
        tile.addEventListener("mouseenter", () =>
          showTip(
            {
              title: name,
              value: fmtMoney(b.net),
              tone: b.net >= 0 ? "pos" : "neg",
              sub: `${b.count} trades (${share.toFixed(0)}% of activity) · ${Math.round(win)}% win · avg ${moneyShort(b.count ? b.net / b.count : 0)}/trade`,
            },
            "tj-acc-tiletip"
          )
        );
        tile.addEventListener("mousemove", (e) => moveTip(e));
        tile.addEventListener("mouseleave", () => killTip());
        if (keyFn && !(name === "Other" && rows.length > MAXT)) {
          tile.addClass("tj-acc-tile-click");
          if (bdFilter?.label === name) tile.addClass("is-active");
          attachTip(tile, { title: name, sub: `Click to show only "${name}" in the trades below.` }, "tj-acc-tiletip");
          tile.addEventListener("click", () => {
            bdFilter = { label: name, test: (t) => (keyFn(t) || "—") === name };
            host.querySelectorAll(".tj-acc-tile").forEach((n) => n.removeClass("is-active"));
            tile.addClass("is-active");
            refreshTrades();
          });
        }
      }
      // auto-fit: tiny tiles shrink values
      window.requestAnimationFrame(() => {
        for (const child of Array.from(map.children) as HTMLElement[]) {
          const w = child.clientWidth;
          if (w < 62) child.addClass("is-tiny");
          else if (w < 96) child.addClass("is-narrow");
          else if (w < 120) child.addClass("is-compact");
        }
      });
    };

    // ---- Breakdowns (fixed under the equity chart; filters the trades below) ----
    const bdHead = heroBreak.createDiv({ cls: "tj-acc-bdhead" });
    bdHead.createDiv({ cls: "tj-acc-k", text: "Breakdowns" });
    const bdTabs = bdHead.createDiv({ cls: "tj-acc-btabs" });
    const bdBody = heroBreak.createDiv({ cls: "tj-acc-bbody" });
    const WD_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const hourOrder = (label: string) => {
      const m = /^(\d{1,2})(am|pm)$/.exec(label);
      if (!m) return 99;
      const h = parseInt(m[1], 10) % 12;
      return m[2] === "pm" ? h + 12 : h;
    };
    const bdDims: Array<[string, string, (t: Trade) => string, (label: string) => number]> = [
      ["direction", "Direction", (t) => (t.direction === "long" ? "Long" : "Short"), () => 0],
      ["symbol", "Symbol", (t) => t.symbol, () => 0],
      ["setup", "Strategy", (t) => t.setup, () => 0],
      ["weekday", "Weekday", (t) => this.weekdayOf(t), (l) => (WD_ORDER.indexOf(l) < 0 ? 99 : WD_ORDER.indexOf(l))],
      ["hour", "Hour", (t) => this.hourBlockOf(t), hourOrder],
      // Regular session vs overnight: the split that says whether the hours
      // outside the cash session are paying for themselves.
      ["session", "Session", (t) => sessionLabel(t, this.plugin.settings.timeZone), sessionRank],
    ];
    const bdButtons = new Map<string, HTMLElement>();
    let currentDim = this.plugin.settings.accountBreakdownTab ?? "symbol";
    const winOf = (b: { count: number; wins: number }) => (b.count ? (b.wins / b.count) * 100 : 0);
    const bdSelect = (id: string) => {
      currentDim = id;
      for (const [key, btn] of bdButtons) btn.toggleClass("on", key === id);
      bdBody.empty();
      const dim = bdDims.find((d) => d[0] === id) ?? bdDims[0];
      let rows = groupBy(dim[2]);
      if (id === "weekday" || id === "hour" || id === "session") {
        // chronological order instead of by size
        rows = groupByAll(dim[2]).sort((a, b) => dim[3](a[0]) - dim[3](b[0]));
      }
      renderBars(bdBody, rows, dim[2]);
    };
    for (const [id, label] of bdDims) {
      const b = bdTabs.createEl("button", {
        cls: "tj-acc-btab" + ((this.plugin.settings.accountBreakdownTab ?? "symbol") === id ? " on" : ""),
        text: label,
        attr: { type: "button" },
      });
      bdButtons.set(id, b);
      b.addEventListener("click", () => {
        this.plugin.settings.accountBreakdownTab = id;
        void this.plugin.saveSettings();
        bdSelect(id);
      });
    }
    bdSelect(this.plugin.settings.accountBreakdownTab ?? "symbol");

    // ---- header for the treemap (groups + total) ----
    const renderTradesWidget = (host: HTMLElement) => {
      const list = () => (bdFilter ? scoped.filter((t) => bdFilter!.test(t)) : scoped);
      const head = host.createDiv({ cls: "tj-acc-tradeshead" });
      const chip = head.createDiv({ cls: "tj-acc-tchip" });
      const body = host.createDiv({ cls: "tj-acc-tradesbody" });
      const drawChip = () => {
        chip.empty();
        if (!bdFilter) return;
        chip.createSpan({ text: `Filter: ${bdFilter.label}` });
        chip
          .createEl("button", { text: "\u2715", cls: "tj-acc-tchipx", attr: { type: "button", "aria-label": "Clear filter" } })
          .addEventListener("click", () => {
            bdFilter = null;
            drawChip();
            paint();
            host.querySelectorAll(".tj-acc-brow.is-active").forEach((n) => n.removeClass("is-active"));
          });
      };
      // The same ledger the Trade Log page uses (src/lib/tradeTable): same columns,
      // same saved order, same drag. This one shows only the columns that fit a
      // single account — account, review state and prints belong to the big page.
      let sortState: { id: string; dir: "asc" | "desc" } | null = null;
      const paint = () => {
        renderTradeTable(body, {
          plugin: this.plugin,
          trades: list(),
          sort: sortState,
          onSort: (next) => { sortState = next; paint(); },
          order: resolveOrder((this.plugin.settings as any).tradeLogColOrder, ACCOUNT_TABLE_COLUMNS),
          onRowClick: (t) => void this.plugin.openTradeDetail({ id: t.id, from: { type: "account", accountId: acc.id } }),
          onReorder: (next) => {
            (this.plugin.settings as any).tradeLogColOrder = next;
            void this.plugin.saveSettings();
            paint();
          },
        });
      };
      refreshTrades = () => {
        drawChip();
        paint();
      };
      drawChip();
      paint();
    };

    // ---------- widget registry ----------
    type Widget = { id: string; title: string; span: number; available?: () => boolean; render: (host: HTMLElement) => void };
    const WIDGETS: Widget[] = [
      { id: "trades", title: `Trades in this account \u00b7 ${scoped.length}`, span: 12, render: (host) => renderTradesWidget(host) },
    ];


    // ---------- layout ----------
    const LEGACY: Record<string, string> = { symbol: "breakdowns", setup: "breakdowns", weekday: "breakdowns", hour: "breakdowns" };
    const stored = this.plugin.settings.accountWidgets;
    const base = stored && stored.length ? stored : WIDGETS.map((w) => w.id);
    const layout: string[] = [
      ...new Set(
        base
          .map((id) => LEGACY[id] ?? id)
          .filter((id) => id !== "performance" && id !== "discipline" && id !== "breakdowns" && WIDGETS.some((w) => w.id === id))
      ),
    ];
    // Every available widget is shown (there is no UI to hide them yet).
    for (const w of WIDGETS) if (!layout.includes(w.id)) layout.push(w.id);
    // Canonical order: the log sits last, so a long table never pushes a small
    // widget off screen.
    const ORDER = ["trades"];
    layout.sort((a, b) => {
      const ia = ORDER.indexOf(a);
      const ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const widgetsWrap = main.createDiv({ cls: "tj-acc-widgets" });
    const grid = widgetsWrap.createDiv({ cls: "tj-acc-wgrid" });

    const renderWidgets = () => {
      grid.empty();
      for (const id of layout) {
        const w = WIDGETS.find((x) => x.id === id);
        if (!w) continue;
        if (w.available && !w.available()) continue;
        const card = grid.createDiv({ cls: "tj-acc-widget" });
        card.style.gridColumn = `span ${w.span}`;
        const head = card.createDiv({ cls: "tj-acc-wh" });
        head.createDiv({ cls: "tj-acc-k", text: w.title });
        w.render(card);
      }
    };
    renderWidgets();

    if (size.consistency > 0 && consistencyNeed > 0 && grossProfit > 0) {
      main.createDiv({
        cls: "tj-account-note tj-account-warn",
        text: `Best day is ${consistency.toFixed(0)}% of profit — to satisfy the ${size.consistency}% consistency rule you need ${fmtMoney(consistencyNeed)} total profit.`,
      });
    }
    if (size.note) main.createDiv({ cls: "tj-account-note", text: size.note });


    // Deposits — only for personal accounts (own money)
    if (acc.type === "personal") this.renderDepositTracker(main, acc);
  }

  /** Double-warning themed delete confirmation — works inline (banner) or as an overlay. */
  /** Ask before making a funded: with several around, this must never be a slip. */
  private showFundedCreateConfirm(host: HTMLElement, acc: any, onConfirm: () => Promise<string | void> | string | void): void {
    host.querySelectorAll(".tj-delete-confirm").forEach((el) => el.remove());
    const card = host.createDiv({ cls: "tj-delete-confirm" });
    card.createDiv({ cls: "tj-delete-icon", text: "\uD83C\uDFC1" });
    card.createEl("h3", { text: "Create a funded account?" });
    card.createEl("p", { cls: "tj-delete-desc", text: `No funded account is linked to "${acc.name}" yet.` });
    card.createEl("p", { cls: "tj-delete-desc", text: "This creates one with the same firm, program and size, and links the two. If you already have that funded account, cancel instead — the band can link it." });
    const btns = card.createDiv({ cls: "tj-acc-passed-btns" });
    btns.createEl("button", { text: "Cancel", cls: "tj-btn", attr: { type: "button" } }).addEventListener("click", () => card.remove());
    btns.createEl("button", { text: "Yes, create it", cls: "tj-btn mod-cta", attr: { type: "button" } }).addEventListener("click", async () => {
      card.remove();
      const id = await onConfirm();
      if (typeof id === "string" && id) void this.plugin.openAccountDashboard(this.leaf, id);
    });
  }

  /** Point an eval at a different funded (or at none), without creating anything. */
  private showRelinkFunded(host: HTMLElement, acc: any, props: PropAccount[]): void {
    host.querySelectorAll(".tj-delete-confirm").forEach((el) => el.remove());
    const card = host.createDiv({ cls: "tj-delete-confirm" });
    card.createEl("h3", { text: "Link this eval to…" });
    card.createEl("p", { cls: "tj-delete-desc", text: "Nothing is created here — you are only choosing which funded account this eval points at." });
    const list = card.createDiv({ cls: "tj-relink-list" });
    for (const f of props.filter((a) => a.type === "funded" && a.id !== acc.id)) {
      const rowBtn = list.createEl("button", { cls: "tj-relink-row", attr: { type: "button" } });
      rowBtn.createSpan({ cls: "tj-relink-name", text: f.name });
      rowBtn.createSpan({
        cls: "tj-relink-sub",
        text: f.linkedEvalId && f.linkedEvalId !== acc.id ? "already linked to another eval" : "free",
      });
      attachTip(rowBtn, { title: f.name, sub: "Links this eval to it. No account is created, no trade is touched." });
      rowBtn.addEventListener("click", async () => {
        card.remove();
        await this.plugin.linkEvalToFunded(acc.id, f.id);
      });
    }
    const btns = card.createDiv({ cls: "tj-acc-passed-btns" });
    btns.createEl("button", { text: "Cancel", cls: "tj-btn", attr: { type: "button" } }).addEventListener("click", () => card.remove());
    const none = btns.createEl("button", { text: "No funded account", cls: "tj-btn", attr: { type: "button" } });
    attachTip(none, { title: "Unlink", sub: "Forgets the link. The funded account itself is never deleted." });
    none.addEventListener("click", async () => {
      card.remove();
      const funded = props.find((a) => a.id === acc.linkedFundedId);
      if (funded) delete funded.linkedEvalId;
      delete acc.linkedFundedId;
      await this.plugin.saveSettings();
      await this.plugin.reloadAllViews();
    });
  }

  /** One calm question before an eval in progress disappears from the views. */
  private showArchiveConfirm(host: HTMLElement, acc: any, onConfirm: () => void | Promise<void>): void {
    host.querySelectorAll(".tj-delete-confirm").forEach((el) => el.remove());
    const card = host.createDiv({ cls: "tj-delete-confirm" });
    card.createDiv({ cls: "tj-delete-icon", text: "\uD83D\uDCE6" });
    card.createEl("h3", { text: "Archive this eval?" });
    card.createEl("p", { cls: "tj-delete-desc", text: `"${acc.name}" has not reached its target yet.` });
    card.createEl("p", { cls: "tj-delete-desc", text: "Archiving keeps every trade and hides the account from the views and totals. You can restore it any time from the Accounts page." });
    const btns = card.createDiv({ cls: "tj-acc-passed-btns" });
    btns.createEl("button", { text: "Cancel", cls: "tj-btn", attr: { type: "button" } }).addEventListener("click", () => card.remove());
    btns.createEl("button", { text: "Yes, archive", cls: "tj-btn", attr: { type: "button" } }).addEventListener("click", async () => {
      card.remove();
      await onConfirm();
    });
  }

  private showDeleteConfirm(host: HTMLElement, acc: any, step: number, onConfirm?: () => void): void {
    host.querySelectorAll(".tj-delete-confirm").forEach((el) => el.remove());
    const card = host.createDiv({ cls: "tj-delete-confirm" });
    const close = () => {
      if (host.classList.contains("tj-modal-overlay")) host.remove();
      else card.remove();
    };

    if (step === 1) {
      card.createDiv({ cls: "tj-delete-icon", text: "\u26A0\uFE0F" });
      card.createEl("h3", { text: "Delete this account?" });
      card.createEl("p", { cls: "tj-delete-desc", text: `This will permanently remove "${acc.name}" from all views, metrics, and dashboards.` });
      card.createEl("p", { cls: "tj-delete-desc", text: "Payout records and deposit history will be lost." });
      card.createEl("p", { cls: "tj-delete-desc", text: "Trade files in your vault will NOT be deleted." });
      card.createEl("p", { cls: "tj-delete-hint", text: "If you want to keep the data but hide it, use Archive instead." });
      const btns = card.createDiv({ cls: "tj-acc-passed-btns" });
      btns.createEl("button", { text: "Cancel", cls: "tj-btn" }).addEventListener("click", close);
      btns.createEl("button", { text: "Yes, delete", cls: "tj-btn tj-del" }).addEventListener("click", () => {
        this.showDeleteConfirm(host, acc, 2, onConfirm);
      });
    } else {
      card.createDiv({ cls: "tj-delete-icon", text: "\uD83D\uDEA8" });
      card.createEl("h3", { text: "Final confirmation" });
      card.createEl("p", { cls: "tj-delete-desc", text: `Are you absolutely sure you want to delete "${acc.name}"?` });
      card.createEl("p", { cls: "tj-delete-desc tj-del", text: "This action CANNOT be undone. There is no way to recover this account after deletion." });
      const btns = card.createDiv({ cls: "tj-acc-passed-btns" });
      btns.createEl("button", { text: "Cancel", cls: "tj-btn" }).addEventListener("click", close);
      btns.createEl("button", { text: "I understand, delete permanently", cls: "tj-btn tj-del" }).addEventListener("click", async () => {
        if (onConfirm) { onConfirm(); }
        else {
          await this.plugin.removeAccount(acc.id);
          void this.plugin.openAccounts();
        }
      });
    }
  }

  /**
   * The payout badge: what this account has paid out, as a gold pill in the
   * header, left of the two squares. It is a number, not a door — the payouts
   * square opens the register, so the badge never competes with it.
   *
   * The count is deliberately not printed on it (a badge is one number); it lives
   * in the hover, where there is room to explain.
   */
  renderPayoutLine(host: HTMLElement, acc: PropAccount): void {
    if (acc.type !== "funded" && acc.type !== "live" && acc.type !== "personal") return;
    const payouts = this.plugin.payoutsFor(acc.id);
    if (!payouts.length) return; // Nothing out yet: the header square is the way in.

    const line = host.createDiv({ cls: "tj-acc-cashline" });
    const total = payouts.reduce((s, p) => s + p.amount, 0);
    const badge = line.createSpan({
      cls: "tj-acc-cashbadge" + (this.plugin.settings.animations === false ? " is-still" : ""),
    });
    setIcon(badge.createSpan({ cls: "tj-acc-cashbadge-ico" }), "banknote");
    badge.createSpan({ cls: "tj-acc-cashbadge-k", text: "Paid out" });
    badge.createSpan({ cls: "tj-acc-cashbadge-v", text: fmtMoneyCompact(total) });
    attachTip(badge, {
      title: `${fmtMoney(total)} paid out`,
      sub: `${payouts.length === 1 ? "1 payout" : `${payouts.length} payouts`} · last ${payouts[payouts.length - 1].date}`,
    });
  }

  renderDepositTracker(box: HTMLElement, acc: any): void {
    const deposits = this.plugin.depositsFor(acc.id);
    const totalDeposited = deposits.reduce((s, d) => s + d.amount, 0);
    const section = box.createDiv({ cls: "tj-payout-box" });
    const head = section.createDiv({ cls: "tj-payout-head" });
    head.createEl("h3", { text: `Deposits \u2014 total deposited $${totalDeposited.toLocaleString()}` });
    const addBtn = head.createEl("button", { text: "+ Add deposit", cls: "tj-btn tj-mini" });
    addBtn.addEventListener("click", () => this.showDepositForm(section, acc));

    const table = section.createEl("table", { cls: "tj-table tj-trades-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Date", "Amount", "Note", ""].forEach((h) => thead.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    if (deposits.length === 0) {
      const tr = tbody.createEl("tr");
      const td = tr.createEl("td", { attr: { colspan: "4" } });
      td.createDiv({ cls: "tj-empty", text: "No deposits recorded yet." });
    }
    for (const d of deposits) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: d.date });
      const amt = tr.createEl("td");
      amt.addClass("tj-pos");
      amt.textContent = `$${d.amount.toLocaleString()}`;
      tr.createEl("td", { text: d.note || "\u2014" });
      const del = tr.createEl("td").createEl("button", { text: "\u2715", cls: "tj-mini tj-del", attr: { "aria-label": "Remove deposit" } });
      attachTip(del, { title: "Remove deposit", sub: "Takes it off the list and out of the totals." });
      del.addEventListener("click", async () => {
        await this.plugin.removeDeposit(d.id);
        this.render();
      });
    }
  }

  showDepositForm(section: HTMLElement, acc: any): void {
    const form = section.createDiv({ cls: "tj-payout-form" });
    const row = form.createDiv({ cls: "tj-form-row" });
    row.createEl("label", { text: "Date" });
    let depositDate = this.todayKey();
    mountDateField(row, {
      value: depositDate,
      format: this.plugin.settings.dateFormat,
      className: "tj-input",
      onChange: (iso) => (depositDate = iso),
    });
    row.createEl("label", { text: "Amount ($)" });
    const amountInput = row.createEl("input", { type: "number", cls: "tj-input", attr: { min: "1", step: "1", placeholder: "5000" } });
    row.createEl("label", { text: "Note (optional)" });
    const noteInput = row.createEl("input", { type: "text", cls: "tj-input", attr: { placeholder: "e.g. Initial deposit" } });
    const save = row.createEl("button", { text: "Save deposit", cls: "mod-cta tj-btn" });
    save.addEventListener("click", async () => {
      const parsed = parseFloat(amountInput.value);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      const amount = Math.round(parsed);
      const date = depositDate || this.todayKey();
      await this.plugin.registerDeposit(acc.id, date, amount, noteInput.value.trim() || undefined);
      form.remove();
      this.render();
    });
    const cancel = row.createEl("button", { text: "Cancel", cls: "tj-btn tj-mini" });
    cancel.addEventListener("click", () => form.remove());
  }

  /** Hour label like "9am" / "2pm" (used by the discipline card). */
  private hourLabel(h: number): string {
    const suffix = h < 12 ? "am" : "pm";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${suffix}`;
  }

  /** Hour bucket label for a trade (used by the "By hour" widget). */
  private hourBlockOf(t: Trade): string {
    const m = /^(\d{1,2}):/.exec(t.entryTime || "");
    return m ? this.hourLabel(parseInt(m[1], 10)) : "—";
  }

  /** Weekday label for a trade (used by the breakdown bars). */
  private weekdayOf(t: Trade): string {
    const d = this.dayKey(t);
    const [y, m, day] = d.split("-").map(Number);
    return WEEKDAYS[new Date(y, m - 1, day).getDay()] ?? "—";
  }
}
