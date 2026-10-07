import { TFile, normalizePath, type App } from "obsidian";

export type PrintInboxSource = "paste" | "drop" | "file";
export type PrintInboxStatus = "unassigned";

export interface PrintInboxEntry {
  id: string;
  capturedAt: string;
  journalDate: string;
  imagePath: string;
  /** Exact sidecar discovered or created for this entry. Never derive it from editable metadata. */
  metadataPath: string;
  title: string;
  note?: string;
  source: PrintInboxSource;
  status: PrintInboxStatus;
}

export interface PrintInboxGroup {
  date: string;
  entries: PrintInboxEntry[];
}

const SAFE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const SAFE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function printInboxRoot(root: string): string {
  return normalizePath(`${root || "Tradebook"}/print-inbox`);
}

export function printInboxDayFolder(root: string, journalDate: string): string {
  return normalizePath(`${printInboxRoot(root)}/${journalDate}`);
}

export function imageExtension(type: string, name = ""): string {
  const fromName = name.toLowerCase().split(".").pop() ?? "";
  if (SAFE_EXTENSIONS.has(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "png";
}

function safeTitle(name: string): string {
  return (name || "Print")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Print";
}

function stamp(capturedAt: string): string {
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return "00-00-00";
  return [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join("-");
}

export function printInboxImagePath(root: string, journalDate: string, capturedAt: string, name: string, type = "image/png"): string {
  return normalizePath(`${printInboxDayFolder(root, journalDate)}/${stamp(capturedAt)} ${safeTitle(name)}.${imageExtension(type, name)}`);
}

export function printInboxMarkdown(entry: PrintInboxEntry): string {
  const quote = (value: string): string => `'${String(value).replace(/'/g, "''")}'`;
  return [
    "---",
    "type: print",
    `id: ${quote(entry.id)}`,
    `captured_at: ${quote(entry.capturedAt)}`,
    `journal_date: ${quote(entry.journalDate)}`,
    `image: ${quote(entry.imagePath)}`,
    `title: ${quote(entry.title)}`,
    `source: ${entry.source}`,
    `status: ${entry.status}`,
    ...(entry.note
      ? entry.note.includes("\n")
        ? [`note_json: ${JSON.stringify(entry.note)}`]
        : [`note: ${quote(entry.note)}`]
      : []),
    "---",
    "",
    `# ${entry.title}`,
    "",
    entry.note ? entry.note : "",
    "",
  ].join("\n");
}

function yamlRawValue(frontmatter: string, key: string): string {
  const line = frontmatter.split(/\r?\n/).find((x) => new RegExp(`^${key}:`).test(x));
  if (!line) return "";
  return line.slice(key.length + 1).trim();
}

function yamlValue(frontmatter: string, key: string): string {
  const raw = yamlRawValue(frontmatter, key);
  if (!raw) return "";
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw.replace(/^"|"$/g, "");
}

function jsonValue(frontmatter: string, key: string): string {
  const raw = yamlRawValue(frontmatter, key);
  if (!raw) return "";
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export function parsePrintInboxMarkdown(markdown: string, fallbackId = "", metadataPath = ""): PrintInboxEntry | null {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown.replace(/\r/g, ""));
  if (!match || yamlValue(match[1], "type") !== "print") return null;
  const imagePath = yamlValue(match[1], "image");
  const capturedAt = yamlValue(match[1], "captured_at");
  const journalDate = yamlValue(match[1], "journal_date");
  if (!imagePath || !capturedAt || !journalDate) return null;
  return {
    id: yamlValue(match[1], "id") || fallbackId,
    capturedAt,
    journalDate,
    imagePath,
    metadataPath: normalizePath(metadataPath || imagePath.replace(/\.[^.]+$/, ".md")),
    title: yamlValue(match[1], "title") || imagePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "Print",
    note: jsonValue(match[1], "note_json") || yamlValue(match[1], "note") || undefined,
    source: (yamlValue(match[1], "source") || "file") as PrintInboxSource,
    status: "unassigned",
  };
}

export function isSafePrintInboxEntry(root: string, entry: Pick<PrintInboxEntry, "imagePath" | "metadataPath">): boolean {
  if (!entry.imagePath || !entry.metadataPath) return false;
  if (entry.imagePath.split(/[\\/]/).includes("..") || entry.metadataPath.split(/[\\/]/).includes("..")) return false;
  const prefix = `${printInboxRoot(root)}/`;
  const imagePath = normalizePath(entry.imagePath);
  const metadataPath = normalizePath(entry.metadataPath);
  if (!imagePath.startsWith(prefix) || !metadataPath.startsWith(prefix)) return false;
  const extension = imagePath.split(".").pop()?.toLowerCase() ?? "";
  if (!SAFE_EXTENSIONS.has(extension) || extension === "jpeg") return false;
  return metadataPath === imagePath.replace(/\.[^.]+$/, ".md");
}

export function groupPrintInboxEntries(entries: PrintInboxEntry[]): PrintInboxGroup[] {
  const groups = new Map<string, PrintInboxEntry[]>();
  for (const entry of [...entries].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))) {
    const list = groups.get(entry.journalDate) ?? [];
    list.push(entry);
    groups.set(entry.journalDate, list);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, grouped]) => ({ date, entries: grouped }));
}

