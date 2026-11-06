import { ItemView, Modal, Notice, TFile, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import type TradebookPlugin from "../main";
import {
  deletePrintInboxEntry,
  listPrintInboxEntries,
  savePrintInboxEntry,
  type PrintInboxEntry,
  type PrintInboxSource,
} from "../lib/printInbox";
import {
  addEntryToGroup,
  createPrintGroup,
  deletePrintGroup,
  listPrintGroups,
  loadPrintGroup,
  moveEntryToGroup,
  nextPrintGroupOrdinal,
  printGroupOrdinal,
  removeEntryFromGroup,
  reorderGroupEntries,
  routeCapture,
  setActiveGroup,
  updatePrintGroupDetails,
  type PrintGroup,
} from "../lib/printGroup";
import {
  makePrintGroupDragPayload,
  PRINT_GROUP_MIME,
} from "../lib/printGroupAttach";
import { dateInZone } from "../lib/periods";
import { detectSystemZone, localToUtc, zoneShortLabel, zoneWallParts } from "../tz";

export const PRINT_QUEUE_VIEW_TYPE = "tradebook-print-queue";
const PRINT_ENTRY_MIME = "application/x-tradebook-print-entry";

function splitLegacyGroupTime(name: string): { name: string; time?: string } {
  const match = /^(.*?)\s+[·•]\s+((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(name.trim());
  if (!match || !match[1].trim()) return { name: name.trim() };
  return { name: match[1].trim(), time: match[2] };
}

function isJournalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function formatQueueDate(value: string): string {
  if (!isJournalDate(value)) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

export class PrintQueueView extends ItemView {
  plugin: TradebookPlugin;
  private entries: PrintInboxEntry[] = [];
  private groups: PrintGroup[] = [];
  private selectedId = "";
  private listEl: HTMLElement | null = null;
  private liveStatusEl: HTMLElement | null = null;
  private previousDaysOpen = false;
  /**
   * The hovered/focused group card is the capture target for the next paste,
   * drop or file pick — it overrides the global active group for that one
   * capture only. Empty while no card is hovered/focused, in which case the
   * container listeners fall back to the global active group (queue-level
   * behaviour preserved unchanged).
   */
  private captureTargetGroupId = "";
  private pickerEl: HTMLInputElement | null = null;
  private pickerTargetGroupId = "";
  private _captureAttached = false;
  private handledPasteEvents = new WeakSet<Event>();
  private handledDropEvents = new WeakSet<Event>();
  private reorderInFlight = new Set<string>();
  private moveInFlight = new Set<string>();

  constructor(leaf: WorkspaceLeaf, plugin: TradebookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return PRINT_QUEUE_VIEW_TYPE; }
  getDisplayText(): string { return "Print queue"; }
  getIcon(): string { return "images"; }

  async onOpen(): Promise<void> {
    this.render();
    // Paste / drop listeners live on the side-panel container so Ctrl+V works
    // anywhere in the active Print Queue, including the empty state. They are
    // attached from render() (idempotent) rather than registerDomEvent so the
    // harness can drive them through the stub container; in production the
    // element is torn down with the leaf.
    this.attachCaptureListeners();
    const queueRoot = `${this.plugin.getTradesFolder()}/print-inbox/`;
    const groupRoot = `print-groups/`;
    const refreshForQueueFile = (file: { path: string }): void => {
      if (file.path.startsWith(queueRoot) || file.path.startsWith(groupRoot)) void this.refresh();
    };
    this.registerEvent(this.plugin.app.vault.on("create", refreshForQueueFile));
    this.registerEvent(this.plugin.app.vault.on("modify", refreshForQueueFile));
    this.registerEvent(this.plugin.app.vault.on("delete", refreshForQueueFile));
    this.registerEvent(this.plugin.app.vault.on("rename", refreshForQueueFile));
    await this.refresh();
  }

  async onClose(): Promise<void> {
    document.removeEventListener("paste", this.onPaste, true);
  }

  async refresh(): Promise<void> {
    try {
      this.entries = await listPrintInboxEntries(this.plugin.app, this.plugin.getTradesFolder());
      this.groups = await listPrintGroups(this.plugin.app, "");
      if (this.selectedId && !this.entries.some((entry) => entry.id === this.selectedId)) this.selectedId = "";
    } catch (error) {
      console.error("[tradebook] failed to load Print Queue", error);
      new Notice("Could not load the print queue.");
    }
    this.render();
  }

  /**
   * Attach the paste / drop capture listeners to the side-panel container.
   *
   * Idempotent: the same element is re-used across renders, so re-attaching a
   * listener would stack handlers. The flag guards against that, and the
   * listeners are torn down with the leaf (Obsidian's containerEl lifecycle).
   */
  private attachCaptureListeners(): void {
    if (this._captureAttached) return;
    this._captureAttached = true;
    this.containerEl.addEventListener("paste", this.onPaste, true);
    // Obsidian often keeps keyboard focus in the workspace chrome rather than
    // inside the side panel. Listen at document level as well so Ctrl+V still
    // reaches the active Print Queue when the pointer is over a lane.
    document.addEventListener("paste", this.onPaste, true);
    this.containerEl.addEventListener("dragover", this.onDragOver, true);
    this.containerEl.addEventListener("dragleave", this.onDragLeave, true);
    this.containerEl.addEventListener("drop", this.onDrop, true);
  }

  private onDragOver = (event: DragEvent): void => {
    event.preventDefault();
    this.contentEl.addClass("tj-print-inbox-dragging");
  };

  private onDragLeave = (): void => {
    this.contentEl.removeClass("tj-print-inbox-dragging");
  };

  private render(): void {
    const root = this.contentEl;
    const scrollTop = this.listEl?.scrollTop || 0;
    root.empty();
    root.addClass("tj-print-inbox");
    this.liveStatusEl = root.createDiv({
      cls: "tj-print-inbox-status",
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });

    // Hidden file chooser: the fallback surface for "Choose print" and for
    // each lane's choose-file action. It is display:none in CSS, never a
    // visible control, and always present so the actions can trigger it
    // without a null check.
    const picker = root.createEl("input", { cls: "tj-print-inbox-picker", attr: { type: "file", accept: "image/*", multiple: "true" } });
    this.pickerEl = picker;
    picker.addEventListener("change", () => {
      const files = picker.files ? Array.from(picker.files) : [];
      picker.value = "";
      const targetGroupId = this.pickerTargetGroupId;
      this.pickerTargetGroupId = "";
      void this.saveFiles(files, "file", targetGroupId);
    });

    const pendingGroups = this.groups.filter((g) => g.state !== "attached");
    const groupedEntryIds = new Set(this.groups.flatMap((g) => g.entryIds));
    const ungroupedEntries = this.entries.filter((e) => !groupedEntryIds.has(e.id));

    if (!pendingGroups.length && !ungroupedEntries.length) {
      this.listEl = null;
      this.renderEmpty(root);
      return;
    }

    const list = root.createDiv({ cls: "tj-print-inbox-list" });
    this.listEl = list;
    this.renderList();
    list.scrollTop = scrollTop;
  }

  /**
   * The empty queue is deliberately two actions and nothing else: paste from
   * the clipboard or choose a file. The first capture creates the first lane
   * automatically, so there is no "create a group" step to explain.
   */
  private renderEmpty(parent: HTMLElement): void {
    const empty = parent.createDiv({ cls: "tj-print-inbox-empty" });
    const brand = empty.createDiv({ cls: "tj-print-inbox-empty-brand" });
    const icon = brand.createSpan({ cls: "tj-print-inbox-empty-icon" });
    setIcon(icon, "images");
    brand.createEl("h2", { cls: "tj-print-inbox-empty-title", text: "Print Queue" });
    empty.createDiv({
      cls: "tj-print-inbox-empty-hint",
      text: "A simple place to keep your live-market chart prints.",
    });
    const actions = empty.createDiv({ cls: "tj-print-inbox-empty-actions" });
    const paste = actions.createEl("button", {
      cls: "tj-print-inbox-paste",
      attr: { type: "button" },
      text: "Paste clipboard",
    });
    paste.addEventListener("click", () => void this.pasteFromClipboard());
    const choose = actions.createEl("button", {
      cls: "tj-print-inbox-choose",
      attr: { type: "button" },
      text: "Choose print",
    });
    choose.addEventListener("click", () => this.openPicker());
  }

  private openPicker(groupId = ""): void {
    this.pickerTargetGroupId = groupId;
    if (!this.pickerEl) return;
    this.pickerEl.value = "";
    this.pickerEl.click();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    const pendingGroups = this.pendingLanes();
    // Legacy ungrouped entries remain untouched; their journal date supplies the day section.
    const groupedEntryIds = new Set(this.groups.flatMap((group) => group.entryIds));
    const ungroupedEntries = this.entries.filter((entry) => !groupedEntryIds.has(entry.id));
    const today = dateInZone(this.journalTimeZone());
    const previousDates = this.queueDates(
      pendingGroups.filter((group) => isJournalDate(group.journalDate) && group.journalDate < today).map((group) => group.journalDate),
      ungroupedEntries.filter((entry) => isJournalDate(entry.journalDate) && entry.journalDate < today).map((entry) => entry.journalDate),
    ).sort((a, b) => b.localeCompare(a));
    // The queue can be reset in one action without touching attached trades.
    if (pendingGroups.length || this.entries.length) this.renderQueueActions(this.listEl, pendingGroups);
    this.renderQueueDay(
      this.listEl,
      today,
      pendingGroups.filter((group) => group.journalDate === today),
      ungroupedEntries.filter((entry) => entry.journalDate === today),
      true,
    );

    const futureDates = this.queueDates(
      pendingGroups.filter((group) => isJournalDate(group.journalDate) && group.journalDate > today).map((group) => group.journalDate),
      ungroupedEntries.filter((entry) => isJournalDate(entry.journalDate) && entry.journalDate > today).map((entry) => entry.journalDate),
    ).sort((a, b) => a.localeCompare(b));
    if (futureDates.length) {
      const otherDays = this.listEl.createDiv({ cls: "tj-print-inbox-other-days" });
      otherDays.createDiv({ cls: "tj-print-inbox-section-heading", text: "Other dates" });
      for (const date of futureDates) {
        this.renderQueueDay(
          otherDays,
          date,
          pendingGroups.filter((group) => group.journalDate === date),
          ungroupedEntries.filter((entry) => entry.journalDate === date),
        );
      }
    }

    if (previousDates.length) {
      const previousGroups = pendingGroups.filter((group) => previousDates.includes(group.journalDate));
      const previousEntries = ungroupedEntries.filter((entry) => previousDates.includes(entry.journalDate));
      const previousPrintCount = this.queuedPrintCount(previousGroups, previousEntries);
      const older = this.listEl.createEl("details", { cls: "tj-print-inbox-previous-days" });
      older.open = this.previousDaysOpen;
      older.addEventListener("toggle", () => { this.previousDaysOpen = older.open; });
      const summary = older.createEl("summary", { cls: "tj-print-inbox-previous-days-summary" });
      summary.createSpan({
        text: `Previous days · ${previousGroups.length} ${previousGroups.length === 1 ? "group" : "groups"} · ${previousPrintCount} ${previousPrintCount === 1 ? "print" : "prints"} · oldest ${formatQueueDate(previousDates[previousDates.length - 1])}`,
      });
      const content = older.createDiv({ cls: "tj-print-inbox-previous-days-content" });
      if (previousPrintCount > 0) {
        const actions = content.createDiv({ cls: "tj-print-inbox-previous-days-actions" });
        const clearPrevious = actions.createEl("button", {
          cls: "tj-mini tj-print-inbox-clear-previous",
          attr: { type: "button", "aria-label": "Clear queued prints from previous days only" },
        });
        setIcon(clearPrevious, "trash-2");
        clearPrevious.createSpan({ text: "Clear previous days" });
        clearPrevious.addEventListener("click", () => void this.clearPreviousDays());
      }
      for (const date of previousDates) {
        this.renderQueueDay(
          content,
          date,
          pendingGroups.filter((group) => group.journalDate === date),
          ungroupedEntries.filter((entry) => entry.journalDate === date),
        );
      }
    }

    const undatedGroups = pendingGroups.filter((group) => !isJournalDate(group.journalDate));
    const undatedEntries = ungroupedEntries.filter((entry) => !isJournalDate(entry.journalDate));
    if (undatedGroups.length || undatedEntries.length) {
      this.renderQueueDay(this.listEl, "", undatedGroups, undatedEntries);
    }
    if (this.selectedId) this.updateSelectedMoveMenus();
  }

  private queueDates(...dateLists: string[][]): string[] {
    return [...new Set(dateLists.flat())];
  }

  private queuedPrintCount(groups: PrintGroup[], entries: PrintInboxEntry[]): number {
    const queuedEntryIds = new Set(this.entries.map((entry) => entry.id));
    return groups.reduce(
      (count, group) => count + new Set(group.entryIds.filter((entryId) => queuedEntryIds.has(entryId))).size,
      0,
    ) + entries.length;
  }

  private renderQueueDay(
    parent: HTMLElement,
    date: string,
    groups: PrintGroup[],
    entries: PrintInboxEntry[],
    current = false,
  ): HTMLElement {
    const day = parent.createDiv({
      cls: `tj-print-inbox-day${current ? " tj-print-inbox-current-day" : ""}${!date ? " tj-print-inbox-undated-day" : ""}`,
    });
    if (date) day.setAttr("data-journal-date", date);
    const heading = day.createDiv({ cls: "tj-print-inbox-day-heading" });
    const groupCount = `${groups.length} ${groups.length === 1 ? "group" : "groups"}`;
    const dayPrintCount = this.queuedPrintCount(groups, entries);
    const printCount = `${dayPrintCount} ${dayPrintCount === 1 ? "print" : "prints"}`;
    heading.setText(current
      ? `Today · ${formatQueueDate(date)}`
      : `${formatQueueDate(date)} · ${groupCount} · ${printCount}`);
    for (const group of groups) {
      this.renderGroup(day, group, Math.max(1, this.groups.indexOf(group) + 1));
    }
    if (current) this.renderNewLane(day);
    if (entries.length) {
      const orderedEntries = [...entries].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
      this.renderUnsorted(day, orderedEntries);
    }
    return day;
  }

  private renderQueueActions(parent: HTMLElement, pendingGroups: PrintGroup[]): void {
    const actions = parent.createDiv({ cls: "tj-print-inbox-queue-actions" });
    const clear = actions.createEl("button", {
      cls: "tj-mini tj-print-inbox-clear-all",
      attr: { type: "button", "aria-label": "Clear all queued prints from all dates" },
    });
    setIcon(clear, "trash-2");
    clear.createSpan({ text: "Clear all" });
    clear.addEventListener("click", () => void this.clearAll(pendingGroups));
  }

  private async clearAll(pendingGroups: PrintGroup[]): Promise<void> {
    new ClearPrintQueueModal(this.app, () => void this.performClearAll(pendingGroups)).open();
  }

  private async clearPreviousDays(): Promise<void> {
    new ClearPrintQueueModal(this.app, () => void this.performClearPreviousDays(), "previous-days").open();
  }

  private async performClearAll(_pendingGroups: PrintGroup[]): Promise<void> {
    try {
      const base = "";
      // Confirmation can stay open while a group is filed elsewhere. Work from
      // current ownership, never the modal's original pending-group snapshot.
      const groups = await listPrintGroups(this.plugin.app, base);
      const pendingGroups = groups.filter((group) => group.state !== "attached");
      const entries = await listPrintInboxEntries(this.plugin.app, this.plugin.getTradesFolder());
      const pendingIds = new Set(pendingGroups.flatMap((group) => group.entryIds));
      const groupedIds = new Set(groups.flatMap((group) => group.entryIds));
      const attachedIds = new Set(groups.filter((group) => group.state === "attached").flatMap((group) => group.entryIds));
      for (const group of pendingGroups) {
        for (const entryId of new Set(group.entryIds)) {
          await removeEntryFromGroup(this.plugin.app, base, group.id, entryId);
        }
      }
      for (const entry of entries) {
        if (!attachedIds.has(entry.id) && (pendingIds.has(entry.id) || !groupedIds.has(entry.id))) {
          await deletePrintInboxEntry(this.plugin.app, this.plugin.getTradesFolder(), entry);
        }
      }
      for (const group of pendingGroups) await deletePrintGroup(this.plugin.app, base, group.id);
      this.selectedId = "";
      await this.refresh();
      new Notice("Print Queue cleared.");
    } catch (error) {
      console.error("[tradebook] failed to clear print queue", error);
      new Notice("Could not clear the Print Queue.");
    }
  }

  private async performClearPreviousDays(): Promise<void> {
    try {
      const base = "";
      const today = dateInZone(this.journalTimeZone());
      // Re-read queue ownership when the confirmation is accepted. Items moved
      // to a current-day or attached group while the modal was open are spared.
      const groups = await listPrintGroups(this.plugin.app, base);
      const previousGroups = groups.filter((group) =>
        group.state !== "attached" && isJournalDate(group.journalDate) && group.journalDate < today);
      const entries = await listPrintInboxEntries(this.plugin.app, this.plugin.getTradesFolder());
      const previousGroupIds = new Set(previousGroups.flatMap((group) => group.entryIds));
      const groupedIds = new Set(groups.flatMap((group) => group.entryIds));
      const attachedIds = new Set(groups.filter((group) => group.state === "attached").flatMap((group) => group.entryIds));
      const entriesToTrash = entries.filter((entry) =>
        !attachedIds.has(entry.id)
        && (previousGroupIds.has(entry.id)
          || (!groupedIds.has(entry.id) && isJournalDate(entry.journalDate) && entry.journalDate < today)));
      const trashedIds = new Set(entriesToTrash.map((entry) => entry.id));

      for (const group of previousGroups) {
        for (const entryId of new Set(group.entryIds)) {
          await removeEntryFromGroup(this.plugin.app, base, group.id, entryId);
        }
      }
      for (const entry of entriesToTrash) {
        await deletePrintInboxEntry(this.plugin.app, this.plugin.getTradesFolder(), entry);
      }
      for (const group of previousGroups) await deletePrintGroup(this.plugin.app, base, group.id);
      if (trashedIds.has(this.selectedId)) this.selectedId = "";
      await this.refresh();
      new Notice("Previous days cleared.");
    } catch (error) {
      console.error("[tradebook] failed to clear previous queue days", error);
      new Notice("Could not clear previous days.");
    }
  }

  private renderNewLane(parent: HTMLElement): void {
    const newLane = parent.createEl("button", {
      cls: "tj-mini tj-print-inbox-new-lane",
      attr: { type: "button", "aria-label": "Start a new print group" },
    });
    setIcon(newLane, "plus");
    newLane.createSpan({ text: "New group" });
    newLane.addEventListener("click", () => void this.addTrade());
  }

  /**
   * Sort pending groups by original journal date, then displayed queue time.
   * Ties and untimed groups retain stable ordinal/creation order.
   */
  private pendingLanes(): PrintGroup[] {
    const today = dateInZone(this.journalTimeZone());
    return this.groups
      .filter((group) => group.state !== "attached")
      .map((group, index) => ({ group, index, ordinal: this.laneOrdinal(group, index + 1), time: this.laneTime(group) }))
      .sort((a, b) => {
        const dateBucket = (date: string): number => {
          if (!isJournalDate(date)) return 3;
          if (date === today) return 0;
          return date > today ? 1 : 2;
        };
        const aBucket = dateBucket(a.group.journalDate);
        const bBucket = dateBucket(b.group.journalDate);
        if (aBucket !== bBucket) return aBucket - bBucket;
        if (a.group.journalDate !== b.group.journalDate) {
          if (aBucket === 2) return b.group.journalDate.localeCompare(a.group.journalDate);
          return a.group.journalDate.localeCompare(b.group.journalDate);
        }
        if (a.time && b.time && a.time !== b.time) return a.time.localeCompare(b.time);
        if (a.time && !b.time) return -1;
        if (!a.time && b.time) return 1;
        return a.ordinal - b.ordinal
          || a.group.createdAt.localeCompare(b.group.createdAt)
          || a.index - b.index;
      })
      .map(({ group }) => group);
  }

  private laneOrdinal(group: PrintGroup, fallback: number): number {
    return printGroupOrdinal(group, fallback);
  }

  private journalTimeZone(): string {
    return this.plugin.settings.timeZone || detectSystemZone();
  }

  private laneTime(group: PrintGroup): string {
    const journalZone = this.journalTimeZone();
    if (group.tradeTimeHint) {
      const hintZone = group.tradeTimeHintZone || journalZone;
      if (hintZone === journalZone) return group.tradeTimeHint;
      try {
        return zoneWallParts(localToUtc(group.journalDate, group.tradeTimeHint, hintZone), journalZone).time.slice(0, 5);
      } catch {
        return group.tradeTimeHint;
      }
    }

    const legacyTime = splitLegacyGroupTime(group.name).time;
    if (legacyTime) return legacyTime;
    if (group.entryIds.length === 0) return "";

    const firstEntry = this.entries.find((entry) => entry.id === group.entryIds[0]);
    const instant = firstEntry?.capturedAt || group.createdAt;
    if (!instant) return "";
    const parsed = new Date(instant);
    if (Number.isNaN(parsed.getTime())) return "";
    return zoneWallParts(parsed, journalZone).time.slice(0, 5);
  }

  private renderGroupDetailsControl(
    groupEl: HTMLElement,
    header: HTMLElement,
    group: PrintGroup,
    ordinal: number,
    groupName: string,
    time: string,
    closeOtherEditor: () => void,
  ): () => void {
    const detailsId = `print-group-details-${group.id}`;
    groupEl.setAttr("aria-labelledby", detailsId);
    const button = header.createEl("button", {
      cls: "tj-print-group-details",
      attr: {
        id: detailsId,
        type: "button",
        "aria-expanded": "false",
      },
    });
    button.createSpan({ cls: "tj-print-group-details-name", text: groupName });
    if (time) {
      button.createSpan({ cls: "tj-print-group-details-separator", text: " · " });
      button.createEl("time", { cls: "tj-print-group-details-time", text: time });
    }

    const editor = groupEl.createDiv({ cls: "tj-print-group-details-editor" });
    editor.hidden = true;


    const nameId = `print-group-name-${group.id}`;
    editor.createEl("label", {
      cls: "tj-print-group-details-label",
      attr: { for: nameId },
      text: "Group name",
    });
    const nameInput = editor.createEl("input", {
      cls: "tj-print-group-name-input",
      attr: { id: nameId, type: "text", maxlength: "80", "aria-label": "Group name" },
    }) as HTMLInputElement;
    nameInput.value = groupName;

    const timeRow = editor.createDiv({ cls: "tj-print-group-details-time-row" });
    const timeId = `print-group-time-${group.id}`;
    const timeLabelId = `${timeId}-label`;
    timeRow.createEl("span", {
      cls: "tj-print-group-details-label",
      attr: { id: timeLabelId },
      text: "Time",
    });
    const timePicker = timeRow.createDiv({
      cls: "tj-print-group-time-picker",
      attr: { id: timeId, role: "group", "aria-labelledby": timeLabelId },
    });
    const initialTime = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
    let selectedHour = initialTime?.[1] ?? "";
    let selectedMinute = initialTime?.[2] ?? "";
    const timeTrigger = timePicker.createEl("button", {
      cls: "tj-print-group-time-trigger",
      attr: {
        type: "button",
        "aria-expanded": "false",
        "aria-haspopup": "true",
        "aria-label": "Choose group time",
      },
    });
    const displayHour = timeTrigger.createSpan({ cls: "tj-print-group-time-display-hour", text: selectedHour || "HH" });
    timeTrigger.createSpan({ cls: "tj-print-group-time-separator", text: ":" });
    const displayMinute = timeTrigger.createSpan({ cls: "tj-print-group-time-display-minute", text: selectedMinute || "MM" });
    timeTrigger.createSpan({
      cls: "tj-print-group-time-trigger-chevron",
      attr: { "aria-hidden": "true" },
      text: "▾",
    });
    const pickerMenu = timePicker.createDiv({
      cls: "tj-print-group-time-menu",
      attr: { role: "group", "aria-label": "Choose hour and minute" },
    });
    pickerMenu.hidden = true;
    const menuHeader = pickerMenu.createDiv({ cls: "tj-print-group-time-menu-header" });
    menuHeader.createSpan({ cls: "tj-print-group-time-menu-title", text: "Choose time" });
    const timeColumns = pickerMenu.createDiv({ cls: "tj-print-group-time-columns" });
    const hourValues = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
    const minuteValues = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, "0"));
    let syncTimePicker: () => void = () => {};
    let closeTimePicker: () => void = () => {};
    const createTimeOptions = (part: "hour" | "minute", values: string[], label: string) => {
      const column = timeColumns.createDiv({ cls: `tj-print-group-time-column tj-print-group-time-${part}-column` });
      column.createSpan({ cls: "tj-print-group-time-column-label", text: label });
      const list = column.createDiv({
        cls: `tj-print-group-time-options tj-print-group-time-${part}-options`,
        attr: { role: "listbox", tabindex: "0", "aria-label": label },
      });
      const options = values.map((value) => {
        const option = list.createEl("button", {
          cls: `tj-print-group-time-option tj-print-group-time-${part}-option`,
          attr: {
            type: "button",
            id: `${timeId}-${part}-${value}`,
            role: "option",
            "data-time-value": value,
            "aria-selected": "false",
            tabindex: "-1",
          },
          text: value,
        });
        option.addEventListener("click", (event) => {
          event.stopPropagation();
          if (part === "hour") selectedHour = value;
          else selectedMinute = value;
          syncTimePicker();
          list.focus?.();
        });
        return option;
      });
      list.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeTimePicker();
          timeTrigger.focus?.();
          return;
        }
        const selectedValue = part === "hour" ? selectedHour : selectedMinute;
        const currentIndex = values.indexOf(selectedValue);
        let nextIndex: number | undefined;
        if (event.key === "ArrowDown") nextIndex = Math.min(values.length - 1, currentIndex < 0 ? 0 : currentIndex + 1);
        else if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1);
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = values.length - 1;
        if (nextIndex === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        if (part === "hour") selectedHour = values[nextIndex];
        else selectedMinute = values[nextIndex];
        syncTimePicker();
      });
      return { list, options, values };
    };
    const hourColumn = createTimeOptions("hour", hourValues, "Hour");
    const minuteColumn = createTimeOptions("minute", minuteValues, "Minute");
    syncTimePicker = (): void => {
      displayHour.setText(selectedHour || "HH");
      displayMinute.setText(selectedMinute || "MM");
      for (const [index, option] of hourColumn.options.entries()) {
        option.setAttr("aria-selected", String(hourValues[index] === selectedHour));
      }
      for (const [index, option] of minuteColumn.options.entries()) {
        option.setAttr("aria-selected", String(minuteValues[index] === selectedMinute));
      }
      const activeHourIndex = Math.max(0, hourValues.indexOf(selectedHour));
      const activeMinuteIndex = Math.max(0, minuteValues.indexOf(selectedMinute));
      const activeHour = hourColumn.options[activeHourIndex] ?? hourColumn.options[0];
      const activeMinute = minuteColumn.options[activeMinuteIndex] ?? minuteColumn.options[0];
      hourColumn.list.setAttr("aria-activedescendant", `${timeId}-hour-${hourValues[activeHourIndex]}`);
      minuteColumn.list.setAttr("aria-activedescendant", `${timeId}-minute-${minuteValues[activeMinuteIndex]}`);
      if (!pickerMenu.hidden) {
        activeHour.scrollIntoView?.({ block: "nearest" });
        activeMinute.scrollIntoView?.({ block: "nearest" });
      }
    };
    syncTimePicker();
    closeTimePicker = (): void => {
      pickerMenu.hidden = true;
      timeTrigger.setAttr("aria-expanded", "false");
      actions.appendChild(save);
    };
    const openTimePicker = (): void => {
      pickerMenu.hidden = false;
      timeTrigger.setAttr("aria-expanded", "true");
      menuHeader.appendChild(save);
      syncTimePicker();
      hourColumn.list.focus?.();
    };
    timeTrigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (pickerMenu.hidden) openTimePicker();
      else closeTimePicker();
    });
    editor.addEventListener("click", (event) => {
      event.stopPropagation();
      if (pickerMenu.hidden) return;
      if (!timePicker.contains(event.target as Node | null)) closeTimePicker();
    });
    timeRow.createSpan({
      cls: "tj-print-group-details-zone",
      text: `Journal zone: ${zoneShortLabel(this.journalTimeZone())}`,
    });

    const actions = editor.createDiv({ cls: "tj-print-group-details-actions" });
    const save = actions.createEl("button", {
      cls: "tj-mini tj-print-group-details-save",
      attr: { type: "button" },
      text: "Save",
    });
    const cancel = actions.createEl("button", {
      cls: "tj-mini tj-print-group-details-cancel",
      attr: { type: "button" },
      text: "Cancel",
    });

    const close = (): void => {
      closeTimePicker();
      editor.hidden = true;
      button.setAttr("aria-expanded", "false");
    };
    timeTrigger.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (pickerMenu.hidden) {
        close();
        button.focus?.();
      } else {
        closeTimePicker();
        timeTrigger.focus?.();
      }
    });
    const open = (): void => {
      closeOtherEditor();
      nameInput.value = groupName;
      selectedHour = initialTime?.[1] ?? "";
      selectedMinute = initialTime?.[2] ?? "";
      syncTimePicker();
      closeTimePicker();
      editor.hidden = false;
      button.setAttr("aria-expanded", "true");
      nameInput.focus?.();
    };
    const saveDetails = (): void => {
      if ((selectedHour === "") !== (selectedMinute === "")) {
        new Notice("Choose both an hour and minute.");
        openTimePicker();
        return;
      }
      closeTimePicker();
      const selectedTime = selectedHour && selectedMinute ? `${selectedHour}:${selectedMinute}` : "";
      void this.saveGroupDetails(group.id, nameInput.value, selectedTime, ordinal);
    };
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (editor.hidden) open();
      else close();
    });
    save.addEventListener("click", (event) => {
      event.stopPropagation();
      saveDetails();
    });
    cancel.addEventListener("click", (event) => {
      event.stopPropagation();
      close();
      button.focus?.();
    });
    nameInput.addEventListener("click", (event) => event.stopPropagation());
    nameInput.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        saveDetails();
      } else if (event.key === "Escape") {
        event.stopPropagation();
        close();
        button.focus?.();
      }
    });
    return close;
  }

  private async saveGroupDetails(groupId: string, name: string, time: string, ordinal: number): Promise<void> {
    try {
      const previousPosition = this.groupPositionInDate(groupId);
      const zone = this.journalTimeZone();
      await updatePrintGroupDetails(this.plugin.app, "", groupId, name, time || undefined, time ? zone : undefined, ordinal);
      await this.refresh();
      const nextPosition = this.groupPositionInDate(groupId);
      const updated = this.groups.find((group) => group.id === groupId);
      const movedEarlier = previousPosition >= 0 && nextPosition >= 0 && nextPosition < previousPosition;
      const movedLater = previousPosition >= 0 && nextPosition > previousPosition;
      const displayedTime = updated ? this.laneTime(updated) : "";
      const message = movedEarlier && displayedTime
        ? `Group moved earlier to ${displayedTime}.`
        : movedLater && displayedTime
          ? `Group moved later to ${displayedTime}.`
          : "Group details saved.";
      this.liveStatusEl?.setText(message);
      this.contentEl.querySelector<HTMLElement>(`#print-group-details-${groupId}`)?.focus();
      new Notice(message);
    } catch (error) {
      console.error("[tradebook] failed to save print group details", error);
      const message = error instanceof Error && /^(Group name|Invalid trade-time|A time zone)/.test(error.message)
        ? error.message
        : "Could not save group details.";
      new Notice(message);
    }
  }

  private groupPositionInDate(groupId: string): number {
    const group = this.groups.find((item) => item.id === groupId);
    if (!group) return -1;
    return this.pendingLanes()
      .filter((item) => item.journalDate === group.journalDate)
      .findIndex((item) => item.id === groupId);
  }

  private renderUnsorted(parent: HTMLElement, entries: PrintInboxEntry[]): void {
    if (!entries.length) return;
    const section = parent.createDiv({ cls: "tj-print-inbox-unsorted" });
    if (entries[0]?.journalDate) section.setAttr("data-journal-date", entries[0].journalDate);
    const header = section.createDiv({ cls: "tj-print-inbox-unsorted-header" });
    header.createSpan({ cls: "tj-print-inbox-unsorted-title", text: "Unsorted prints" });
    header.createSpan({ cls: "tj-print-inbox-unsorted-count", text: String(entries.length) });
    const destinations = this.pendingLanes();
    if (destinations.length) this.renderSelectedPrintActions(header, "", destinations, true);
    const entriesEl = section.createDiv({ cls: "tj-print-inbox-unsorted-entries" });
    for (const entry of entries) {
      this.renderEntry(entriesEl, entry);
    }
  }

  private renderSelectedPrintActions(
    parent: HTMLElement,
    groupId: string,
    destinations: PrintGroup[],
    unsorted = false,
  ): void {
    const more = parent.createEl("details", {
      cls: "tj-print-group-selected-more",
      attr: { "data-move-context": "true", "data-group-id": groupId },
    });
    if (unsorted) more.setAttr("data-unsorted", "true");
    more.hidden = true;
    more.addEventListener("click", (event) => event.stopPropagation());
    const trigger = more.createEl("summary", {
      cls: "tj-print-group-selected-trigger",
      attr: { "aria-label": "More actions for selected print" },
      text: "More",
    });
    trigger.addEventListener("click", (event) => event.stopPropagation());
    const menu = more.createDiv({ cls: "tj-print-group-selected-menu" });
    menu.createSpan({ cls: "tj-print-group-selected-label", text: "Move selected print to" });
    const move = menu.createEl("select", {
      cls: "tj-print-group-film-move",
      attr: { "aria-label": "Move selected print to another group" },
    });
    move.createEl("option", { value: "", text: "Choose group…" });
    for (const destination of destinations) {
      move.createEl("option", { value: destination.id, text: destination.name });
    }
    move.addEventListener("click", (event) => event.stopPropagation());
    move.addEventListener("change", (event) => {
      event.stopPropagation();
      const destinationId = move.value;
      move.value = "";
      if (destinationId && this.selectedId) {
        void this.moveEntryBetweenGroups(this.selectedId, groupId, destinationId);
      }
    });
  }

  private renderEntry(parent: HTMLElement, entry: PrintInboxEntry, groupId?: string, index?: number): void {
    // Filmstrip item: the thumbnail IS the content. The filename and timestamp
    // live in the entry sidecar; they are never rendered as the primary text.
    const item = parent.createDiv({ cls: `tj-print-group-film-item${entry.id === this.selectedId ? " is-selected" : ""}` });
    item.setAttr("data-entry-id", entry.id);
    if (groupId) item.setAttr("data-group-id", groupId);
    const label = typeof index === "number" ? `Print ${index + 1}` : "Print";
    item.setAttr("tabindex", "0");
    item.setAttr("aria-label", label);
    if (groupId) {
      item.setAttr("draggable", "true");
      item.addEventListener("dragstart", (e) => {
        // Direct thumbnail drag owns the gesture: it must never start a
        // whole-group drop onto Trade Detail.
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        const groupEl = typeof item.closest === "function" ? item.closest(".tj-print-group") as HTMLElement | null : null;
        groupEl?.setAttr("draggable", "false");
        const dt = e.dataTransfer;
        if (dt) {
          const payload = JSON.stringify({ entryId: entry.id, fromGroupId: groupId });
          dt.setData(PRINT_ENTRY_MIME, payload);
          dt.setData("text/plain", payload);
          dt.effectAllowed = "move";
        }
      });
      item.addEventListener("dragend", () => {
        if (typeof item.closest === "function") item.closest(".tj-print-group")?.setAttr("draggable", "true");
        this.clearDropIndicators(parent);
      });
      item.addEventListener("dragover", (e) => {
        const drag = this.readEntryDrag(e);
        if (!drag || drag.fromGroupId !== groupId || drag.entryId === entry.id) return;
        e.preventDefault();
        e.stopPropagation();
        this.clearDropIndicators(parent);
        item.addClass(this.dropPosition(e, item) === "before" ? "is-drop-before" : "is-drop-after");
      });
      item.addEventListener("dragleave", () => {
        item.removeClass("is-drop-before");
        item.removeClass("is-drop-after");
      });
      item.addEventListener("drop", (e) => {
        if (this.handledDropEvents.has(e)) return;
        const drag = this.readEntryDrag(e);
        if (!drag || drag.fromGroupId !== groupId) return;
        this.handledDropEvents.add(e);
        e.preventDefault();
        e.stopPropagation();
        const position = this.dropPosition(e, item);
        this.clearDropIndicators(parent);
        if (drag.entryId !== entry.id) {
          void this.reorderEntryTo(groupId, drag.entryId, entry.id, position);
        }
      });
    }
    const file = this.plugin.app.vault.getAbstractFileByPath(entry.imagePath);
    const thumb = item.createEl("img", { cls: "tj-print-group-film-thumb", attr: { alt: label } });
    if (file instanceof TFile) thumb.src = this.plugin.app.vault.getResourcePath(file);

    // Keep one direct, per-print trash action; no bulk-selection mode.
    const remove = item.createEl("button", { cls: "tj-mini tj-print-group-film-remove", attr: { type: "button", "aria-label": "Move print to trash" } });
    setIcon(remove, "trash-2");
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.removeEntry(entry);
    });

    // Moving is available from one contextual More menu after a print is
    // selected; drag-and-drop remains the direct movement path.
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      this.selectEntry(entry);
    });
    item.addEventListener("keydown", (event) => {
      // Nested action controls own their native keyboard keys.
      if (event.target !== item) return;
      event.stopPropagation();
      this.handleEntryKeydown(event, entry, groupId);
    });
  }

  private readEntryDrag(event: DragEvent): { entryId: string; fromGroupId: string } | null {
    const raw = event.dataTransfer?.getData(PRINT_ENTRY_MIME) || event.dataTransfer?.getData("text/plain") || "";
    if (!raw.startsWith("{")) return null;
    try {
      const data = JSON.parse(raw);
      if (data && typeof data.entryId === "string") {
        return {
          entryId: data.entryId,
          fromGroupId: typeof data.fromGroupId === "string" ? data.fromGroupId : "",
        };
      }
    } catch {
      // Not an entry payload; ignore.
    }
    return null;
  }

  private dropPosition(event: DragEvent, item: HTMLElement): "before" | "after" {
    if (typeof item.getBoundingClientRect !== "function") return "after";
    const rect = item.getBoundingClientRect();
    if (!rect.width) return "after";
    const x = typeof event.clientX === "number" ? event.clientX : rect.left + rect.width / 2;
    return x < rect.left + rect.width / 2 ? "before" : "after";
  }

  private clearDropIndicators(parent: HTMLElement): void {
    for (const child of Array.from(parent.children) as HTMLElement[]) {
      if (typeof child.removeClass === "function") {
        child.removeClass("is-drop-before");
        child.removeClass("is-drop-after");
      }
    }
  }

  /**
   * Select a print entry: highlight the filmstrip item.
   * Extracted from the renderEntry closure so the keyboard flow (Enter/Space)
   * is exercisable without a DOM.
   */
  private selectEntry(entry: PrintInboxEntry): void {
    this.selectedId = entry.id;
    (this.contentEl as HTMLElement | null)?.querySelectorAll<HTMLElement>("[data-entry-id]").forEach((item) => {
      item.toggleClass("is-selected", item.getAttribute("data-entry-id") === entry.id);
    });
    this.updateSelectedMoveMenus();
  }

  private updateSelectedMoveMenus(): void {
    const content = this.contentEl as HTMLElement | null;
    if (!content) return;
    const items = Array.from(content.querySelectorAll<HTMLElement>("[data-entry-id]"));
    const selected = items.find((item) => item.getAttribute("data-entry-id") === this.selectedId);
    const selectedGroupId = selected?.getAttribute("data-group-id") || "";
    const selectedIsUnsorted = !!selected && !selectedGroupId;
    content.querySelectorAll<HTMLElement>("[data-move-context]").forEach((menu) => {
      const menuIsUnsorted = menu.getAttribute("data-unsorted") === "true";
      const menuGroupId = menu.getAttribute("data-group-id") || "";
      menu.hidden = !selected || (menuIsUnsorted ? !selectedIsUnsorted : selectedIsUnsorted || menuGroupId !== selectedGroupId);
    });
  }

  /**
   * Keyboard contract for an entry row (execution plan Phase D):
   *  Enter / Space     — select the entry (existing activation preserved)
   *  ArrowUp / ArrowDown — reorder the entry within its group
   *  Delete / Backspace  — remove the entry entirely
   *
   * Arrow keys only apply inside a group; unsorted entries have no order to
   * change, so they are ignored there (remove still works).
   */
  private handleEntryKeydown(event: KeyboardEvent, entry: PrintInboxEntry, groupId?: string): void {
    switch (event.key) {
      case "Enter":
      case " ":
        event.preventDefault();
        this.selectEntry(entry);
        return;
      case "ArrowUp":
        if (groupId) { event.preventDefault(); void this.reorderEntry(groupId, entry.id, -1); }
        return;
      case "ArrowDown":
        if (groupId) { event.preventDefault(); void this.reorderEntry(groupId, entry.id, 1); }
        return;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        void this.removeEntry(entry);
        return;
    }
  }

  /**
   * Public move flow: transfer an entry between two groups and refresh.
   * The drag-and-drop drop handler parses the dataTransfer and delegates here,
   * so the behaviour is exercisable without a DOM.
   */
  private async moveEntryBetweenGroups(entryId: string, fromGroupId: string, toGroupId: string): Promise<void> {
    const lock = `${entryId}:${fromGroupId}:${toGroupId}`;
    if (this.moveInFlight.has(lock)) return;
    this.moveInFlight.add(lock);
    try {
      const base = "";
      // An unsorted legacy print is grouped only by this explicit user action.
      if (fromGroupId && fromGroupId !== toGroupId) {
        await moveEntryToGroup(this.plugin.app, base, fromGroupId, toGroupId, entryId);
        await this.refresh();
      } else if (!fromGroupId) {
        const groups = await listPrintGroups(this.plugin.app, base);
        if (groups.some((group) => group.entryIds.includes(entryId))) return;
        await addEntryToGroup(this.plugin.app, base, toGroupId, entryId);
        await this.refresh();
      }
    } catch (error) {
      console.error("[tradebook] failed to move entry between groups", error);
      new Notice("Could not move that print.");
    } finally {
      this.moveInFlight.delete(lock);
    }
  }

  private renderGroup(parent: HTMLElement, group: PrintGroup, fallbackOrdinal = parent.children.length + 1): void {

    const groupEl = parent.createDiv({ cls: `tj-print-group${group.state === "active" ? " is-active" : ""}` });
    const ordinal = this.laneOrdinal(group, fallbackOrdinal);
    const time = this.laneTime(group);
    const rawGroupName = group.name.trim() || `Group ${ordinal}`;
    const groupName = splitLegacyGroupTime(rawGroupName).name || `Group ${ordinal}`;
    groupEl.setAttr("role", "group");
    groupEl.setAttr("tabindex", "0");
    groupEl.setAttr("data-group-id", group.id);
    // Phase E: a whole pending group is draggable onto Trade Detail. The payload
    // is private and carries the group id only — never raw image data — so the
    // receiving view can validate it before touching the vault.
    groupEl.setAttr("draggable", "true");
    groupEl.addEventListener("dragstart", (e) => {
      // Filmstrip items are separately draggable for move-between-groups; an
      // item drag bubbles here too. If we set the group MIME on an item drag,
      // dragging one print to Trade Detail would file the whole group — so the
      // item keeps ownership of its own drag.
      const from = e.target as HTMLElement | null;
      if (from && typeof from.closest === "function" && (
        from.closest(".tj-print-inbox-entry")
        || from.closest(".tj-print-group-film-item")
        || from.closest(".tj-print-group-controls")
        || from.closest(".tj-print-group-details")
        || from.closest(".tj-print-group-details-editor")
        || from.closest(".tj-print-group-capture")
        || from.closest(".tj-print-group-selected-more")
        || from.closest(".tj-print-group-film-remove")
        || from.closest(".tj-print-group-discard")
      )) return;
      const dt = e.dataTransfer;
      if (!dt) return;
      dt.setData(PRINT_GROUP_MIME, makePrintGroupDragPayload(group.id));
      dt.setData("text/plain", group.name);
      dt.effectAllowed = "move";
      groupEl.addClass("tj-print-group-dragging");
    });
    groupEl.addEventListener("dragend", () => groupEl.removeClass("tj-print-group-dragging"));

    // Hovering or focusing the print area targets this lane. Editors and action
    // controls do not retarget capture; explicit Paste/Choose buttons already
    // carry their own lane id.
    const isCaptureControl = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      return !!element && typeof element.closest === "function" && !!element.closest(
        ".tj-print-group-details, .tj-print-group-details-editor, .tj-print-group-capture, .tj-print-group-selected-more, .tj-print-group-film-remove, .tj-print-group-discard",
      );
    };
    const setTarget = (on: boolean) => {
      if (on) this.captureTargetGroupId = group.id;
      else if (this.captureTargetGroupId === group.id) this.captureTargetGroupId = "";
      groupEl.toggleClass("is-capture-target", this.captureTargetGroupId === group.id);
    };
    groupEl.toggleClass("is-capture-target", this.captureTargetGroupId === group.id);
    groupEl.addEventListener("pointerover", (event) => setTarget(!isCaptureControl(event.target)));
    groupEl.addEventListener("pointerout", (event) => {
      const next = event.relatedTarget as Node | null;
      setTarget(!!next && groupEl.contains(next) && !isCaptureControl(next));
    });
    groupEl.addEventListener("focusin", (event) => setTarget(!isCaptureControl(event.target)));
    groupEl.addEventListener("focusout", (event) => {
      const next = event.relatedTarget as Node | null;
      setTarget(!!next && groupEl.contains(next) && !isCaptureControl(next));
    });

    // Name and time are one editing control; editing does not activate capture.
    const header = groupEl.createDiv({ cls: "tj-print-group-header" });
    this.renderGroupDetailsControl(groupEl, header, group, ordinal, groupName, time, () => {});
    const laterDates = [...new Set(group.entryIds
      .map((entryId) => this.entries.find((entry) => entry.id === entryId)?.journalDate ?? "")
      .filter((date) => isJournalDate(group.journalDate) && isJournalDate(date) && date > group.journalDate))]
      .sort((a, b) => a.localeCompare(b));
    if (laterDates.length) {
      header.createSpan({
        cls: "tj-print-group-later-additions",
        text: `Later prints: ${laterDates.map(formatQueueDate).join(", ")}`,
      });
    }

    const entriesEl = groupEl.createDiv({ cls: "tj-print-group-entries" });
    group.entryIds.forEach((entryId, index) => {
      const entry = this.entries.find(e => e.id === entryId);
      if (entry) this.renderEntry(entriesEl, entry, group.id, index);
    });

    // Lane-local capture controls sit directly under this lane's filmstrip and
    // move with it; there is no global capture bar above the queue.
    const controls = groupEl.createDiv({ cls: "tj-print-group-controls" });
    const capture = controls.createDiv({ cls: "tj-print-group-capture" });
    const paste = capture.createEl("button", {
      cls: "tj-mini tj-print-group-paste",
      attr: { type: "button", "aria-label": `Paste into lane ${ordinal}` },
      text: "Paste",
    });
    paste.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.pasteFromClipboard(group.id);
    });
    const choose = capture.createEl("button", {
      cls: "tj-mini tj-print-group-choose",
      attr: { type: "button", "aria-label": `Choose a file for lane ${ordinal}` },
      text: "Choose file",
    });
    choose.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openPicker(group.id);
    });

    const destinations = this.pendingLanes().filter((destination) => destination.id !== group.id);
    if (group.entryIds.length && destinations.length) {
      this.renderSelectedPrintActions(controls, group.id, destinations);
    }

    // Discard is a cleanup for groups emptied after their last print was
    // removed: it deletes the sidecar only (the prints are already gone with
    // the last entry). Non-empty groups show no discard control — the button
    // is re-evaluated on every render, so removing the last print reveals it.
    if (group.entryIds.length === 0) {
      const discard = controls.createEl("button", {
        cls: "tj-mini tj-print-group-discard",
        attr: { type: "button", "aria-label": "Move empty group to trash" },
      });
      setIcon(discard, "trash-2");
      discard.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.discardGroup(group.id);
      });
    }

    groupEl.addEventListener("dragover", (e) => {
      // Same-lane thumbnail reorder owns its own drop indicator.
      const drag = this.readEntryDrag(e);
      if (drag && drag.fromGroupId === group.id) return;
      e.preventDefault();
      groupEl.addClass("tj-print-group-drag-over");
    });
    groupEl.addEventListener("dragleave", () => groupEl.removeClass("tj-print-group-drag-over"));
    groupEl.addEventListener("drop", (e) => {
      if (this.handledDropEvents.has(e)) return;
      e.preventDefault();
      groupEl.removeClass("tj-print-group-drag-over");
      const dt = e.dataTransfer;
      if (!dt) return;
      // Only entry payloads are JSON here. A whole-group drag carries the group
      // name as text/plain and belongs to Trade Detail, not to another card —
      // ignore it quietly instead of failing the parse.
      const raw = dt.getData("text/plain");
      if (!raw || !raw.startsWith("{")) return;
      try {
        const data = JSON.parse(raw);
        const { entryId, fromGroupId } = data;
        if (entryId && typeof entryId === "string") {
          this.handledDropEvents.add(e);
          void this.moveEntryBetweenGroups(entryId, fromGroupId ?? "", group.id);
        }
      } catch (error) {
        console.error("[tradebook] failed to parse drop payload", error);
      }
    });

    const select = (): void => {
      void this.selectGroup(group.id);
    };
    groupEl.addEventListener("click", select);
    groupEl.addEventListener("keydown", (event) => {
      if (event.target !== groupEl) return;
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
    });
  }

  /**
   * Read images from the OS clipboard for the explicit "Paste clipboard"
   * actions. Ctrl+V remains available everywhere in the panel; this is the
   * pointer-friendly equivalent and targets the lane that owns the button.
   */
  private async pasteFromClipboard(groupId = ""): Promise<void> {
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clipboard || typeof clipboard.read !== "function") {
      new Notice("Press Ctrl+V to paste an image.");
      return;
    }
    try {
      const items = await clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const type = item.types.find((value) => value.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        const extension = type.split("/")[1]?.replace("jpeg", "jpg") || "png";
        files.push(new File([blob], `clipboard.${extension}`, { type }));
      }
      if (!files.length) {
        new Notice("No image on the clipboard.");
        return;
      }
      await this.saveFiles(files, "paste", groupId);
    } catch (error) {
      console.error("[tradebook] failed to read clipboard", error);
      new Notice("Could not read the clipboard. Press Ctrl+V to paste.");
    }
  }

  private onPaste = (event: ClipboardEvent): void => {
    if (this.handledPasteEvents.has(event)) return;
    const target = event.target as Node | null;
    const active = this.containerEl.ownerDocument?.activeElement ?? (typeof document !== "undefined" ? document.activeElement : null);
    const inside = !!target && this.containerEl.contains(target);
    const focused = !!active && this.containerEl.contains(active);
    const hovered = this.containerEl.matches?.(":hover") ?? false;
    const isEditable = (node: Node | null): boolean => {
      const element = node as HTMLElement | null;
      return !!element && typeof element.closest === "function" && !!element.closest("input, textarea, select, [contenteditable='true'], [role='textbox']");
    };
    if (isEditable(target) || isEditable(active)) return;
    if (!this.containerEl.isConnected || !this.containerEl.getClientRects().length) return;
    if (!inside && !focused && !hovered) return;
    const files = event.clipboardData ? Array.from(event.clipboardData.items).map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file): file is File => !!file) : [];
    if (!files.length) return;
    this.handledPasteEvents.add(event);
    event.preventDefault();
    event.stopPropagation();
    void this.saveFiles(files, "paste");
  };

  private onDrop = (event: DragEvent): void => {
    this.contentEl.removeClass("tj-print-inbox-dragging");
    // Internal thumbnail/group drags must never be treated as OS file drops.
    // Browsers expose the dragged <img> as a File as well, which used to save
    // a second Print Queue entry before the reorder/move handler ran.
    if (this.readEntryDrag(event) || event.dataTransfer?.getData(PRINT_GROUP_MIME)) return;
    event.preventDefault();
    const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
    if (files.length) void this.saveFiles(files, "drop");
  };

  private async saveFiles(files: File[], source: PrintInboxSource, targetGroupId = ""): Promise<void> {
    // Capture attention before image persistence or file events can rerender the
    // queue. Moving the pointer during a write must not retarget those prints.
    const captureTargetId = targetGroupId || this.captureTargetGroupId || this.groups.find((group) => group.state === "active")?.id || "";
    const images = files.filter((file) => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type));
    if (!images.length) { new Notice("Choose a PNG, JPEG, WebP or GIF image."); return; }
    const journalDate = dateInZone(this.journalTimeZone());
    let saved = 0;
    let failed = 0;
    const entries: PrintInboxEntry[] = [];
    for (const file of images) {
      try {
        const entry = await savePrintInboxEntry(this.plugin.app, this.plugin.getTradesFolder(), file, journalDate, source);
        entries.push(entry);
        saved += 1;
      } catch (error) {
        failed += 1;
        console.error("[tradebook] failed to save Print Queue entry", error);
      }
    }
    let laneFilingFailed = false;
    if (saved && entries.length) {
      const base = "";
      const groupsCache = new Map<string, PrintGroup>();
      const timeSeededGroupIds = new Set<string>();
      try {
        for (const entry of entries) {
          let group: PrintGroup | undefined = groupsCache.get(entry.journalDate);
          if (!group) {
            const allGroups = await listPrintGroups(this.plugin.app, base);
            // A hovered/focused card is the explicit capture target for this
            // paste/drop/file pick — it overrides the global active group for
            // that one capture only. With no target, the queue-level fallback
            // to the global active group is preserved unchanged.
            const route = captureTargetId && allGroups.some((g) => g.id === captureTargetId && g.state !== "attached")
              ? { kind: "use" as const, groupId: captureTargetId }
              : routeCapture(allGroups);
            if (route.kind === "use") {
              group = allGroups.find((g) => g.id === route.groupId);
            } else {
              const name = `Group ${route.ordinal}`;
              group = await createPrintGroup(this.plugin.app, base, entry.journalDate, entry.capturedAt, name, route.ordinal);
            }
            if (!group) {
              // Fallback: should not happen, but guard.
              group = await createPrintGroup(this.plugin.app, base, entry.journalDate, entry.capturedAt, "Group 1", 1);
            }
            groupsCache.set(entry.journalDate, group);
          }
          await addEntryToGroup(this.plugin.app, base, group!.id, entry.id);
          const legacyTime = splitLegacyGroupTime(group.name).time;
          if (
            group.entryIds.length === 0
            && !group.tradeTimeHint
            && !legacyTime
            && !timeSeededGroupIds.has(group.id)
          ) {
            const zone = this.journalTimeZone();
            const time = zoneWallParts(new Date(entry.capturedAt), zone).time.slice(0, 5);
            await updatePrintGroupDetails(this.plugin.app, base, group.id, group.name, time, zone, this.laneOrdinal(group, 1));
            group.tradeTimeHint = time;
            group.tradeTimeHintZone = zone;
            timeSeededGroupIds.add(group.id);
          }
          if (!group.entryIds.includes(entry.id)) group.entryIds.push(entry.id);
        }
      } catch (error) {
        // Inbox files are already durable. Keep them and surface any partial
        // grouping so the user can reconcile grouped and unfiled captures.
        laneFilingFailed = true;
        console.error("[tradebook] failed to file saved Print Queue entries", error);
      }
    }
    if (saved) await this.refresh();
    if (laneFilingFailed) {
      const partialSave = failed ? ` ${failed} could not be saved.` : "";
      new Notice(`${saved} print${saved === 1 ? "" : "s"} saved; lane filing was incomplete.${partialSave} Check the Print Queue for grouped and unfiled captures.`);
      return;
    }
    if (failed) new Notice(saved ? `${saved} saved; ${failed} could not be saved.` : "Could not save the print to the vault.");
    else new Notice(`${saved} print${saved === 1 ? "" : "s"} saved to the Print Queue.`);
  }

  private async moveEntryToTrash(entry: PrintInboxEntry): Promise<void> {
    const base = "";
    const groups = await listPrintGroups(this.plugin.app, base);
    const owningGroups = groups.filter((group) => group.entryIds.includes(entry.id));
    if (owningGroups.some((group) => group.state === "attached")) {
      throw new Error("This print is already attached to a trade. Manage it in Trade Detail.");
    }
    for (const group of owningGroups) {
      // Remove queue membership before moving files so no surviving group points
      // at an entry in trash. A write failure aborts before files are moved.
      await removeEntryFromGroup(this.plugin.app, base, group.id, entry.id);
    }
    await deletePrintInboxEntry(this.plugin.app, this.plugin.getTradesFolder(), entry);
  }

  private async removeEntry(entry: PrintInboxEntry): Promise<void> {
    try {
      await this.moveEntryToTrash(entry);
      this.selectedId = "";
      await this.refresh();
      new Notice("Print moved to trash.");
    } catch (error) {
      console.error("[tradebook] failed to move print to trash", error);
      new Notice(error instanceof Error && error.message.startsWith("This print is already attached")
        ? error.message
        : "Could not move the print to trash.");
    }
  }

  private async reorderEntry(groupId: string, entryId: string, delta: number): Promise<void> {
    try {
      const base = "";
      const group = await loadPrintGroup(this.plugin.app, base, groupId);
      if (!group) return;
      const idx = group.entryIds.indexOf(entryId);
      if (idx === -1) return;
      const newIdx = Math.max(0, Math.min(group.entryIds.length - 1, idx + delta));
      if (newIdx === idx) return;
      const newOrder = [...group.entryIds];
      const [moved] = newOrder.splice(idx, 1);
      newOrder.splice(newIdx, 0, moved);
      await reorderGroupEntries(this.plugin.app, base, groupId, newOrder);
      await this.refresh();
    } catch (error) {
      console.error("[tradebook] failed to reorder entry", error);
      new Notice("Could not reorder print.");
    }
  }

  /**
   * Move one existing print before/after another print in the same lane.
   * The source id is filtered out first, so a drop can never duplicate a print
   * or change lane membership; only the persisted entryIds order changes.
   */
  private async reorderEntryTo(
    groupId: string,
    entryId: string,
    targetEntryId: string,
    position: "before" | "after",
  ): Promise<void> {
    const lock = `${groupId}:${entryId}:${targetEntryId}:${position}`;
    if (this.reorderInFlight.has(lock)) return;
    this.reorderInFlight.add(lock);
    try {
      const base = "";
      const group = await loadPrintGroup(this.plugin.app, base, groupId);
      if (!group) return;
      if (entryId === targetEntryId) return;
      const currentOrder = [...new Set(group.entryIds)];
      if (!currentOrder.includes(entryId) || !currentOrder.includes(targetEntryId)) return;
      const newOrder = currentOrder.filter((id) => id !== entryId);
      const targetIndex = newOrder.indexOf(targetEntryId);
      if (targetIndex === -1) return;
      newOrder.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, entryId);
      if (newOrder.length !== currentOrder.length) return;
      if (newOrder.every((id, index) => id === currentOrder[index])) return;
      await reorderGroupEntries(this.plugin.app, base, groupId, newOrder);
      await this.refresh();
    } catch (error) {
      console.error("[tradebook] failed to reorder entry", error);
      new Notice("Could not reorder print.");
    } finally {
      this.reorderInFlight.delete(lock);
    }
  }

  /**
   * New group creates the next pending lane and promotes it to active through
   * `setActiveGroup`, so exactly one group is active at a time. Its editable
   * display name starts as a stable queue ordinal.
   */
  private async addTrade(): Promise<void> {
    try {
      const base = "";
      const now = new Date().toISOString();
      const journalDate = dateInZone(this.journalTimeZone());
      const groups = await listPrintGroups(this.plugin.app, base);
      const ordinal = nextPrintGroupOrdinal(groups);
      const name = `Group ${ordinal}`;
      const group = await createPrintGroup(this.plugin.app, base, journalDate, now, name, ordinal);
      await setActiveGroup(this.plugin.app, base, group.id);
      await this.refresh();
      new Notice("New group added.");
    } catch (error) {
      console.error("[tradebook] failed to create print group", error);
      new Notice("Could not create a new group.");
    }
  }

  /**
   * Selecting a pending group promotes it to active and demotes the previous
   * active group (spec US8). The single-active invariant is enforced by
   * `setActiveGroup` in the lib, so the view never writes state directly.
   */
  private async selectGroup(groupId: string): Promise<void> {
    try {
      await setActiveGroup(this.plugin.app, "", groupId);
      await this.refresh();
    } catch (error) {
      console.error("[tradebook] failed to select print group", error);
      new Notice("Could not select that print group.");
    }
  }

  /**
   * Discard an empty group — the sidecar only.
   *
   * Only groups with no entryIds are discardable: the prints were already
   * removed by `removeEntryFromGroup`, so the sidecar is the last thing left.
   * A non-empty group is refused by `deletePrintGroup` in the lib, so a
   * failed capture can never be mistaken for a discard and the group stays
   * recoverable. After a successful discard the capture target is cleared so
   * the next paste falls back to the global active group.
   */
  private async discardGroup(groupId: string): Promise<void> {
    try {
      await deletePrintGroup(this.plugin.app, "", groupId);
      if (this.captureTargetGroupId === groupId) this.captureTargetGroupId = "";
      await this.refresh();
      new Notice("Empty print group moved to trash.");
    } catch (error) {
      console.error("[tradebook] failed to discard print group", error);
      new Notice("Could not discard that print group.");
    }
  }
}

