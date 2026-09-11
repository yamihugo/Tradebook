import { App, TFile, normalizePath } from "obsidian";
import { Trade } from "./types";

export function tradeToMarkdown(t: Trade): string {
  const frontmatter = [
    `date: ${t.date}`,
    `symbol: ${t.symbol}`,
    `account: "${t.account.replace(/"/g, '\\"')}"`,
    `account_type: ${t.accountType}`,
    `direction: ${t.direction}`,
    `quantity: ${t.quantity}`,
    `entry_price: ${t.entryPrice}`,
    `exit_price: ${t.exitPrice}`,
    `pnl: ${t.pnl}`,
    `pnl_points: ${t.pnlPoints}`,
    `entry_time: ${t.entryTime}`,
    `exit_time: ${t.exitTime}`,
    `setup: "${t.setup ?? ""}"`,
    `mistake: "${t.mistake ?? ""}"`,
    `review: "${t.review ?? ""}"`,
    `screenshot: "${t.screenshot ?? ""}"`,
    "tags: []",
  ].join("\n");

  const body = `# ${t.symbol} ${t.direction === "long" ? "Long" : "Short"} — ${t.date}

| Account | ${t.account} (${t.accountType}) |
| Direction | ${t.direction} · ${t.quantity} contract(s) |
| Entry | ${t.entryPrice} @ ${t.entryTime} |
| Exit | ${t.exitPrice} @ ${t.exitTime} |
| P&L | $${t.pnl} (${t.pnlPoints} pts) |

## Notes

## Screenshots
`;

  return `---
${frontmatter}
---

${body}`;
}

export function tradeFilename(t: Trade): string {
  const sym = t.symbol.replace(/[^A-Za-z0-9]/g, "");
  const acct = t.account.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${t.date} ${sym} ${acct}`.trim();
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

export async function saveTrade(app: App, folder: string, t: Trade): Promise<boolean> {
  const dir = normalizePath(folder);
  const base = normalizePath(`${dir}/${tradeFilename(t)}.md`);
  const content = tradeToMarkdown(t);
  if (!app.vault.getAbstractFileByPath(base)) {
    await app.vault.create(base, content);
    return true;
  }
  let n = 2;
  while (app.vault.getAbstractFileByPath(normalizePath(`${dir}/${tradeFilename(t)}_${n}.md`))) {
    n++;
  }
  await app.vault.create(normalizePath(`${dir}/${tradeFilename(t)}_${n}.md`), content);
  return true;
}

export function parseTradeFromMarkdown(content: string): Partial<Trade> {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = m[1];
  const get = (key: string): string => {
    const re = new RegExp(`^\\s*${key}:\\s*(.*)$`, "m");
    const match = fm.match(re);
    return match ? match[1].replace(/^"|"$/g, "").replace(/\\"/g, '"').trim() : "";
  };
  return {
    date: get("date"),
    symbol: get("symbol"),
    account: get("account"),
    accountType: get("account_type") as Trade["accountType"],
    direction: get("direction") as Trade["direction"],
    quantity: parseFloat(get("quantity")),
    entryPrice: parseFloat(get("entry_price")),
    exitPrice: parseFloat(get("exit_price")),
    pnl: parseFloat(get("pnl")),
    pnlPoints: parseFloat(get("pnl_points")),
    entryTime: get("entry_time"),
    exitTime: get("exit_time"),
    setup: get("setup"),
    mistake: get("mistake"),
    review: get("review"),
    screenshot: get("screenshot"),
  };
}

export async function updateTradeFields(app: App, file: TFile, fields: Record<string, string>): Promise<void> {
  await app.vault.process(file, (content) => {
    let out = content;
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const escaped = value.replace(/"/g, '\\"');
      const re = new RegExp(`^(\\s*${key}:\\s*).*$`, "m");
      if (re.test(out)) {
        out = out.replace(re, `$1"${escaped}"`);
      } else {
        const fm = out.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fm) {
          out = out.replace(fm[0], fm[0].replace(/\n---\s*$/, `\n${key}: "${escaped}"\n---`));
        }
      }
    }
    return out;
  });
}
