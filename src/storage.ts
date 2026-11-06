import { App, TFile, normalizePath } from "obsidian";
import { PrintEntry, RecordedOrderFact, Trade, TradeFill } from "./types";
import { formatDateFile } from "./lib/dates";
import { normalizeOrderType } from "./lib/tradeTable";
import { fmtPrice } from "./tz";
import { parsePlannedNumber, type PlannedNumberField } from "./lib/review";
import { buildManualExitFills, type ManualExitFillInput } from "./lib/manualTradeFills";
import { pinManualInstants } from "./lib/instant";
import { strategiesOf } from "./lib/strategySelection";

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
    if (f.instant) out.push(`    instant: "${f.instant}"`);
    out.push(`    qty: ${f.qty}`);
    out.push(`    price: ${f.price}`);
    if (Number.isFinite(f.pnl)) out.push(`    pnl: ${f.pnl}`);
    if (Number.isFinite(f.fees)) out.push(`    fees: ${f.fees}`);
    if (f.orderType) out.push(`    order_type: ${quoteYaml(f.orderType)}`);
    if (f.exitType && f.exitTypeSource) {
      out.push(`    exit_type: "${f.exitType}"`);
      out.push(`    exit_type_source: "${f.exitTypeSource}"`);
    }
    if (f.fillId) out.push(`    fill_id: "${f.fillId.replace(/"/g, '\\"')}"`);
  }
  return out;
}

function validScreenshotEntries(shots: PrintEntry[] | null | undefined): PrintEntry[] {
  return (shots ?? []).filter((shot): shot is PrintEntry =>
    !!shot && typeof shot.file === "string" && shot.file.trim().length > 0);
}