class ClearPrintQueueModal extends Modal {
  constructor(
    app: App,
    private readonly onConfirm: () => void,
    private readonly clearScope: "all" | "previous-days" = "all",
  ) {
    super(app);
  }

  onOpen(): void {
    const previousDaysOnly = this.clearScope === "previous-days";
    this.modalEl.addClass("tj-print-clear-modal");
    const { contentEl } = this;
    contentEl.empty();
    const heading = contentEl.createDiv({ cls: "tj-print-clear-modal-heading" });
    const icon = heading.createDiv({ cls: "tj-print-clear-modal-icon" });
    setIcon(icon, "trash-2");
    heading.createEl("h2", {
      cls: "tj-confirm-title",
      text: previousDaysOnly ? "Clear previous days?" : "Clear Print Queue?",
    });
    contentEl.createEl("p", {
      cls: "tj-confirm-body",
      text: previousDaysOnly
        ? "Move queued prints and groups from previous days to your configured trash? Today's queue and attached trades will stay untouched."
        : "Move all queued prints and empty groups from every date to your configured trash? Attached trades will stay untouched.",
    });
    const row = contentEl.createDiv({ cls: "tj-confirm-actions" });
    row
      .createEl("button", { cls: "tj-actionbtn", text: "Keep queue", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    row
      .createEl("button", {
        cls: "tj-btn tj-btn-del",
        text: previousDaysOnly ? "Clear previous days" : "Clear all",
        attr: { type: "button" },
      })
      .addEventListener("click", () => {
        this.close();
        this.onConfirm();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
