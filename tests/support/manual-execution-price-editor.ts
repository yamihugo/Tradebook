import { TradeDetailView } from "../../src/views/tradeDetailView";
import { TFile } from "obsidian";
import { parseTradeFromMarkdown, tradeToMarkdown } from "../../src/storage";

Object.assign(HTMLElement.prototype, {
  createEl(this: HTMLElement, tag: string, options: any = {}) {
    const el = document.createElement(tag);
    if (options.cls) el.className = options.cls;
    if (options.text) el.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, String(value));
    this.append(el);
    return el;
  },
  createDiv(this: HTMLElement, options: any = {}) { return this.createEl("div", options); },
  createSpan(this: HTMLElement, options: any = {}) { return this.createEl("span", options); },
  setText(this: HTMLElement, text: string) { this.textContent = text; },
  setAttr(this: HTMLElement, name: string, value: string) { this.setAttribute(name, value); },
  setAttrs(this: HTMLElement, attrs: Record<string, string>) { for (const [name, value] of Object.entries(attrs)) this.setAttribute(name, value); },
  toggleClass(this: HTMLElement, name: string, on: boolean) { this.classList.toggle(name, on); },
  addClass(this: HTMLElement, ...names: string[]) { this.classList.add(...names); },
  removeClass(this: HTMLElement, ...names: string[]) { this.classList.remove(...names); },
  empty(this: HTMLElement) { this.replaceChildren(); },
  setCssStyles(this: HTMLElement, styles: object) { Object.assign(this.style, styles); },
  setCssProps(this: HTMLElement, styles: Record<string, string>) { for (const [name, value] of Object.entries(styles)) this.style.setProperty(name, value); },
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const notices = () => (window as Window & { testNotices?: string[] }).testNotices ?? [];
function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
  element.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function editFields(root: HTMLElement, edits: Array<[string, string]>): boolean {
  for (const [label, value] of edits) {
    const target = root.querySelector<HTMLElement>(`[aria-label="Edit ${label}"]`);
    if (!target) return false;
    target.click();
    const input = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (!input) return false;
    setValue(input, value);
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }
  return true;
}

async function runManualExecutionPriceEditScenario() {
  document.body.replaceChildren();
  let content = "";
  const file = Object.assign(new TFile(), { path: "Synthetic/Manual trade.md", extension: "md" });
  const original = {
    id: file.path,
    date: "2026-11-06",
    entryTime: "10:00:00",
    exitTime: "10:01:00",
    symbol: "MES",
    account: "Synthetic",
    accountType: "funded",
    direction: "long",
    quantity: 1,
    entryPrice: 100,
    exitPrice: 101,
    pnl: 5,
    pnlPoints: 1,
    commission: 2,
    fees: 1,
    setup: "",
    mistake: "",
    review: "",
    thesis: "",
    screenshot: "",
    rating: 0,
    origin: "manual",
    dataSource: "manual",
  } as any;
  content = tradeToMarkdown(original) + "\nPrivate synthetic annotation\n";
  const loadTrades = async () => [{ ...(parseTradeFromMarkdown(content) as any), id: file.path }];
  const app: any = {
    vault: {
      getAbstractFileByPath: (path: string) => path === file.path ? file : null,
      process: async (_file: unknown, change: (text: string) => string) => { content = change(content); },
      adapter: { exists: async () => false },
    },
    metadataCache: { getFirstLinkpathDest: () => null },
  };
  const plugin: any = {
    app,
    settings: { timeZone: "UTC", setups: [], propAccounts: [], reviewOptions: { psychology: [], mistakes: [] } },
    loadTrades,
    loadTradesExpanded: loadTrades,
    knownSetups: async () => [],
    mappedAccount: () => null,
  };
  const root = document.body.createDiv({ cls: "view-content" }).createDiv();
  const view: any = new TradeDetailView({ app, contentEl: root } as any, plugin);
  view.app = app;
  view.trade = (await loadTrades())[0];
  view.allTrades = [view.trade];
  view.index = 0;
  view.setupOptions = [];
  view.render();

  const editButton = [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Edit executions");
  if (!editButton) return { editButtonFound: false, notices: notices() };
  editButton.click();
  const edited = editFields(root, [
    ["Execution 1 date", "2026-11-06"], ["Execution 1 time", "10:00"],
    ["Execution 1 quantity", "1"], ["Execution 1 price", "99"],
    ["Execution 2 date", "2026-11-07"], ["Execution 2 time", "10:04"],
    ["Execution 2 quantity", "1"], ["Execution 2 price", "102"],
  ]);
  if (!edited) {
    return { editButtonFound: true, executionInputsFound: false, notices: notices() };
  }
  const saveButton = [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save executions");
  if (!saveButton) return { editButtonFound: true, executionInputsFound: true, saveButtonFound: false, notices: notices() };
  saveButton.click();
  for (let i = 0; i < 10 && (view.trade?.entryPrice !== 99 || view.trade?.exitPrice !== 102); i++) await tick();

  const saved = parseTradeFromMarkdown(content) as any;
  const reopenedRoot = document.body.createDiv({ cls: "view-content" }).createDiv();
  const reopened: any = new TradeDetailView({ app, contentEl: reopenedRoot } as any, plugin);
  await reopened.onOpen();
  const brokerRoot = document.body.createDiv({ cls: "view-content" }).createDiv();
  const brokerView: any = new TradeDetailView({ app, contentEl: brokerRoot } as any, plugin);
  brokerView.trade = { ...original, origin: "broker", dataSource: "broker" };
  brokerView.allTrades = [brokerView.trade];
  brokerView.index = 0;
  brokerView.render();
  const brokerEditVisible = [...brokerRoot.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Edit executions");
  const result = {
    editButtonFound: true,
    executionInputsFound: true,
    saveButtonFound: true,
    savedEntryDate: saved.date,
    savedEntryTime: saved.entryTime,
    savedExitDate: saved.exitDate,
    savedExitTime: saved.exitTime,
    savedEntry: saved.entryPrice,
    savedExit: saved.exitPrice,
    savedPnl: saved.pnl,
    savedPnlPoints: saved.pnlPoints,
    savedCommission: saved.commission,
    savedFees: saved.fees,
    savedFillCount: Array.isArray(saved.fills) ? saved.fills.length : 0,
    savedOrigin: saved.origin,
    savedDataSource: saved.dataSource,
    reopenedEntry: reopened.trade?.entryPrice,
    reopenedExit: reopened.trade?.exitPrice,
    reopenedPnl: reopened.trade?.pnl,
    reopenedEntryDate: reopened.trade?.date,
    reopenedEntryTime: reopened.trade?.entryTime,
    reopenedExitDate: reopened.trade?.exitDate,
    reopenedExitTime: reopened.trade?.exitTime,
    brokerEditVisible,
    annotationPreserved: content.includes("Private synthetic annotation"),
    notices: notices(),
  };
  await view.onClose();
  await reopened.onClose();
  return result;
}

async function runExecutionEditorScenario() {
  document.body.replaceChildren();
  let content = "";
  const file = Object.assign(new TFile(), { path: "Synthetic/Replay trade.md", extension: "md" });
  const original = {
    id: file.path,
    date: "2026-11-06",
    exitDate: "2026-11-06",
    entryTime: "10:00:00",
    exitTime: "10:02:00",
    symbol: "MES",
    account: "Synthetic Replay",
    accountType: "demo",
    direction: "long",
    quantity: 4,
    entryPrice: 100,
    exitPrice: 101.5,
    pnl: 30,
    pnlPoints: 1.5,
    commission: 2,
    fees: 1,
    setup: "",
    mistake: "",
    review: "",
    thesis: "",
    screenshot: "",
    rating: 0,
    origin: "replay",
    dataSource: "replay",
    timezone: "America/Chicago",
    instantSource: "journal-zone",
    importKey: "replay:synthetic-stable-key",
    fills: [
      { side: "buy", date: "2026-11-06", time: "10:00:00", qty: 4, price: 100, orderType: "Limit", fillId: "entry-1" },
      { side: "sell", date: "2026-11-06", time: "10:01:00", qty: 2, price: 101, orderType: "Market", fillId: "exit-1" },
      { side: "sell", date: "2026-11-06", time: "10:02:00", qty: 2, price: 102, orderType: "Market", fillId: "exit-2" },
    ],
  } as any;
  content = tradeToMarkdown(original) + "\nPrivate synthetic annotation\n";
  const loadTrades = async () => [{ ...(parseTradeFromMarkdown(content) as any), id: file.path }];
  const app: any = {
    vault: {
      getAbstractFileByPath: (path: string) => path === file.path ? file : null,
      process: async (_file: unknown, change: (text: string) => string) => { content = change(content); },
      adapter: { exists: async () => false },
    },
    metadataCache: { getFirstLinkpathDest: () => null },
  };
  const plugin: any = {
    app,
    settings: { timeZone: "America/New_York", setups: [], propAccounts: [], reviewOptions: { psychology: [], mistakes: [] } },
    loadTrades,
    loadTradesExpanded: loadTrades,
    knownSetups: async () => [],
    mappedAccount: () => null,
  };
  const root = document.body.createDiv({ cls: "view-content" }).createDiv();
  const view: any = new TradeDetailView({ app, contentEl: root } as any, plugin);
  view.app = app;
  view.trade = (await loadTrades())[0];
  view.allTrades = [view.trade];
  view.index = 0;
  view.setupOptions = [];
  view.render();

  const editButton = [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Edit executions");
  if (!editButton) {
    await view.onClose();
    return { editButtonFound: false };
  }
  editButton.click();
  const edited = editFields(root, [
    ["Execution 1 date", "2026-11-07"], ["Execution 1 time", "23:58"],
    ["Execution 1 quantity", "4"], ["Execution 1 price", "100"],
    ["Execution 2 date", "2026-11-07"], ["Execution 2 time", "23:59"],
    ["Execution 2 quantity", "1"], ["Execution 2 price", "101"],
    ["Execution 3 date", "2026-11-08"], ["Execution 3 time", "00:03"],
    ["Execution 3 quantity", "3"], ["Execution 3 price", "102"],
  ]);
  if (!edited) {
    await view.onClose();
    return { editButtonFound: true, executionInputsFound: false };
  }
  const correctionZoneNote = root.querySelector(".tj-td-execution-edit-status")?.textContent;
  const saveButton = [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save executions");
  if (!saveButton) {
    await view.onClose();
    return { editButtonFound: true, executionInputsFound: true, saveButtonFound: false };
  }
  saveButton.click();
  for (let i = 0; i < 10 && (view.trade?.date !== "2026-11-07" || view.trade?.exitDate !== "2026-11-08"); i++) await tick();
  const saved = parseTradeFromMarkdown(content) as any;
  const reopenedRoot = document.body.createDiv({ cls: "view-content" }).createDiv();
  const reopened: any = new TradeDetailView({ app, contentEl: reopenedRoot } as any, plugin);
  await reopened.onOpen();
  const result = {
    editButtonFound: true,
    executionInputsFound: true,
    saveButtonFound: true,
    savedEntryDate: saved.date,
    savedEntryTime: saved.entryTime,
    savedExitDate: saved.exitDate,
    savedExitTime: saved.exitTime,
    savedQuantity: saved.quantity,
    savedExitPrice: saved.exitPrice,
    savedPnl: saved.pnl,
    savedPnlPoints: saved.pnlPoints,
    savedImportKey: saved.importKey,
    savedOrigin: saved.origin,
    savedDataSource: saved.dataSource,
    fillIds: saved.fills?.map((fill: any) => fill.fillId),
    journalResolved: saved.timezone === "America/New_York" && saved.instantSource === "journal-zone" && saved.fills?.every((fill: any) => !!fill.instant),
    correctionZoneNote,
    entryInstant: saved.fills?.[0]?.instant,
    exitInstant: saved.fills?.[2]?.instant,
    annotationPreserved: content.includes("Private synthetic annotation"),
    reopenedEntryDate: reopened.trade?.date,
    reopenedExitDate: reopened.trade?.exitDate,
    reopenedEntryTime: reopened.trade?.entryTime,
    reopenedExitTime: reopened.trade?.exitTime,
  };
  await view.onClose();
  await reopened.onClose();
  return result;
}

async function runAddedPartialCloseScenario() {
  document.body.replaceChildren();
  let content = "";
  const file = Object.assign(new TFile(), { path: "Synthetic/Open Replay trade.md", extension: "md" });
  const original = {
    id: file.path,
    date: "2026-11-06",
    entryTime: "10:00:00",
    exitTime: "",
    symbol: "MES",
    account: "Synthetic Replay",
    accountType: "demo",
    direction: "long",
    quantity: 4,
    entryPrice: 100,
    exitPrice: 0,
    pnl: Number.NaN,
    pnlPoints: Number.NaN,
    commission: 0,
    fees: 0,
    setup: "",
    mistake: "",
    review: "",
    thesis: "",
    screenshot: "",
    rating: 0,
    origin: "replay",
    dataSource: "replay",
    importKey: "replay:synthetic-open-key",
    fills: [{ side: "buy", date: "2026-11-06", time: "10:00:00", qty: 4, price: 100, fillId: "entry-open" }],
  } as any;
  content = tradeToMarkdown(original) + "\nOpen synthetic annotation\n";
  const loadTrades = async () => [{ ...(parseTradeFromMarkdown(content) as any), id: file.path }];
  const app: any = {
    vault: {
      getAbstractFileByPath: (path: string) => path === file.path ? file : null,
      process: async (_file: unknown, change: (text: string) => string) => { content = change(content); },
      adapter: { exists: async () => false },
    },
    metadataCache: { getFirstLinkpathDest: () => null },
  };
  const plugin: any = {
    app,
    settings: { timeZone: "UTC", setups: [], propAccounts: [], reviewOptions: { psychology: [], mistakes: [] } },
    loadTrades,
    loadTradesExpanded: loadTrades,
    knownSetups: async () => [],
    mappedAccount: () => null,
  };
  const root = document.body.createDiv({ cls: "view-content" }).createDiv();
  const view: any = new TradeDetailView({ app, contentEl: root } as any, plugin);
  view.app = app;
  view.trade = (await loadTrades())[0];
  view.allTrades = [view.trade];
  view.index = 0;
  view.setupOptions = [];
  view.render();

  const editButton = [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Edit executions");
  if (!editButton) {
    await view.onClose();
    return { editButtonFound: false };
  }
  editButton.click();
  const addButton = [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Add execution");
  if (!addButton) {
    await view.onClose();
    return { editButtonFound: true, addButtonFound: false };
  }
  addButton.click();
  const edited = editFields(root, [
    ["Execution 2 date", "2026-11-06"], ["Execution 2 time", "10:01"],
    ["Execution 2 quantity", "2"], ["Execution 2 price", "101"],
  ]);
  if (!edited) {
    await view.onClose();
    return { editButtonFound: true, addButtonFound: true, newRowFound: false };
  }
  const saveButton = [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save executions");
  if (!saveButton) {
    await view.onClose();
    return { editButtonFound: true, addButtonFound: true, newRowFound: true, saveButtonFound: false };
  }
  saveButton.click();
  for (let i = 0; i < 10 && view.trade?.pnl !== 10; i++) await tick();
  const saved = parseTradeFromMarkdown(content) as any;
  const result = {
    editButtonFound: true,
    addButtonFound: true,
    newRowFound: true,
    saveButtonFound: true,
    savedFillCount: saved.fills?.length ?? 0,
    savedOpenDate: saved.date,
    savedExitDate: saved.exitDate,
    savedExitTime: saved.exitTime,
    savedQuantity: saved.quantity,
    savedPnl: saved.pnl,
    savedImportKey: saved.importKey,
    savedEntryFillId: saved.fills?.[0]?.fillId,
    newFillIdAbsent: !saved.fills?.[1]?.fillId,
    journalResolved: saved.timezone === "UTC" && saved.instantSource === "journal-zone" && saved.fills?.every((fill: any) => !!fill.instant),
    annotationPreserved: content.includes("Open synthetic annotation"),
  };
  await view.onClose();
  return result;
}

Object.assign(window, { runManualExecutionPriceEditScenario, runExecutionEditorScenario, runAddedPartialCloseScenario });
