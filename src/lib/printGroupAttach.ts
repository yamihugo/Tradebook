import { TFile, normalizePath, type App } from "obsidian";
import type { Trade, PrintEntry } from "../types";
import { appendTradeScreenshots } from "../storage";
import { listPrintInboxEntries, type PrintInboxEntry } from "./printInbox";
import {
  attachGroupSidecar,
  groupRoot,
  loadPrintGroup,
  listPrintGroups,
  type PrintGroup,
} from "./printGroup";

/**
 * Phase E: filing a whole Print Group into Trade Detail.
 *
 * The drag payload is private and carries the group id only — never raw image
 * data. Trade Detail accepts it only when it identifies a complete, valid
 * unattached group. Existing screenshot paths are preserved and group paths are
 * appended idempotently before the group is marked attached. Empty or incomplete
 * groups stay queued; on a write failure, retryable state is reported honestly.
 */

/** Private MIME type carried by a Print Group drag. The data is JSON, v1. */
export const PRINT_GROUP_MIME = "application/x-tradebook-print-group";

export interface PrintGroupDragPayload {
  v: 1;
  groupId: string;
}

/** Build the drag payload a group card emits on dragstart. */
export function makePrintGroupDragPayload(groupId: string): string {
  return JSON.stringify({ v: 1, groupId } satisfies PrintGroupDragPayload);
}

/** Parse a dataTransfer value back into a drag payload. Rejects anything else. */
export function parsePrintGroupDragPayload(raw: string): PrintGroupDragPayload | null {
  if (typeof raw !== "string" || !raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (o.v !== 1 || typeof o.groupId !== "string" || !o.groupId) return null;
  return { v: 1, groupId: o.groupId };
}

export interface AttachGroupResult {
  ok: true;
  idempotent: boolean;
  groupId: string;
  /** How many prints were appended to the trade (0 for an idempotent no-op). */
  screenshotCount: number;
}

export interface AttachGroupError {
  ok: false;
  error: string;
  /** True when the group was marked attached and then rolled back. */
  rolledBack: boolean;
}

export type AttachGroupOutcome = AttachGroupResult | AttachGroupError;

/**
 * The groups a secondary attach action can offer: every group still in the
 * pending queue. Attached groups have left the queue and are not listed.
 */
export async function listPendingAttachGroups(app: App, base = ""): Promise<PrintGroup[]> {
  const groups = await listPrintGroups(app, base);
  return groups.filter((g) => g.state === "pending" || g.state === "active");
}

/**
 * Attach a whole Print Group to a trade's screenshot list.
 *
 * Write order is the failure contract:
 *  1. Validate the complete group and the trade note before writing.
 *  2. Atomically append the existing image references against the latest trade
 *     note, de-duplicating paths so a retry cannot duplicate evidence.
 *  3. Mark the group attached only after the trade note write succeeds. If the
 *     sidecar outcome is uncertain, read it back before reporting success.
 *
 * Re-attaching to the same trade is idempotent; attaching to a different trade
 * is rejected.
 */
const attachmentQueues = new WeakMap<App["vault"], Map<string, Promise<AttachGroupOutcome>>>();

export async function attachGroupToTrade(
  app: App, trade: Trade, tradeId: string, groupId: string, groupBase = "", tradesRoot = "",
): Promise<AttachGroupOutcome> {
  let queues = attachmentQueues.get(app.vault);
  if (!queues) { queues = new Map(); attachmentQueues.set(app.vault, queues); }
  const key = normalizePath(`${groupRoot(groupBase)}/${groupId}.md`);
  const previous = queues.get(key);
  const ready = previous ? previous.then(() => undefined, () => undefined) : Promise.resolve();
  const operation = ready.then(() => attachGroupExclusively(app, trade, tradeId, groupId, groupBase, tradesRoot));
  queues.set(key, operation);
  try { return await operation; }
  finally { if (queues.get(key) === operation) queues.delete(key); }
}

/** Validation, note append and ownership completion share one group-wide queue. */
async function attachGroupExclusively(
  app: App,
  trade: Trade,
  tradeId: string,
  groupId: string,
  groupBase: string,
  tradesRoot: string,
): Promise<AttachGroupOutcome> {
  const group = await loadPrintGroup(app, groupBase, groupId);
  if (!group) return { ok: false, error: "Print group not found", rolledBack: false };
  if (group.state === "attached") {
    if (group.attachedTradeId === tradeId) {
      return { ok: true, idempotent: true, groupId, screenshotCount: 0 };
    }
    return { ok: false, error: "This print group is already attached to another trade", rolledBack: false };
  }
  if (group.state !== "pending" && group.state !== "active") {
    return { ok: false, error: "Print group is not attachable", rolledBack: false };
  }
  if (!Array.isArray(group.entryIds) || group.entryIds.length === 0) {
    return { ok: false, error: "This print group has no captures and remains in the queue", rolledBack: false };
  }
  if (new Set(group.entryIds).size !== group.entryIds.length) {
    return { ok: false, error: "This print group has duplicate entries and remains in the queue", rolledBack: false };
  }

  const entries = await listPrintInboxEntries(app, tradesRoot);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ordered = group.entryIds.map((id) => byId.get(id)).filter((entry): entry is PrintInboxEntry => !!entry);
  if (ordered.length !== group.entryIds.length || ordered.some((entry) =>
    !entry.imagePath.trim() || !(app.vault.getAbstractFileByPath(entry.imagePath) instanceof TFile)
  )) {
    return { ok: false, error: "Some captures are unavailable; the print group remains in the queue", rolledBack: false };
  }

  const file = app.vault.getAbstractFileByPath(tradeId);
  if (!(file instanceof TFile)) {
    return { ok: false, error: "Trade note not found", rolledBack: false };
  }

  // Persist evidence first, atomically appending against the latest note content.
  // A failure leaves the group pending; retrying is safe because paths are deduped.
  const additions = ordered.map((entry) => ({ file: entry.imagePath.trim() }));
  let saved: PrintEntry[];
  let appended = 0;
  try {
    const result = await appendTradeScreenshots(app, file, additions);
    saved = result.screenshots;
    appended = result.appended;
    trade.screenshots = saved;
    trade.screenshot = saved[0]?.file ?? "";
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not save screenshots";
    return { ok: false, error: `${detail}. The group remains available in the queue; retry is safe.`, rolledBack: false };
  }

  // Mark attached only after the trade note contains the evidence. If the
  // sidecar write outcome is uncertain, read it back before reporting success.
  try {
    await attachGroupSidecar(app, groupBase, groupId, tradeId);
    return { ok: true, idempotent: false, groupId, screenshotCount: appended };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not mark print group attached";
    const latest = await loadPrintGroup(app, groupBase, groupId).catch(() => null);
    if (latest?.state === "attached") {
      if (latest.attachedTradeId === tradeId) {
        return { ok: true, idempotent: false, groupId, screenshotCount: appended };
      }
      return {
        ok: false,
        error: "The group was attached elsewhere while screenshots were saved to this trade. Review both trade records before continuing.",
        rolledBack: false,
      };
    }
    if (latest) {
      return {
        ok: false,
        error: `Screenshots are saved to the trade, but the group remains in the queue. Retry is safe. ${detail}`,
        rolledBack: false,
      };
    }
    return {
      ok: false,
      error: `Screenshots are saved to the trade, but the group state could not be confirmed. Check the queue before retrying. ${detail}`,
      rolledBack: false,
    };
  }
}