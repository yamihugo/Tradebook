import { App, TFile, normalizePath } from "obsidian";
import { PrintEntry, Trade, TradeFill } from "./types";
import { formatDateFile } from "./lib/dates";
import { normalizeOrderType } from "./lib/tradeTable";
import { fmtPrice } from "./tz";

/**
 * The `fills:` block, written only when a position was scaled in or out.
 * One flat YAML list, indented two spaces, readable and editable by hand:
 *
 *     fills:
 *       - side: sell
 *         time: "10:04:12"
 *         qty: 2
 *         price: 21010
 *         pnl: 19.5
 *         fees: 0.61
 */
function fillLines(t: Trade): string[] {
  const fills = (t.fills ?? []).filter((f) => Number.isFinite(f.qty) && Number.isFinite(f.price));
  if (!fills.length) return [];
  const out = ["fills:"];
  for (const f of fills) {
    out.push(`  - side: ${f.side === "sell" ? "sell" : "buy"}`);
    out.push(`    time: "${f.time ?? ""}"`);
    out.push(`    qty: ${f.qty}`);
    out.push(`    price: ${f.price}`);
    if (Number.isFinite(f.pnl)) out.push(`    pnl: ${f.pnl}`);
    if (Number.isFinite(f.fees)) out.push(`    fees: ${f.fees}`);
    if (f.orderType) out.push(`    order_type: "${f.orderType}"`);
    if (f.fillId) out.push(`    fill_id: "${f.fillId.replace(/"/g, '\\"')}"`);
  }
  return out;
}

function screenshotsLines(t: Trade): string[] {
  const shots = t.screenshots ?? [];
  if (!shots.length) return [];
  const out = ["screenshots:"];
  for (const s of shots) {
    out.push(`  - file: "${s.file}"`);
    if (s.note) out.push(`    note: "${s.note.replace(/"/g, '\\"')}"`);
  }
  return out;
}

/**
 * A `string[]` as a YAML inline array — the shape the parser reads back.
 * `updateTradeFields` quotes every value, which would turn a list into a single
 * scalar, so array fields go through here instead.
 */
export function inlineArray(values?: string[]): string {
  return `[${(values ?? []).map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(", ")}]`;
}

