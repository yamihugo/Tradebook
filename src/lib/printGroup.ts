import { App, normalizePath, TFile } from "obsidian";
export { TFile };

/** Print group persisted sidecar. */
export interface PrintGroup {
  /** Stable identifier (uuid-like). */
  id: string;
  /** Editable display label, e.g. "Group 1" or a trade-identifying name. */
  name: string;
  /** Stable queue order, independent of the editable display label. */
  ordinal?: number;
  /** ISO timestamp when the group was created; not the Trade entry time. */
  createdAt: string;
  /** Journal date (YYYY‑MM‑DD) of the first entry. */
  journalDate: string;
  /** Ordered list of PrintInbox entry ids belonging to this group. */
  entryIds: string[];
  /** Lifecycle state. */
  state: "latent" | "active" | "pending" | "attached";
  /** Optional trade id once attached. */
  attachedTradeId?: string;
  /** Optional queue-only wall-clock hint in HH:mm format. */
  tradeTimeHint?: string;
  /** IANA time zone in which the queue-only wall-clock hint was entered. */
  tradeTimeHintZone?: string;
}

/** Resolve stable queue order, falling back to legacy generated names. */
export function printGroupOrdinal(group: Pick<PrintGroup, "name" | "ordinal">, fallback = 1): number {
  if (group.ordinal !== undefined && Number.isInteger(group.ordinal) && group.ordinal > 0) return group.ordinal;
  const parsed = Number(/^(?:Group|Trade)\s+(\d+)/i.exec(group.name)?.[1]);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return Number.isInteger(fallback) && fallback > 0 ? fallback : 1;
}

/** Allocate the next ordinal from groups that still belong to the queue. */
export function nextPrintGroupOrdinal(groups: PrintGroup[]): number {
  const queuedGroups = groups.filter((group) => group.state !== "attached");
  return queuedGroups.reduce((max, group, index) => Math.max(max, printGroupOrdinal(group, index + 1)), 0) + 1;
}

const GROUP_ROOT = "print-groups";

export function groupRoot(base: string): string {
  return normalizePath(`${base}/${GROUP_ROOT}`).replace(/^\/+/, '');
}

function groupPath(base: string, id: string): string {
  return normalizePath(`${groupRoot(base)}/${id}.md`);
}

/** Simple front‑matter markdown for a group. */
export function groupMarkdown(g: PrintGroup): string {
  const yaml = [
    "---",
    "type: printgroup",
    `id: '${g.id}'`,
    `name: '${g.name.replace(/'/g, "''")}'`,
    g.ordinal !== undefined ? `ordinal: ${g.ordinal}` : "",
    `created_at: '${g.createdAt}'`,
    `journal_date: '${g.journalDate}'`,
    `entry_ids: ${JSON.stringify(g.entryIds)}`,
    `state: '${g.state}'`,
    g.attachedTradeId ? `attached_trade: '${g.attachedTradeId}'` : "",
    g.tradeTimeHint ? `trade_time_hint: '${g.tradeTimeHint}'` : "",
    g.tradeTimeHintZone ? `trade_time_hint_zone: '${g.tradeTimeHintZone}'` : "",
    "---",
    "",
    `# ${g.name}`,
  ].filter(Boolean).join("\n");
  return yaml;
}

/** Ensure the groups folder exists in the vault. */
async function ensureRoot(app: App, base: string): Promise<void> {
  const root = groupRoot(base);
  if (!app.vault.getAbstractFileByPath(root)) {
    const parts = normalizePath(root).split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!app.vault.getAbstractFileByPath(cur)) {
        try { await app.vault.createFolder(cur); } catch { /* concurrent */ }
      }
    }
  }
}

/** Create a new PrintGroup on the first capture.
 *
 * `ordinal` is supplied by the caller and persisted separately from the
 * editable display name, so renaming a group never changes its queue order.
 */
