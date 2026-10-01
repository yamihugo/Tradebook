import type { TradebookSettings } from "../main";

/**
 * The backup format. One file that puts a journal back the way it was: every
 * setting, every account, and the trade notes themselves. It is deliberately a
 * plain JSON object with a `kind` marker — a reader can tell at a glance whether
 * a file is ours, and a future version can migrate instead of guessing.
 *
 * Prints are images in the vault, not data we own: the backup lists the trade
 * notes and says so in the UI. For a byte-for-byte copy of everything including
 * screenshots, copy the vault folder (that is what the tutorial tells people).
 */
export const BACKUP_KIND = "tradebook-backup";
export const BACKUP_VERSION = 1;

export interface BackupNote {
  /** Path relative to the vault, exactly as the note lives today. */
  path: string;
  content: string;
}

export interface BackupPayload {
  kind: typeof BACKUP_KIND;
  version: number;
  exportedAt: string;
  pluginVersion: string;
  settings: TradebookSettings;
  notes: BackupNote[];
  counts: {
    accounts: number;
    archived: number;
    trades: number;
    payouts: number;
    deposits: number;
  };
}

export interface BackupSummary {
  ok: boolean;
  error?: string;
  payload?: BackupPayload;
  exportedAt?: string;
  version?: number;
  pluginVersion?: string;
  accounts?: number;
  archived?: number;
  trades?: number;
  payouts?: number;
  deposits?: number;
}

/** The default file name: the journal's own name plus the day it was taken. */
export function backupFilename(when = new Date()): string {
  const d = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
  return `tradebook-backup-${d}.json`;
}

export function buildBackup(args: {
  settings: TradebookSettings;
  pluginVersion: string;
  notes: BackupNote[];
}): BackupPayload {
  const s = args.settings;
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    pluginVersion: args.pluginVersion,
    settings: JSON.parse(JSON.stringify(s)) as TradebookSettings,
    notes: args.notes,
    counts: {
      accounts: (s.propAccounts ?? []).length,
      archived: (s.archivedAccounts ?? []).length,
      trades: args.notes.length,
      payouts: (s.payouts ?? []).length,
      deposits: (s.deposits ?? []).length,
    },
  };
}

/**
 * Read a file the user picked and say what is inside it. Anything that is not one
 * of our backups is refused with a sentence a person can act on, never with a
 * stack trace.
 */
export function summariseBackup(raw: unknown): BackupSummary {
  const data = raw as Partial<BackupPayload> | null;
  if (!data || typeof data !== "object") return { ok: false, error: "That file is not JSON." };
  if (data.kind !== BACKUP_KIND) {
    return {
      ok: false,
      error:
        data.kind === undefined
          ? "That looks like a settings-only export, not a full backup. Nothing was changed."
          : "That file was not created by this plugin. Nothing was changed.",
    };
  }
  if (typeof data.version !== "number" || data.version > BACKUP_VERSION) {
    return { ok: false, error: `That backup was made by a newer version (v${String(data.version)}). Update the plugin first.` };
  }
  if (!data.settings || typeof data.settings !== "object") {
    return { ok: false, error: "The backup has no settings inside. Nothing was changed." };
  }
  const c = (data.counts ?? {}) as BackupPayload["counts"];
  return {
    ok: true,
    payload: data as BackupPayload,
    exportedAt: data.exportedAt ?? "",
    version: data.version,
    pluginVersion: data.pluginVersion ?? "?",
    accounts: c.accounts ?? (data.settings.propAccounts ?? []).length,
    archived: c.archived ?? (data.settings.archivedAccounts ?? []).length,
    trades: c.trades ?? (data.notes ?? []).length,
    payouts: c.payouts ?? (data.settings.payouts ?? []).length,
    deposits: c.deposits ?? (data.settings.deposits ?? []).length,
  };
}

if (typeof window !== "undefined") {
  (window as any).__tjBackup = { buildBackup, summariseBackup, backupFilename, BACKUP_KIND, BACKUP_VERSION };
}