export function tradeToMarkdown(t: Trade): string {
  /**
   * A number for the frontmatter, or nothing at all.
   *
   * Hand-journalled and direct-P&L trades have no prices, and `parseFloat` of an
   * absent field is `NaN` — writing `entry_price: NaN` into a note would be us
   * corrupting the user's own file. Omitting the line keeps the absence honest
   * and round-trips back to `NaN`, which the UI prints as "—".
   */
  const num = (label: string, value: number | undefined): string | null =>
    Number.isFinite(Number(value)) ? `${label}: ${value}` : null;
  const frontmatter = [
    // Identity for vault discovery: the plugin finds trades by this key, not by
    // folder, so the notes can be reorganised without ever breaking the journal.
    `type: trade`,
    `date: ${t.date}`,
    `symbol: ${t.symbol}`,
    `account: ${quoteYaml(t.account)}`,
    `account_type: ${t.accountType}`,
    `direction: ${t.direction}`,
    num("quantity", t.quantity),
    num("entry_price", t.entryPrice),
    num("exit_price", t.exitPrice),
    num("stop_loss", t.stopLoss ?? 0),
    num("target", t.target ?? 0),
    num("pnl", t.pnl),
    num("pnl_points", t.pnlPoints),
    // The platform's bill lives at the trade level as well as inside each fill:
    // without it a reload loses every cost the cash history brought, and the
    // fees card reads $0.00 on a trade that was charged. Zero is omitted so a
    // note with no cost stays clean.
    t.commission ? num("commission", t.commission) : null,
    t.fees ? num("fees", t.fees) : null,
    `entry_time: ${t.entryTime}`,
    `exit_time: ${t.exitTime}`,
    ...fillLines(t),
    `setup: ${quoteYaml(t.setup ?? "")}`,
    `mistake: ${quoteYaml(t.mistake ?? "")}`,
    `thesis: ${quoteYaml(t.thesis ?? "")}`,
    `review: ${quoteYaml(t.review ?? "")}`,
    t.orderType ? `order_type: "${t.orderType}"` : null,
    t.fillId ? `fill_id: ${quoteYaml(t.fillId)}` : null,
    t.notes ? `notes: ${quoteYaml(t.notes)}` : null,
    t.timezone ? `timezone: "${t.timezone}"` : null,
    t.sessionOverride ? `session_override: ${quoteYaml(t.sessionOverride)}` : null,
    `screenshot: ${quoteYaml(t.screenshot ?? "")}`,
    ...screenshotsLines(t),
    num("rating", t.rating ?? 0),
    `reviewed: ${t.reviewed ? "true" : "false"}`,
    // All three array keys are always emitted, even when empty, so the schema is
    // stable and a reader can tell "absent" from "explicitly empty".
    `tags: ${inlineArray(t.tags)}`,
    `psychology_tags: ${inlineArray(t.psychology_tags)}`,
    `mistake_tags: ${inlineArray(t.mistake_tags)}`,
    // Only written when true: a false/absent flag is the default and stays out
    // of the note, so an untouched trade carries no acknowledgement noise.
    t.psychologyAcknowledged ? `psychology_acknowledged: true` : null,
    t.mistakesAcknowledged ? `mistakes_acknowledged: true` : null,
  ].filter((line): line is string => line !== null);
  if (t.isCopiedTrade) {
    frontmatter.push(
      `is_copied_trade: true`,
      `copied_from_account: ${quoteYaml(t.copiedFromAccount ?? "")}`,
      `copy_base_key: "${t.copyBaseKey ?? ""}"`,
      `copy_base_file: ${quoteYaml(t.copyBaseFile ?? "")}`,
      `copy_multiplier: ${t.copyMultiplier ?? 1}`,
      `copy_symbol_map: "${t.copySymbolMap ?? ""}"`,
      `copy_origin: ${t.copyOrigin ?? "generated"}`,
      `copy_pnl_adjustment: ${t.copyPnlAdjustment ?? 0}`
    );
  } else if (t.copyBaseKey) {
    // A base trade keeps its own stable group key (so legs survive edits/renames).
    frontmatter.push(`copy_base_key: "${t.copyBaseKey}"`);
  }
  const frontmatterText = frontmatter.join("\n");

  const body = `# ${t.symbol} ${t.direction === "long" ? "Long" : "Short"} — ${t.date}

| Account | ${t.account} (${t.accountType}) |
| Direction | ${t.direction} · ${t.quantity} contract(s) |
| Entry | ${fmtPrice(t.entryPrice)} @ ${t.entryTime || "\u2014"} |
| Exit | ${fmtPrice(t.exitPrice)} @ ${t.exitTime || "\u2014"} |
| P&L | $${t.pnl} (${t.pnlPoints} pts) |

## Notes

## Screenshots
`;

  return `---
${frontmatterText}
---

${body}`;
}

/**
 * One naming scheme for every saved trade (manual + import), so files are easy
 * to search and sort:
 *     <date> SYMBOL DIRECTION HHMM      ->  2026-10-09 NQ LONG 0930
 * The date is kept first so the file explorer sorts chronologically; the day is
 * also stored in the frontmatter, so the in-app search finds it either way.
 */