export async function createPrintGroup(
  app: App,
  base: string,
  journalDate: string,
  createdAt: string,
  name: string,
  ordinal?: number,
): Promise<PrintGroup> {
  await ensureRoot(app, base);
  const existingGroups = await listPrintGroups(app, base);
  const stableOrdinal = ordinal !== undefined && Number.isInteger(ordinal) && ordinal > 0
    ? ordinal
    : nextPrintGroupOrdinal(existingGroups);
  const id = `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const group: PrintGroup = {
    id,
    name,
    ordinal: stableOrdinal,
    createdAt,
    journalDate,
    entryIds: [],
    state: "active",
  };
  const file = groupPath(base, id);
  await app.vault.create(file, groupMarkdown(group));
  return group;
}

/** Load a group by id. */
export async function loadPrintGroup(app: App, base: string, id: string): Promise<PrintGroup | null> {
  const file = groupPath(base, id);
  const abstract = app.vault.getAbstractFileByPath(file);
  if (!(abstract instanceof TFile)) return null;
  try {
    const raw = await app.vault.cachedRead(abstract);
    const parts = raw.split("---");
    if (parts.length < 3) return null;
    const fm = parts[1];
    const lines = fm.split(/\r?\n/);
    const get = (k: string) => {
      const line = lines.find((l: string) => l.startsWith(`${k}:`));
      if (!line) return "";
      const idx = line.indexOf(":");
      if (idx === -1) return "";
      const val = line.slice(idx + 1).trim();
      return val.replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
    };
    const entryIdsRaw = get("entry_ids");
    const entryIds: string[] = entryIdsRaw ? JSON.parse(entryIdsRaw) : [];
    return {
      id: get("id"),
      name: get("name"),
      ordinal: Number.isInteger(Number(get("ordinal"))) && Number(get("ordinal")) > 0
        ? Number(get("ordinal"))
        : undefined,
      createdAt: get("created_at"),
      journalDate: get("journal_date"),
      entryIds,
      state: (get("state") || "active") as PrintGroup["state"],
      attachedTradeId: get("attached_trade") || undefined,
      tradeTimeHint: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(get("trade_time_hint")) ? get("trade_time_hint") : undefined,
      tradeTimeHintZone: get("trade_time_hint_zone") || undefined,
    };
  } catch {
    return null;
  }
}

/** Add an entry id to a group (persisted). */
export async function addEntryToGroup(app: App, base: string, groupId: string, entryId: string): Promise<void> {
  const group = await loadPrintGroup(app, base, groupId);
  if (!group) throw new Error("PrintGroup not found");
  if (group.state === "attached") throw new Error("Cannot add prints to an attached group");
  const next = [...new Set([...group.entryIds, entryId])];
  if (next.length === group.entryIds.length && next.every((id, index) => id === group.entryIds[index])) return;
  group.entryIds = next;
  const file = groupPath(base, groupId);
  const abstract = app.vault.getAbstractFileByPath(file);
  if (!(abstract instanceof TFile)) throw new Error("PrintGroup not found");
  await app.vault.modify(abstract, groupMarkdown(group));
}

/** Remove an entry id from a group (persisted). */
export async function removeEntryFromGroup(
  app: App,
  base: string,
  groupId: string,
  entryId: string,
): Promise<void> {
  const group = await loadPrintGroup(app, base, groupId);
  if (!group) throw new Error("PrintGroup not found");
  const previous = [...group.entryIds];
  const next = previous.filter((id) => id !== entryId);
  const removed = next.length !== previous.length;
  group.entryIds = next;
  const file = groupPath(base, groupId);
  const abstract = app.vault.getAbstractFileByPath(file);
  if (!(abstract instanceof TFile)) throw new Error("PrintGroup not found");
  try {
    await app.vault.modify(abstract, groupMarkdown(group));
  } catch (error) {
    // Atomicity: if the write fails the sidecar on disk still carries the
    // entryId, so restore the in-memory list before rethrowing. Callers that
    // catch this (e.g. the view's remove flow) must NOT proceed to delete the
    // inbox entry — a failed group update must never leave a dangling
    // entryId in the sidecar or a deleted entry without group membership.
    if (removed) group.entryIds = previous;
    throw error;
  }
}

/** Reorder the entryIds of a group (persisted). */
export async function reorderGroupEntries(
  app: App,
  base: string,
  groupId: string,
  newOrder: string[],
): Promise<void> {
  const group = await loadPrintGroup(app, base, groupId);
  if (!group) throw new Error("PrintGroup not found");
  const currentOrder = [...new Set(group.entryIds)];
  const requested = [...new Set(newOrder)];
  if (requested.length !== currentOrder.length || requested.some((id) => !currentOrder.includes(id))) {
    throw new Error("Invalid reorder list for PrintGroup");
  }
  group.entryIds = requested;
  const file = groupPath(base, groupId);
  const abstract = app.vault.getAbstractFileByPath(file);
  if (!(abstract instanceof TFile)) throw new Error("PrintGroup not found");
  await app.vault.modify(abstract, groupMarkdown(group));
}

/** Move an entry from one group to another (persisted). */
export async function moveEntryToGroup(
  app: App,
  base: string,
  fromGroupId: string,
  toGroupId: string,
  entryId: string,
): Promise<void> {
  await removeEntryFromGroup(app, base, fromGroupId, entryId);
  await addEntryToGroup(app, base, toGroupId, entryId);
}

/** Set the lifecycle state of a group (persisted). */
export async function setGroupState(
  app: App,
  base: string,
  groupId: string,
  state: PrintGroup["state"],
): Promise<void> {
  const group = await loadPrintGroup(app, base, groupId);
  if (!group) throw new Error("PrintGroup not found");
  group.state = state;
  const file = groupPath(base, groupId);
  const abstract = app.vault.getAbstractFileByPath(file);
  if (!(abstract instanceof TFile)) throw new Error("PrintGroup not found");
  await app.vault.modify(abstract, groupMarkdown(group));
}

/** Rename a pending queue group without attaching it or changing its prints. */
export async function renamePrintGroup(
  app: App,
  base: string,
  groupId: string,
  name: string,
  ordinal?: number,
): Promise<void> {
  const group = await loadPrintGroup(app, base, groupId);
  if (!group) throw new Error("PrintGroup not found");
  if (group.state === "attached") throw new Error("Cannot rename an attached group");

  const normalizedName = name.replace(/\s+/g, " ").trim();
  if (!normalizedName) throw new Error("Group name cannot be empty");
  if (normalizedName.length > 80) throw new Error("Group name must be 80 characters or fewer");

  if (group.ordinal === undefined) {
    const legacyOrdinal = Number(/^(?:Group|Trade)\s+(\d+)/i.exec(group.name)?.[1]);
    if (Number.isInteger(legacyOrdinal) && legacyOrdinal > 0) group.ordinal = legacyOrdinal;
    else if (ordinal !== undefined && Number.isInteger(ordinal) && ordinal > 0) group.ordinal = ordinal;
  }
  group.name = normalizedName;
  const file = groupPath(base, groupId);
  const abstract = app.vault.getAbstractFileByPath(file);
  if (!(abstract instanceof TFile)) throw new Error("PrintGroup not found");
  await app.vault.modify(abstract, groupMarkdown(group));
}

/** Persist a queue-only trade-time hint without changing capture or Trade data. */
export async function setTradeTimeHint(
  app: App,
  base: string,
  groupId: string,
  tradeTimeHint: string | undefined,
  timeZone?: string,
): Promise<void> {
  const group = await loadPrintGroup(app, base, groupId);
  if (!group) throw new Error("PrintGroup not found");
  if (group.state === "attached") throw new Error("Cannot edit the time hint of an attached group");

  if (tradeTimeHint !== undefined) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(tradeTimeHint)) {
      throw new Error("Invalid trade-time hint; use HH:mm");
    }
    if (!timeZone) throw new Error("A time zone is required for a trade-time hint");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    } catch {
      throw new Error("Invalid time zone for trade-time hint");
    }
    group.tradeTimeHint = tradeTimeHint;
    group.tradeTimeHintZone = timeZone;
  } else {
    delete group.tradeTimeHint;
    delete group.tradeTimeHintZone;
  }

  const file = groupPath(base, groupId);
  const abstract = app.vault.getAbstractFileByPath(file);
  if (!(abstract instanceof TFile)) throw new Error("PrintGroup not found");
  await app.vault.modify(abstract, groupMarkdown(group));
}

/** Persist the editable queue label and time hint as one sidecar update. */
export async function updatePrintGroupDetails(
  app: App,
  base: string,
  groupId: string,
  name: string,
  tradeTimeHint: string | undefined,
  timeZone: string | undefined,
  ordinal?: number,
): Promise<void> {
  const group = await loadPrintGroup(app, base, groupId);
  if (!group) throw new Error("PrintGroup not found");
  if (group.state === "attached") throw new Error("Cannot edit an attached group");

  const normalizedName = name.replace(/\s+/g, " ").trim();
  if (!normalizedName) throw new Error("Group name cannot be empty");
  if (normalizedName.length > 80) throw new Error("Group name must be 80 characters or fewer");

  if (tradeTimeHint !== undefined) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(tradeTimeHint)) {
      throw new Error("Invalid trade-time hint; use HH:mm");
    }
    if (!timeZone) throw new Error("A time zone is required for a trade-time hint");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    } catch {
      throw new Error("Invalid time zone for trade-time hint");
    }
  }

  if (group.ordinal === undefined) {
    const legacyOrdinal = Number(/^(?:Group|Trade)\s+(\d+)/i.exec(group.name)?.[1]);
    if (Number.isInteger(legacyOrdinal) && legacyOrdinal > 0) group.ordinal = legacyOrdinal;
    else if (ordinal !== undefined && Number.isInteger(ordinal) && ordinal > 0) group.ordinal = ordinal;
  }
  group.name = normalizedName;
  if (tradeTimeHint !== undefined) {
    group.tradeTimeHint = tradeTimeHint;
    group.tradeTimeHintZone = timeZone;
  } else {
    delete group.tradeTimeHint;
    delete group.tradeTimeHintZone;
  }

  const file = groupPath(base, groupId);
  const abstract = app.vault.getAbstractFileByPath(file);
  if (!(abstract instanceof TFile)) throw new Error("PrintGroup not found");
  await app.vault.modify(abstract, groupMarkdown(group));
}

/** Get the currently active group (state === "active"). Returns null if none. */
export async function getActiveGroup(app: App, base: string): Promise<PrintGroup | null> {
  const groups = await listPrintGroups(app, base);
  return groups.find((g) => g.state === "active") ?? null;
}

/** Count only groups still in the pending queue. Stable ordinals are allocated separately. */
export function pendingGroupCount(groups: PrintGroup[]): number {
  return groups.filter((g) => g.state !== "attached").length;
}

/**
 * Pure routing decision for capture entry placement.
 *
 * Phase C: routeCapture uses the global active-group model regardless of journal date.
 * When no group is active, its ordinal advances past queued groups only. Attached
 * groups are no longer part of the queue and do not prevent a fresh queue starting at Group 1.
 */
export type CaptureRoute = { kind: "use"; groupId: string } | { kind: "create"; ordinal: number };

export function routeCapture(groups: PrintGroup[]): CaptureRoute {
  // Global active find: there should be exactly one active group by the state machine.
  const active = groups.find((g) => g.state === "active");
  if (active) return { kind: "use", groupId: active.id };
  return { kind: "create", ordinal: nextPrintGroupOrdinal(groups) };
}

/**
 * Make exactly one group active. Selecting a pending group promotes it and
 * demotes the previously active one; the queue never holds two actives. This is
 * the single transaction the view routes every selection and "Add Trade"
 * through, so the two active-group models in the codebase cannot drift apart.
 */
export async function setActiveGroup(
  app: App,
  base: string,
  groupId: string,
): Promise<PrintGroup | null> {
  const target = await loadPrintGroup(app, base, groupId);
  if (!target || target.state === "attached") return null;
  const groups = await listPrintGroups(app, base);
  for (const g of groups) {
    if (g.id === groupId) {
      if (g.state !== "active") await setGroupState(app, base, g.id, "active");
    } else if (g.state === "active") {
      await setGroupState(app, base, g.id, "pending");
    }
  }
  return target;
}

/**
 * Move an empty group's sidecar file to the user's configured trash.
 *
 * The group must have no entryIds — the prints themselves were already removed
 * by `removeEntryFromGroup`, so the sidecar is the only thing left to move.
 * Refusing to trash a non-empty group keeps the discard affordance honest: it
 * is a cleanup for groups emptied after their last print, never a way to throw
 * away work.
  */
 export async function deletePrintGroup(app: App, base: string, groupId: string): Promise<void> {
   const group = await loadPrintGroup(app, base, groupId);
   if (!group) throw new Error("PrintGroup not found");
   if (group.entryIds.length > 0) {
     throw new Error("Cannot discard a group that still holds prints.");
   }
   if (group.state === "attached") return; // already gone from the queue
   const file = groupPath(base, groupId);
   const abstract = app.vault.getAbstractFileByPath(file);
   if (!(abstract instanceof TFile)) throw new Error("PrintGroup not found");
   await app.fileManager.trashFile(abstract);
 }

 /**
 * Mark a group attached only after its image references have been written to
 * the trade note. This sidecar transition is the queue's durable completion
 * marker; an uncertain write is read back by the attach workflow.
 */
export async function attachGroupSidecar(
  app: App,
  base: string,
  groupId: string,
  tradeId: string,
): Promise<void> {
  const group = await loadPrintGroup(app, base, groupId);
  if (!group) throw new Error("PrintGroup not found");
  if (group.state === "attached") {
    if (group.attachedTradeId === tradeId) return;
    throw new Error("PrintGroup already attached to a different trade");
  }
  group.state = "attached";
  group.attachedTradeId = tradeId;
  const file = groupPath(base, groupId);
  const abstract = app.vault.getAbstractFileByPath(file);
  if (!(abstract instanceof TFile)) throw new Error("PrintGroup not found");
  await app.vault.modify(abstract, groupMarkdown(group));
}

/**
 * Roll an attached group back to pending after a failed attach.
 *
 * The trade link is dropped, so the group is recoverable and the trade note
 * carries no dangling reference to a group that is not attached.
 */
export async function restoreGroupPending(
  app: App,
  base: string,
  groupId: string,
): Promise<void> {
  const group = await loadPrintGroup(app, base, groupId);
  if (!group) throw new Error("PrintGroup not found");
  if (group.state !== "attached") return;
  group.state = "pending";
  group.attachedTradeId = undefined;
  const file = groupPath(base, groupId);
  const abstract = app.vault.getAbstractFileByPath(file);
  if (!(abstract instanceof TFile)) throw new Error("PrintGroup not found");
  await app.vault.modify(abstract, groupMarkdown(group));
}

/** List all groups. */
export async function listPrintGroups(app: App, base: string): Promise<PrintGroup[]> {
  const root = groupRoot(base);
  const files = app.vault.getFiles()
    .filter(f => f.extension === "md")
    .filter(f => {
      const norm = f.path.startsWith("/") ? f.path.slice(1) : f.path;
      return norm.startsWith(root + "/");
    });
  const groups: PrintGroup[] = [];
  for (const f of files) {
    const id = f.name.replace(/\.md$/, "");
    const g = await loadPrintGroup(app, base, id);
    if (g) groups.push(g);
  }
  return groups;
}