async function ensureDir(app: App, dir: string): Promise<void> {
  const parts = normalizePath(dir).split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      try { await app.vault.createFolder(current); } catch { /* concurrent creation */ }
    }
  }
}

export async function savePrintInboxEntry(
  app: App,
  root: string,
  file: File,
  journalDate: string,
  source: PrintInboxSource,
  capturedAt = new Date().toISOString(),
): Promise<PrintInboxEntry> {
  if (!SAFE_IMAGE_TYPES.has(file.type)) throw new Error("Print Queue accepts PNG, JPEG, WebP, or GIF images only.");
  const folder = printInboxDayFolder(root, journalDate);
  await ensureDir(app, folder);
  const id = `print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const title = safeTitle(file.name);
  const imagePath = printInboxImagePath(root, journalDate, capturedAt, `${title}-${id}`, file.type);
  const sidecarPath = imagePath.replace(/\.[^.]+$/, ".md");
  await app.vault.createBinary(imagePath, await file.arrayBuffer());
  const entry: PrintInboxEntry = { id, capturedAt, journalDate, imagePath, metadataPath: sidecarPath, title, source, status: "unassigned" };
  try {
    await app.vault.create(sidecarPath, printInboxMarkdown(entry));
  } catch (error) {
    const createdImage = app.vault.getAbstractFileByPath(imagePath);
    if (createdImage) {
      try { await app.vault.delete(createdImage); }
      catch (rollbackError) { console.error("[tradebook] failed to roll back orphaned Print Queue image", rollbackError); }
    }
    throw error;
  }
  return entry;
}

export async function listPrintInboxEntries(app: App, root: string): Promise<PrintInboxEntry[]> {
  const prefix = `${printInboxRoot(root)}/`;
  const candidates = typeof app.vault.getMarkdownFiles === "function"
    ? app.vault.getMarkdownFiles()
    : app.vault.getFiles().filter((file) => file.extension === "md");
  const files = candidates.filter((file) => file.path.startsWith(prefix));
  const entries: PrintInboxEntry[] = [];
  for (const file of files) {
    const parsed = parsePrintInboxMarkdown(await app.vault.cachedRead(file), file.path, file.path);
    if (parsed && isSafePrintInboxEntry(root, parsed)) entries.push(parsed);
  }
  return entries;
}

export async function updatePrintInboxEntry(app: App, root: string, entry: PrintInboxEntry): Promise<void> {
  if (!isSafePrintInboxEntry(root, entry)) throw new Error("Print Queue entry path is invalid.");
  const sidecar = app.vault.getAbstractFileByPath(entry.metadataPath);
  if (!(sidecar instanceof TFile)) throw new Error("Print metadata file is missing.");
  await app.vault.modify(sidecar, printInboxMarkdown(entry));
}

export async function deletePrintInboxEntry(app: App, root: string, entry: PrintInboxEntry): Promise<void> {
  if (!isSafePrintInboxEntry(root, entry)) throw new Error("Print Queue entry path is invalid.");
  const image = app.vault.getAbstractFileByPath(entry.imagePath);
  const sidecar = app.vault.getAbstractFileByPath(entry.metadataPath);
  if (image && !(image instanceof TFile)) throw new Error("Print image path is not a file.");
  if (sidecar && !(sidecar instanceof TFile)) throw new Error("Print metadata path is not a file.");
  const sidecarText = sidecar instanceof TFile ? await app.vault.cachedRead(sidecar) : "";
  if (sidecar instanceof TFile) await app.vault.delete(sidecar);
  try {
    if (image instanceof TFile) await app.vault.delete(image);
  } catch (error) {
    if (sidecarText) {
      try { await app.vault.create(entry.metadataPath, sidecarText); }
      catch (rollbackError) { console.error("[tradebook] failed to restore Print Queue metadata", rollbackError); }
    }
    throw error;
  }
}