export function tradeFilename(t: Trade, dateFormat?: string): string {
  const sym = (t.symbol || "").replace(/[^A-Za-z0-9]/g, "");
  const dir = (t.direction || "").toUpperCase().replace(/[^A-Z]/g, "");
  const hhmm = /^(\d{2}):(\d{2})/.exec(t.entryTime || "");
  const time = hhmm ? `${hhmm[1]}${hhmm[2]}` : "";
  // The account is deliberately NOT in the name: copy-traded legs would
  // otherwise create duplicate files + duplicate prints.
  return [formatDateFile(t.date, dateFormat), sym, dir, time].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** Identity of a logical trade — used to group copy-traded legs in the search. */
export function tradeKey(t: Trade): string {
  const hhmm = /^(\d{2}:\d{2})/.exec(t.entryTime || "")?.[1] ?? "";
  return [t.date, (t.symbol || "").toUpperCase(), (t.direction || "").toLowerCase(), hhmm, t.entryPrice ?? ""].join("|");
}

export function tradeSignature(t: Trade): string {
  return `${t.date}|${t.symbol}|${t.account}|${t.entryTime}|${t.entryPrice}|${t.exitTime}|${t.exitPrice}|${t.direction}`.toLowerCase();
}

export async function loadExistingSignatures(app: App, folder: string): Promise<Set<string>> {
  const dir = normalizePath(folder);
  const sigs = new Set<string>();
  const files = app.vault.getFiles().filter((f) => f.path.startsWith(dir + "/") && f.extension === "md");
  const contents = await Promise.all(files.map((f) => app.vault.cachedRead(f)));
  for (let i = 0; i < files.length; i++) {
    const p = parseTradeFromMarkdown(contents[i]);
    if (p.date && p.symbol && p.account) {
      sigs.add(
        tradeSignature({
          date: p.date,
          symbol: p.symbol,
          account: p.account,
          entryTime: p.entryTime ?? "",
          entryPrice: p.entryPrice ?? 0,
          exitTime: p.exitTime ?? "",
          exitPrice: p.exitPrice ?? 0,
          direction: p.direction ?? "long",
        } as Trade)
      );
    }
  }
  return sigs;
}

/**
 * Where a trade note lives: `<root>/<YYYY>/<MM>/trades/`, taken from the trade's
 * own date. A year is self-contained — deleting or zipping `2026/` touches
 * nothing else — and the month keeps any one folder a readable size.
 */
export function tradeMonthPath(root: string, date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date || "");
  const now = new Date();
  const year = m ? m[1] : String(now.getFullYear());
  const month = m ? m[2] : String(now.getMonth() + 1).padStart(2, "0");
  return normalizePath(`${root}/${year}/${month}/trades`);
}

/** Create a folder and any missing parents (Obsidian's createFolder needs them). */
async function ensureDir(app: App, dir: string): Promise<void> {
  const parts = normalizePath(dir).split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!app.vault.getAbstractFileByPath(cur)) {
      try {
        await app.vault.createFolder(cur);
      } catch {
        // Raced with another writer — the folder is there either way.
      }
    }
  }
}

export async function saveTrade(app: App, folder: string, t: Trade, dateFormat?: string): Promise<boolean> {
  const dir = tradeMonthPath(folder, t.date);
  await ensureDir(app, dir);
  const base = normalizePath(`${dir}/${tradeFilename(t, dateFormat)}.md`);
  const content = tradeToMarkdown(t);
  if (!app.vault.getAbstractFileByPath(base)) {
    await app.vault.create(base, content);
    return true;
  }
  let n = 2;
  while (app.vault.getAbstractFileByPath(normalizePath(`${dir}/${tradeFilename(t, dateFormat)}_${n}.md`))) {
    n++;
  }
  // Same format as the first file — a collision must not silently switch the
  // date back to the default shape (YYYY-MM-DD) the user did not choose.
  await app.vault.create(normalizePath(`${dir}/${tradeFilename(t, dateFormat)}_${n}.md`), content);
  return true;
}

/**
 * Pull the text of a markdown "## Heading" section from the note body,
 * ignoring the template placeholder lines (which are wrapped in underscores,
 * e.g. "_Why did you take this trade?_").
 */
function bodySection(content: string, heading: string): string {
  const re = new RegExp(`^##\\s*${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|\\s*$)`, "im");
  const m = content.match(re);
  if (!m) return "";
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^_.*_$/.test(l))
    .join(" ")
    .trim();
}