function screenshotsLines(t: Trade): string[] {
  const shots = validScreenshotEntries(t.screenshots);
  if (!shots.length) return [];
  const out = ["screenshots:"];
  for (const shot of shots) {
    out.push(`  - file: ${quoteYaml(shot.file)}`);
    if (shot.note) out.push(`    note: ${quoteYaml(shot.note)}`);
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

/** A `number[]` as a YAML inline array, and the reader that pairs with it. The
 *  stop levels are prices: written as a list so a moved stop reads as a
 *  trajectory, not a single level pretending to be the whole story. */
function numberArray(values?: number[]): string {
  return `[${(values ?? []).join(", ")}]`;
}

function parseNumberArray(raw: string): number[] {
  const s = (raw ?? "").trim();
  if (!s.startsWith("[") || !s.endsWith("]")) return [];
  return s
    .slice(1, -1)
    .split(",")
    .map((x) => parseFloat(x.trim()))
    .filter((x) => Number.isFinite(x));
}

function parseRecordedOrderFacts(raw: string): RecordedOrderFact[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const sources = new Set<RecordedOrderFact["source"]>(["orders", "fills", "tradesea", "unknown"]);
  return parsed.flatMap((item): RecordedOrderFact[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.recordedAt !== "string" || !Number.isFinite(Date.parse(value.recordedAt))) return [];
    const source = sources.has(value.source as RecordedOrderFact["source"])
      ? value.source as RecordedOrderFact["source"]
      : "unknown";
    return [{
      source,
      recordedAt: value.recordedAt,
      ...(value.side === "buy" || value.side === "sell" ? { side: value.side } : {}),
      ...(typeof value.status === "string" && value.status ? { status: value.status } : {}),
      ...(typeof value.orderId === "string" && value.orderId ? { orderId: value.orderId } : {}),
      ...(typeof value.orderType === "string" && value.orderType ? { orderType: value.orderType } : {}),
      ...(typeof value.quantity === "number" && Number.isFinite(value.quantity) && value.quantity > 0 ? { quantity: value.quantity } : {}),
      ...(typeof value.stopPrice === "number" && Number.isFinite(value.stopPrice) ? { stopPrice: value.stopPrice } : {}),
      ...(typeof value.limitPrice === "number" && Number.isFinite(value.limitPrice) ? { limitPrice: value.limitPrice } : {}),
    }];
  });
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
    // The stop's provenance and every level the broker's export holds for it,
    // so a moved stop still reads as a moved stop after a reload.
    t.stopSource ? `stop_source: "${t.stopSource}"` : null,
    t.stopLevels?.length ? `stop_levels: ${numberArray(t.stopLevels)}` : null,
    t.recordedOrderFacts?.length ? `recorded_order_facts: ${quoteYaml(JSON.stringify(t.recordedOrderFacts))}` : null,
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
    t.setups ? `setups: ${inlineArray(t.setups)}` : null,
    t.market_context_timing ? `market_context_timing: ${inlineArray(t.market_context_timing)}` : null,
    t.market_context_effect ? `market_context_effect: ${inlineArray(t.market_context_effect)}` : null,
    t.market_context_ref ? `market_context_ref: ${quoteYaml(t.market_context_ref)}` : null,
    `mistake: ${quoteYaml(t.mistake ?? "")}`,
    `thesis: ${quoteYaml(t.thesis ?? "")}`,
    `review: ${quoteYaml(t.review ?? "")}`,
    t.orderType ? `order_type: ${quoteYaml(t.orderType)}` : null,
    t.fillId ? `fill_id: ${quoteYaml(t.fillId)}` : null,
    // The import's stable identity, written only when it exists. A note that
    // predates the key keeps its absence; the importer recomputes it then.
    t.importKey ? `import_key: ${quoteYaml(t.importKey)}` : null,
    t.notes ? `notes: ${quoteYaml(t.notes)}` : null,
    t.review_plan ? `review_plan: ${quoteYaml(t.review_plan)}` : null,
    num("review_planned_entry", t.review_planned_entry),
    num("review_planned_stop", t.review_planned_stop),
    num("review_planned_target", t.review_planned_target),
    num("review_planned_quantity", t.review_planned_quantity),
    t.review_plan_timing ? `review_plan_timing: "${t.review_plan_timing}"` : null,
    t.review_plan_provenance ? `review_plan_provenance: "${t.review_plan_provenance}"` : null,
    t.review_plan_adherence ? `review_plan_adherence: "${t.review_plan_adherence}"` : null,
    t.review_what_happened ? `review_what_happened: ${quoteYaml(t.review_what_happened)}` : null,
    t.review_repeat_change ? `review_repeat_change: ${quoteYaml(t.review_repeat_change)}` : null,
    t.review_post_exit_observation ? `review_post_exit_observation: ${quoteYaml(t.review_post_exit_observation)}` : null,
    num("review_post_exit_points", t.review_post_exit_points),
    t.review_post_exit_source ? `review_post_exit_source: "${t.review_post_exit_source}"` : null,
    t.exit_reason ? `exit_reason: "${t.exit_reason}"` : null,
    t.timezone ? `timezone: "${t.timezone}"` : null,
    // Canonical instants + their provenance. Written only when they exist: a
    // note that predates the contract keeps its honest absence instead of a
    // fabricated UTC (see `lib/instant.ts`).
    t.entryInstant ? `entry_instant: "${t.entryInstant}"` : null,
    t.exitInstant ? `exit_instant: "${t.exitInstant}"` : null,
    t.sourceZone ? `source_zone: "${t.sourceZone}"` : null,
    t.instantSource ? `instant_source: "${t.instantSource}"` : null,
    t.sessionOverride ? `session_override: ${quoteYaml(t.sessionOverride)}` : null,
    `screenshot: ${quoteYaml(t.screenshot ?? "")}`,
    ...screenshotsLines(t),
    num("rating", t.rating ?? 0),
    // Only the trader's own word is written. "Absent" means "let the checklist
    // decide", which is a real third state: writing `false` for an unset flag
    // turned every fully written-up trade into a permanent "Needs review".
    typeof t.reviewed === "boolean" ? `reviewed: ${t.reviewed ? "true" : "false"}` : null,
    typeof t.review_context_unavailable === "boolean" ? `review_context_unavailable: ${t.review_context_unavailable ? "true" : "false"}` : null,
    t.review_evidence_source ? `review_evidence_source: "${t.review_evidence_source}"` : null,
    t.origin ? `origin: "${t.origin}"` : null,
    // Explicit provenance, written only when known. A note that predates the
    // key keeps its absence; nothing is guessed on the way out.
    t.dataSource ? `data_source: "${t.dataSource}"` : null,
    // All three array keys are always emitted, even when empty, so the schema is
    // stable and a reader can tell "absent" from "explicitly empty".
    `tags: ${inlineArray(t.tags)}`,
    `psychology_tags: ${inlineArray(t.psychology_tags)}`,
    `mistake_tags: ${inlineArray(t.mistake_tags)}`,
    // Preserve explicit false separately from absence for generated-copy merges.
    typeof t.psychologyAcknowledged === "boolean" ? `psychology_acknowledged: ${t.psychologyAcknowledged ? "true" : "false"}` : null,
    typeof t.mistakesAcknowledged === "boolean" ? `mistakes_acknowledged: ${t.mistakesAcknowledged ? "true" : "false"}` : null,
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
      `copy_pnl_adjustment: ${t.copyPnlAdjustment ?? 0}`,
      // Supersession is written only when it happened; a live leg keeps no key.
      ...(t.supersededBy ? [`superseded_by: ${quoteYaml(t.supersededBy)}`] : []),
      ...(t.supersededAt ? [`superseded_at: "${t.supersededAt}"`] : [])
    );
  } else if (t.copyBaseKey) {
    // A base trade keeps its own stable group key (so legs survive edits/renames).
    frontmatter.push(`copy_base_key: "${t.copyBaseKey}"`);
  }
  const frontmatterText = frontmatter.join("\n");

  const pointsText = Number.isFinite(t.pnlPoints) ? `${t.pnlPoints} realized pts/contract` : "—";
  const pnlText = Number.isFinite(t.pnl) ? `$${t.pnl}` : "—";
  const body = `# ${t.symbol} ${t.direction === "long" ? "Long" : "Short"} — ${t.date}

| Account | ${t.account} (${t.accountType}) |
| Direction | ${t.direction} · ${t.quantity} contract(s) |
| Entry | ${t.entryPrice === 0 ? "0" : fmtPrice(t.entryPrice)} @ ${t.entryTime || "\u2014"} |
| Exit | ${t.exitPrice === 0 ? "0" : fmtPrice(t.exitPrice)} @ ${t.exitTime || "\u2014"} |
| P&L | ${pnlText} (${pointsText}) |

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
    else if (key === "instant") cur.instant = value;
    else if (key === "qty") cur.qty = parseFloat(value);
    else if (key === "price") cur.price = parseFloat(value);
    else if (key === "pnl") cur.pnl = parseFloat(value);
    else if (key === "fees") cur.fees = parseFloat(value);
    else if (key === "order_type") cur.orderType = decodeScreenshotScalar(raw);
    else if (key === "exit_type" && (value === "tp" || value === "sl" || value === "be")) cur.exitType = value;
    else if (key === "exit_type_source" && (value === "manual" || value === "broker")) cur.exitTypeSource = value;
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
/** Decode the quoted form emitted by quoteYaml; tolerate older plain/quoted values. */
function decodeScreenshotScalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(value);
      if (typeof decoded === "string") return decoded;
    } catch {
      // Older notes may contain literal, non-JSON backslashes inside quotes.
    }
    return value.slice(1, -1).replace(/\\(\\|"|n)/g, (_match: string, escaped: string) => escaped === "n" ? "\n" : escaped);
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

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
        const val = decodeScreenshotScalar(kv[2]);
        if (kv[1] === "file") cur.file = val;
        else if (kv[1] === "note") cur.note = val;
      }
      continue;
    }
    // Continuation of current item (indented key: value)
    const cont = /^\s+(\w+):\s*(.*)$/.exec(line);
    if (cont && cur) {
      const val = decodeScreenshotScalar(cont[2]);
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
    const re = new RegExp(`^${key}:[ \\t]*(.*)$`, "m");
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
  const has = (key: string): boolean => new RegExp(`^${key}[ \\t]*:`, "m").test(fm);
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
    stopSource: (get("stop_source") as Trade["stopSource"]) || undefined,
    stopLevels: has("stop_levels") ? parseNumberArray(get("stop_levels")) : undefined,
    recordedOrderFacts: has("recorded_order_facts") ? parseRecordedOrderFacts(get("recorded_order_facts")) : undefined,
    pnl: parseFloat(get("pnl")),
    pnlPoints: parseFloat(get("pnl_points")),
    commission: parseFloat(get("commission")) || 0,
    fees: parseFloat(get("fees")) || 0,
    // Missing legacy fields are not evidence of a confirmed zero charge. This
    // presence metadata is runtime-only; the original fields remain untouched.
    costCoverage: {
      commission: has("commission") && Number.isFinite(parseFloat(get("commission"))),
      fees: has("fees") && Number.isFinite(parseFloat(get("fees"))),
    },
    entryTime: get("entry_time"),
    exitTime: get("exit_time"),
    fills: parseFills(fm),
    setup: has("setup") ? get("setup") : bodySection(body, "Setup"),
    setups: has("setups") ? parseInlineArray(get("setups")) : (get("setup") ? [get("setup")] : []),
    market_context_timing: has("market_context_timing") ? parseInlineArray(get("market_context_timing")) : [],
    market_context_effect: has("market_context_effect") ? parseInlineArray(get("market_context_effect")) : [],
    market_context_ref: get("market_context_ref") || undefined,
    mistake,
    thesis: get("thesis") || bodySection(body, "Thesis"),
    review: get("review") || bodySection(body, "Review"),
    orderType: normalizeOrderType(get("order_type")),
    fillId: get("fill_id"),
    importKey: get("import_key") || undefined,
    notes: get("notes"),
    review_plan: get("review_plan") || undefined,
    review_planned_entry: parsePlannedNumber(get("review_planned_entry"), "review_planned_entry"),
    review_planned_stop: parsePlannedNumber(get("review_planned_stop"), "review_planned_stop"),
    review_planned_target: parsePlannedNumber(get("review_planned_target"), "review_planned_target"),
    review_planned_quantity: parsePlannedNumber(get("review_planned_quantity"), "review_planned_quantity"),
    review_plan_timing: (["unknown", "before-entry", "during-trade", "after-exit"] as const).includes(get("review_plan_timing") as "unknown" | "before-entry" | "during-trade" | "after-exit")
      ? get("review_plan_timing") as Trade["review_plan_timing"]
      : undefined,
    review_plan_provenance: (get("review_plan_provenance") || undefined) as Trade["review_plan_provenance"],
    review_plan_adherence: (get("review_plan_adherence") || undefined) as Trade["review_plan_adherence"],
    review_what_happened: get("review_what_happened") || undefined,
    review_repeat_change: get("review_repeat_change") || undefined,
    review_post_exit_observation: get("review_post_exit_observation") || undefined,
    review_post_exit_points: Number.isFinite(parseFloat(get("review_post_exit_points"))) ? parseFloat(get("review_post_exit_points")) : undefined,
    review_post_exit_source: (get("review_post_exit_source") || undefined) as Trade["review_post_exit_source"],
    exit_reason: (get("exit_reason") || undefined) as Trade["exit_reason"],
    timezone: get("timezone"),
    entryInstant: get("entry_instant") || undefined,
    exitInstant: get("exit_instant") || undefined,
    sourceZone: get("source_zone") || undefined,
    instantSource: (get("instant_source") || undefined) as Trade["instantSource"],
    sessionOverride: get("session_override") || get("sessionOverride") || undefined,
    screenshot: decodeScreenshotScalar(fm.match(/^screenshot:[ \t]*(.*)$/m)?.[1] ?? ""),
    screenshots: parseScreenshots(fm),
    rating: Number(get("rating") || 0),
    // `accepted` was a short-lived second flag; a note that carries it means the
    // same thing as reviewed, so it is folded in on read and never written again.
    // Three states, kept distinct on purpose: true (the trader's word closes
    // it), false (the trader's word holds it open), absent (the checklist
    // decides). Folding absent into false was what pinned finished trades in
    // the review queue.
    reviewed: has("reviewed")
      ? get("reviewed") === "true"
      : has("accepted") ? get("accepted") === "true" : undefined,
    review_context_unavailable: has("review_context_unavailable")
      ? get("review_context_unavailable") === "true"
      : undefined,
    review_evidence_source: get("review_evidence_source") === "human" ? "human" : undefined,
    origin: (get("origin") as Trade["origin"]) || undefined,
    dataSource: (get("data_source") || get("dataSource") || undefined) as Trade["dataSource"],
    tags: legacyTags,
    // Read with fallbacks, never destructive: an untouched legacy note keeps its
    // old `tags`/`mistake` meaning until the review UI writes the new keys.
    psychology_tags: has("psychology_tags") ? parseInlineArray(get("psychology_tags")) : legacyTags,
    mistake_tags: has("mistake_tags") ? parseInlineArray(get("mistake_tags")) : mistake.trim() ? [mistake.trim()] : [],
    psychologyAcknowledged: has("psychology_acknowledged") ? get("psychology_acknowledged") === "true" : undefined,
    mistakesAcknowledged: has("mistakes_acknowledged") ? get("mistakes_acknowledged") === "true" : undefined,
    isCopiedTrade: get("is_copied_trade") === "true" || get("isCopiedTrade") === "true",
    copiedFromAccount: get("copied_from_account") || get("copiedFromAccount"),
    copyBaseKey: get("copy_base_key") || get("copyBaseKey"),
    copyBaseFile: get("copy_base_file") || get("copyBaseFile"),
    copyMultiplier: parseFloat(get("copy_multiplier")) || undefined,
    copySymbolMap: get("copy_symbol_map") || get("copySymbolMap"),
    copyOrigin: (get("copy_origin") || get("copyOrigin") || "") as Trade["copyOrigin"],
    copyPnlAdjustment: parseFloat(get("copy_pnl_adjustment")) || 0,
    supersededBy: get("superseded_by") || get("supersededBy") || undefined,
    supersededAt: get("superseded_at") || get("supersededAt") || undefined,
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

/** Correct manual actuals atomically; never rewrite broker facts or unrelated note content. */
export async function updateManualTradeExecutions(
  app: App, file: TFile, expected: Trade,
  entry: { quantity: number; entryPrice: number; entryTime: string },
  exits: ManualExitFillInput[],
): Promise<Trade> {
  let saved: Trade | undefined;
  const executionIdentity = (t: Partial<Trade>) => JSON.stringify([
    (t.fills ?? []).map((f) => [f.side, f.time, f.qty, f.price, f.instant, f.pnl, f.fees, f.orderType, f.fillId, f.exitType, f.exitTypeSource]), t.quantity, t.entryPrice, t.exitPrice, t.entryTime, t.exitTime,
    t.entryInstant, t.exitInstant, t.direction, t.symbol, t.date, t.origin, t.dataSource,
  ]);
  if (expected.origin !== "manual" || expected.isCopiedTrade) throw new Error("Only original manual executions can be corrected here.");
  await app.vault.process(file, (content) => {
    const latest = parseTradeFromMarkdown(content) as Trade;
    if (latest.origin !== "manual" || latest.isCopiedTrade) throw new Error("Only original manual executions can be corrected here.");
    if (executionIdentity(latest) !== executionIdentity(expected)) throw new Error("Executions changed. Reopen the trade before correcting it.");
    const candidate: Trade = { ...latest, ...entry };
    const zone = latest.timezone || latest.sourceZone || "";
    const pinned = exits.map((exit) => {
      const pin = pinManualInstants(latest.date, entry.entryTime, exit.time, zone);
      if (pin.status !== "ok" && pin.status !== "no-zone") throw new Error("The execution time is invalid or ambiguous in the recorded time zone.");
      if (pin.status === "ok") candidate.entryInstant = pin.entryInstant;
      else delete candidate.entryInstant;
      return { ...exit, instant: pin.status === "ok" ? pin.exitInstant : undefined };
    });
    const result = buildManualExitFills(candidate, pinned, true);
    if (!result.ok) throw new Error(result.error);
    const updated = result.trade;
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!match) throw new Error("Trade frontmatter is missing.");
    const fields = ["quantity", "entry_price", "exit_price", "entry_time", "exit_time", "entry_instant", "exit_instant", "pnl", "pnl_points"];
    const old = match[1].split(/\r?\n/);
    const kept: string[] = [];
    for (let i = 0; i < old.length; i++) {
      if (/^fills:\s*/.test(old[i])) {
        while (i + 1 < old.length && (/^\s+/.test(old[i + 1]) || !old[i + 1].trim())) i++;
      } else if (!fields.some((key) => old[i].startsWith(key + ":"))) kept.push(old[i]);
    }
    const number = (key: string, value: number) => Number.isFinite(value) ? `${key}: ${value}` : null;
    const fresh = [number("quantity", updated.quantity), number("entry_price", updated.entryPrice), number("exit_price", updated.exitPrice),
      `entry_time: ${updated.entryTime}`, `exit_time: ${updated.exitTime}`,
      updated.entryInstant ? `entry_instant: ${quoteYaml(updated.entryInstant)}` : null,
      updated.exitInstant ? `exit_instant: ${quoteYaml(updated.exitInstant)}` : null,
      number("pnl", updated.pnl), number("pnl_points", updated.pnlPoints), ...fillLines(updated)].filter((x): x is string => x !== null);
    const eol = content.startsWith("---\r\n") ? "\r\n" : "\n";
    const replacement = "---" + eol + [...kept, ...fresh].join(eol) + eol + "---";
    const next = replacement + content.slice(match[0].length);
    saved = { ...(parseTradeFromMarkdown(next) as Trade), id: expected.id };
    return next;
  });
  if (!saved) throw new Error("Execution correction was not saved.");
  return saved;
}

function writeTradeFields(content: string, fields: Record<string, string | number | boolean>): string {
  let out = content;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const plannedFields: PlannedNumberField[] = ["review_planned_entry", "review_planned_stop", "review_planned_target", "review_planned_quantity"];
    if (plannedFields.includes(key as PlannedNumberField)) {
      const parsed = parsePlannedNumber(value, key as PlannedNumberField);
      if (parsed === undefined) continue;
    }
    // Booleans and numbers stay bare (clean YAML); everything else is quoted.
    const raw =
      typeof value === "number"
        ? String(value)
        : typeof value === "boolean"
        ? value
          ? "true"
          : "false"
        : quoteYaml(String(value));
    const re = new RegExp(`^(${key}:[ \\t]*).*$`, "m");
    if (re.test(out)) {
      out = out.replace(re, (_line, prefix: string) => prefix + raw);
    } else {
      const fm = out.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (fm) {
        out = out.replace(fm[0], () => fm[0].replace(/\n---\s*$/, () => `\n${key}: ${raw}\n---`));
      }
    }
  }
  return out;
}

export async function updateTradeFields(app: App, file: TFile, fields: Record<string, string | number | boolean>): Promise<void> {
  await app.vault.process(file, (content) => writeTradeFields(content, fields));
}

function writeStrategyAssignments(content: string, selected: string, assignments: string[]): string {
  const out = writeTradeFields(content, { setup: selected });
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(out);
  if (!match) throw new Error("Trade frontmatter is missing.");
  const lines = match[1].split(/\r?\n/);
  const raw = `setups: ${inlineArray(assignments)}`;
  const index = lines.findIndex((line) => /^setups:/.test(line));
  if (index >= 0) lines[index] = raw; else lines.push(raw);
  const eol = out.startsWith("---\r\n") ? "\r\n" : "\n";
  return "---" + eol + lines.join(eol) + eol + "---" + out.slice(match[0].length);
}

/** Only an explicit trade selection may resolve old multiple assignments. */
export async function setTradeStrategy(app: App, file: TFile, choice: string): Promise<void> {
  const selected = choice.trim();
  await app.vault.process(file, (content) => writeStrategyAssignments(content, selected, selected ? [selected] : []));
}

/** Library rename replaces matching names while retaining unrelated historical choices. */
export async function renameTradeStrategy(app: App, file: TFile, from: string, to: string): Promise<boolean> {
  let changed = false;
  const oldName = from.trim().toLowerCase();
  const newName = to.trim();
  if (!oldName || !newName) return false;
  await app.vault.process(file, (content) => {
    const latest = parseTradeFromMarkdown(content) as Trade;
    const names = strategiesOf(latest);
    if (!names.some((name) => name.toLowerCase() === oldName)) return content;
    const selected = latest.setup?.trim().toLowerCase() === oldName ? newName : latest.setup ?? "";
    const renamed = strategiesOf({ setup: selected, setups: names.map((name) => name.toLowerCase() === oldName ? newName : name) });
    changed = true;
    return writeStrategyAssignments(content, selected, renamed);
  });
  return changed;
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
      const re = new RegExp(`^(${key}:[ \\t]*).*$`, "m");
      if (re.test(out)) {
        out = out.replace(re, (_line, prefix: string) => prefix + raw);
      } else {
        const fm = out.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fm) out = out.replace(fm[0], () => fm[0].replace(/\n---\s*$/, () => `\n${key}: ${raw}\n---`));
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
function writeScreenshotFrontmatter(content: string, validShots: PrintEntry[], filePath: string): string {
  const block = screenshotsLines({ screenshots: validShots } as Trade);
  const first = validShots[0]?.file;
  const opener = /^---\r?\n/.exec(content);
  if (!opener) throw new Error(`Cannot update screenshots without valid frontmatter: ${filePath}`);
  const closingPattern = /^---[ \t]*(?:\r?\n|$)/gm;
  closingPattern.lastIndex = opener[0].length;
  const closing = closingPattern.exec(content);
  if (!closing) throw new Error(`Cannot update screenshots without valid frontmatter: ${filePath}`);
  const eol = opener[0].endsWith("\r\n") ? "\r\n" : "\n";
  const rawFrontmatter = content.slice(opener[0].length, closing.index);
  const lines = rawFrontmatter ? rawFrontmatter.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  const start = lines.findIndex((line) => /^screenshots:\s*/.test(line));
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && (/^\s+-\s+/.test(lines[end]) || /^\s+\w+:/.test(lines[end]))) end++;
    lines.splice(start, end - start, ...block);
  } else if (block.length) {
    lines.push(...block);
  }
  const scalarIndex = lines.findIndex((line) => /^screenshot:\s*/.test(line));
  if (first !== undefined) {
    const scalar = `screenshot: ${quoteYaml(first)}`;
    if (scalarIndex >= 0) lines[scalarIndex] = scalar;
    else lines.push(scalar);
  } else if (scalarIndex >= 0) {
    lines.splice(scalarIndex, 1);
  }
  return opener[0] + lines.join(eol) + (lines.length ? eol : "") + content.slice(closing.index);
}

export async function updateTradeScreenshots(app: App, file: TFile, shots: PrintEntry[]): Promise<void> {
  const validShots = validScreenshotEntries(shots);
  await app.vault.process(file, (content) => writeScreenshotFrontmatter(content, validShots, file.path));
}

/** Append screenshot references idempotently using the trade note's latest content. */
export async function appendTradeScreenshots(
  app: App,
  file: TFile,
  shots: PrintEntry[],
): Promise<{ screenshots: PrintEntry[]; appended: number }> {
  const additions = validScreenshotEntries(shots);
  let saved: PrintEntry[] = [];
  let appended = 0;
  await app.vault.process(file, (content) => {
    const parsed = parseTradeFromMarkdown(content);
    const existing = validScreenshotEntries(parsed.screenshots);
    if (!existing.length) {
      const legacy = String(parsed.screenshot ?? "").trim();
      if (legacy && legacy.toLowerCase() !== "added") {
        for (const path of legacy.split(/[,;\r\n]+/).map((part) => part.trim()).filter(Boolean)) {
          existing.push({ file: path });
        }
      }
    }
    saved = [...existing];
    appended = 0;
    const seen = new Set(saved.map((entry) => entry.file));
    for (const entry of additions) {
      if (seen.has(entry.file)) continue;
      saved.push(entry);
      seen.add(entry.file);
      appended++;
    }
    return writeScreenshotFrontmatter(content, saved, file.path);
  });
  return { screenshots: saved, appended };
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
    await app.fileManager.trashFile(file);
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
  (window as unknown as { __tjStorage: { tradeToMarkdown: typeof tradeToMarkdown; parseTradeFromMarkdown: typeof parseTradeFromMarkdown; inlineArray: typeof inlineArray; updateTradeScreenshots: typeof updateTradeScreenshots; updateTradeArrayFields: typeof updateTradeArrayFields } }).__tjStorage = {
    tradeToMarkdown,
    parseTradeFromMarkdown,
    inlineArray,
    updateTradeScreenshots,
    updateTradeArrayFields,
  };
}