/** Parse an inline YAML array like: ["a", "b"] or [] */
function parseInlineArray(raw: string): string[] {
  const s = (raw ?? "").trim();
  if (!s.startsWith("[") || !s.endsWith("]")) return [];
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((x) => x.trim().replace(/^["']|["']$/g, "").trim())
    .filter((x) => x.length > 0);
}

/**
 * Read the `fills:` block back. Tolerant on purpose: a hand-edited note may have
 * lost a key, so anything without a qty and a price is dropped rather than
 * turned into a NaN that would poison the averages.
 */
function parseFills(fm: string): TradeFill[] {
  const lines = fm.split(/\r?\n/);
  const start = lines.findIndex((l) => /^fills:\s*$/.test(l));
  if (start < 0) return [];
  const out: TradeFill[] = [];
  let cur: Partial<TradeFill> | null = null;
  const assign = (key: string, raw: string): void => {
    const value = raw.replace(/^"|"$/g, "").trim();
    if (!cur) return;
    if (key === "side") cur.side = value === "sell" ? "sell" : "buy";
    else if (key === "time") cur.time = value;
    else if (key === "qty") cur.qty = parseFloat(value);
    else if (key === "price") cur.price = parseFloat(value);
    else if (key === "pnl") cur.pnl = parseFloat(value);
    else if (key === "fees") cur.fees = parseFloat(value);
    else if (key === "order_type") cur.orderType = value;
    else if (key === "fill_id") cur.fillId = value;
  };
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const item = /^\s*-\s+([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (item) {
      if (cur) out.push(cur as TradeFill);
      cur = {};
      assign(item[1], item[2]);
      continue;
    }
    const cont = /^\s+([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (cont && cur) {
      assign(cont[1], cont[2]);
      continue;
    }
    break; // a top-level key, or the closing fence: the block is over
  }
  if (cur) out.push(cur as TradeFill);
  return out.filter((f) => Number.isFinite(f.qty) && f.qty > 0 && Number.isFinite(f.price));
}

/**
 * Read the `screenshots:` block back. Each entry has a `file` (required) and
 * an optional `note`. Tolerant: entries without a file are skipped.
 */
function parseScreenshots(fm: string): PrintEntry[] {
  const lines = fm.split(/\r?\n/);
  const start = lines.findIndex((l) => /^screenshots:\s*$/.test(l));
  if (start < 0) return [];
  const out: PrintEntry[] = [];
  let cur: Partial<PrintEntry> | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    // New list item
    if (/^\s+-\s+/.test(line)) {
      if (cur?.file) out.push(cur as PrintEntry);
      cur = {};
      const kv = /^\s+-\s+(\w+):\s*(.*)$/.exec(line);
      if (kv) {
        const val = kv[2].replace(/^"|"$/g, "").trim();
        if (kv[1] === "file") cur.file = val;
        else if (kv[1] === "note") cur.note = val;
      }
      continue;
    }
    // Continuation of current item (indented key: value)
    const cont = /^\s+(\w+):\s*(.*)$/.exec(line);
    if (cont && cur) {
      const val = cont[2].replace(/^"|"$/g, "").trim();
      if (cont[1] === "file") cur.file = val;
      else if (cont[1] === "note") cur.note = val;
      continue;
    }
    break; // top-level key or closing fence
  }
  if (cur?.file) out.push(cur as PrintEntry);
  return out;
}

export function parseTradeFromMarkdown(content: string): Partial<Trade> {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = m[1];
  const body = content.slice(m[0].length);
  const get = (key: string): string => {
    const re = new RegExp(`^\\s*${key}:\\s*(.*)$`, "m");
    const match = fm.match(re);
    // Written by quoteYaml: undo the escapes in one pass, so a literal
    // backslash stays a backslash and a real newline comes back as a newline.
    return match
      ? match[1]
          .replace(/^"|"$/g, "")
          .replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c))
          .trim()
      : "";
  };
  const has = (key: string): boolean => new RegExp(`^\\s*${key}\\s*:`, "m").test(fm);
  const mistake = get("mistake") || bodySection(body, "Mistakes");
  const legacyTags = parseInlineArray(get("tags"));
  return {
    type: get("type"),
    date: get("date"),
    symbol: get("symbol"),
    account: get("account"),
    accountType: get("account_type") as Trade["accountType"],
    direction: get("direction") as Trade["direction"],
    quantity: parseFloat(get("quantity")),
    entryPrice: parseFloat(get("entry_price")),
    exitPrice: parseFloat(get("exit_price")),
    stopLoss: parseFloat(get("stop_loss")) || 0,
    target: parseFloat(get("target")) || 0,
    pnl: parseFloat(get("pnl")),
    pnlPoints: parseFloat(get("pnl_points")),
    commission: parseFloat(get("commission")) || 0,
    fees: parseFloat(get("fees")) || 0,
    entryTime: get("entry_time"),
    exitTime: get("exit_time"),
    fills: parseFills(fm),
    setup: get("setup") || bodySection(body, "Setup"),
    mistake,
    thesis: get("thesis") || bodySection(body, "Thesis"),
    review: get("review") || bodySection(body, "Review"),
    orderType: normalizeOrderType(get("order_type")),
    fillId: get("fill_id"),
    notes: get("notes"),
    timezone: get("timezone"),
    sessionOverride: get("session_override") || get("sessionOverride") || undefined,
    screenshot: get("screenshot"),
    screenshots: parseScreenshots(fm),
    rating: parseInt(get("rating"), 10) || 0,
    reviewed: get("reviewed") === "true",
    tags: legacyTags,
    // Read with fallbacks, never destructive: an untouched legacy note keeps its
    // old `tags`/`mistake` meaning until the review UI writes the new keys.
    psychology_tags: has("psychology_tags") ? parseInlineArray(get("psychology_tags")) : legacyTags,
    mistake_tags: has("mistake_tags") ? parseInlineArray(get("mistake_tags")) : mistake.trim() ? [mistake.trim()] : [],
    psychologyAcknowledged: get("psychology_acknowledged") === "true",
    mistakesAcknowledged: get("mistakes_acknowledged") === "true",
    isCopiedTrade: get("is_copied_trade") === "true" || get("isCopiedTrade") === "true",
    copiedFromAccount: get("copied_from_account") || get("copiedFromAccount"),
    copyBaseKey: get("copy_base_key") || get("copyBaseKey"),
    copyBaseFile: get("copy_base_file") || get("copyBaseFile"),
    copyMultiplier: parseFloat(get("copy_multiplier")) || undefined,
    copySymbolMap: get("copy_symbol_map") || get("copySymbolMap"),
    copyOrigin: (get("copy_origin") || get("copyOrigin") || "") as Trade["copyOrigin"],
    copyPnlAdjustment: parseFloat(get("copy_pnl_adjustment")) || 0,
  };
}

/**
 * One value, one physical line.
 *
 * The frontmatter is read line by line, so a note that holds real newlines
 * cannot be written as-is: its second line would be read as a key of its own.
 * Newlines travel as the two characters \n, quotes and backslashes are
 * escaped, and `get` turns them back when the file is read again.
 */
const quoteYaml = (value: string): string =>
  `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;

export async function updateTradeFields(app: App, file: TFile, fields: Record<string, string | number | boolean>): Promise<void> {
  await app.vault.process(file, (content) => {
    let out = content;
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      // Booleans and numbers stay bare (clean YAML); everything else is quoted.
      const raw =
        typeof value === "number"
          ? String(value)
          : typeof value === "boolean"
          ? value
            ? "true"
            : "false"
          : quoteYaml(String(value));
      const re = new RegExp(`^(\\s*${key}:\\s*).*$`, "m");
      if (re.test(out)) {
        out = out.replace(re, `$1${raw}`);
      } else {
        const fm = out.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fm) {
          out = out.replace(fm[0], fm[0].replace(/\n---\s*$/, `\n${key}: ${raw}\n---`));
        }
      }
    }
    return out;
  });
}

/**
 * Rewrite `string[]` frontmatter fields as inline YAML arrays.
 * `updateTradeFields` quotes every string, which would turn a list into one tag
 * named "[a, b]" — this keeps the YAML shape the parser expects.
 */
export async function updateTradeArrayFields(app: App, file: TFile, fields: Record<string, string[]>): Promise<void> {
  const entries = Object.entries(fields).map(([key, values]) => [key, inlineArray(values)] as const);
  await app.vault.process(file, (content) => {
    let out = content;
    for (const [key, raw] of entries) {
      const re = new RegExp(`^(\\s*${key}:\\s*).*$`, "m");
      if (re.test(out)) {
        out = out.replace(re, `$1${raw}`);
      } else {
        const fm = out.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fm) out = out.replace(fm[0], fm[0].replace(/\n---\s*$/, `\n${key}: ${raw}\n---`));
      }
    }
    return out;
  });
}

/**
 * Replace the whole `screenshots:` block with a fresh one. Needed because
 * `updateTradeFields` matches the bare `screenshots:` line and would overwrite
 * the block list with a single quoted scalar, losing every print on reload.
 * Also keeps legacy `screenshot` in sync with the first entry.
 */
export async function updateTradeScreenshots(app: App, file: TFile, shots: PrintEntry[]): Promise<void> {
  const block = screenshotsLines({ screenshots: shots } as Trade);
  const first = shots.length ? shots[0].file : "";
  await app.vault.process(file, (content) => {
    const lines = content.split(/\r?\n/);
    const start = lines.findIndex((l) => /^screenshots:\s*/.test(l));
    if (start >= 0) {
      // Drop the old block (its list items and their indented continuations).
      let end = start + 1;
      while (end < lines.length && (/^\s+-\s+/.test(lines[end]) || /^\s+\w+:/.test(lines[end]))) end++;
      lines.splice(start, end - start, ...block);
    } else if (block.length) {
      const fmEnd = lines.indexOf("---", 1);
      if (fmEnd < 0) return content;
      lines.splice(fmEnd, 0, ...block);
    }
    return lines.join("\n").replace(/^(screenshot:\s*).*$/m, `$1${quoteYaml(first)}`);
  });
}

/**
 * The one place `mistake_tags` is written. Storage is the single source of
 * truth for the legacy dual-write: `mistake_tags: [...]` plus the first tag
 * mirrored into the old `mistake` scalar, so dashboards/metrics keep working.
 */
export async function setTradeMistakeTags(app: App, file: TFile, tags: string[]): Promise<void> {
  await updateTradeArrayFields(app, file, { mistake_tags: tags });
  await updateTradeFields(app, file, { mistake: tags[0] ?? "" });
}

export async function deleteTradeFile(app: App, fileId: string): Promise<boolean> {  const file = app.vault.getAbstractFileByPath(fileId);
  if (file instanceof TFile) {
    await app.vault.trash(file, true);
    return true;
  }
  return false;
}

/** Rewrite the `account` field of a trade note (used when renaming an account). */
export async function setTradeAccount(app: App, path: string, newName: string): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await updateTradeFields(app, file, { account: newName });
  return true;
}

/** Update arbitrary frontmatter fields of a trade note. */
export async function setTradeFields(app: App, path: string, fields: Record<string, string | number | boolean>): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await updateTradeFields(app, file, fields);
  return true;
}

// Test hook (see lib/fills.ts): lets the harness prove the note round-trip.
if (typeof window !== "undefined") {
  (window as any).__tjStorage = {
    tradeToMarkdown,
    parseTradeFromMarkdown,
    inlineArray,
    updateTradeScreenshots,
    updateTradeArrayFields,
  };
}
