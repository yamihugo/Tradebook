import { apiVersion } from "obsidian";
import type TradebookPlugin from "../main";

/**
 * A plain-text snapshot of the journal, for bug reports.
 *
 * Written to be read by a human (and pasted into a message) — no JSON, no
 * secrets, no note contents. It answers the questions we would otherwise have to
 * ask three times: which version, which settings, how much data, and what broke.
 */

export function diagnosticsFilename(when = new Date()): string {
  return `tradebook-diagnostics-${when.toISOString().slice(0, 10)}.txt`;
}

function line(label: string, value: unknown): string {
  return `${label.padEnd(22)} ${value === "" || value === undefined ? "—" : String(value)}`;
}

export async function buildDiagnostics(plugin: TradebookPlugin): Promise<string> {
  const s = plugin.settings;
  const out: string[] = [];

  let notes = 0;
  let legs = 0;
  try {
    notes = (await plugin.loadTrades()).length;
    legs = (await plugin.loadTradesExpanded()).length;
  } catch (err) {
    out.push(`! Could not read the trades folder: ${err instanceof Error ? err.message : String(err)}`);
  }

  const active = s.propAccounts ?? [];
  const archived = s.archivedAccounts ?? [];
  const obsidian = typeof apiVersion === "string" && apiVersion ? apiVersion : "unknown";

  out.push("Tradebook — diagnostics");
  out.push(`Generated ${new Date().toISOString()}`);
  out.push("");
  out.push("-- Versions --");
  out.push(line("Plugin", `${plugin.manifest.version} (${plugin.manifest.id})`));
  out.push(line("Obsidian", obsidian));
  out.push("");
  out.push("-- Journal --");
  out.push(line("Journal folder", s.tradesFolder));
  out.push(line("Time zone", s.timeZone || "None (as recorded)"));
  out.push(line("Date format", s.dateFormat ?? "YYYY-MM-DD"));
  out.push(line("Currency", s.currency ?? "USD"));
  out.push(line("Privacy mode", s.privacyMode ? "on" : "off"));
  out.push("");
  out.push("-- Data --");
  out.push(line("Accounts", `${active.length} active, ${archived.length} archived`));
  out.push(line("Trade notes", notes));
  out.push(line("Trades expanded", `${legs} (includes virtual copy legs)`));
  out.push(line("Payouts", (s.payouts ?? []).length));
  out.push(line("Deposits", (s.deposits ?? []).length));
  out.push(line("Strategies / mistakes", `${(s.setups ?? []).length} / ${(s.mistakes ?? []).length}`));
  out.push("");
  out.push("-- Portfolio --");
  out.push(line("Group by", s.accountsGroupBy ?? "type"));
  out.push(line("Cards sorted by", s.accountsSort ?? "name"));
  out.push(line("Firm logo on cards", s.accountsShowLogo === false ? "off" : "on"));
  out.push(line("Archived box", s.accountsShowArchived === false ? "off" : "on"));
  out.push(line("Demos in totals", s.excludeDemosFromPortfolio === false ? "yes" : "no"));
  out.push(line("Copies as separate", s.includeCopiesInPortfolioAnalytics ? "yes" : "no"));
  out.push(line("Types shown", (s.accountsVisibleTypes ?? []).join(", ") || "all"));
  out.push(line("Chart window", s.accountsChartPeriod ?? "all"));
  out.push("");
  out.push("-- Accounts --");
  if (!active.length) out.push("(none configured)");
  for (const a of active) {
    const bits = [a.name, `· ${a.firmId}/${a.programId}`, `· $${a.size.toLocaleString()}`, `· ${a.type}`];
    if (a.copyRole === "base") bits.push("· leader");
    if (a.copyRole === "copier") bits.push(`· copier ×${a.copyMultiplier ?? 1}`);
    if (a.passedAt) bits.push(`· passed ${a.passedAt}`);
    out.push(`  ${bits.join(" ")}`);
  }
  if (archived.length) {
    out.push("");
    out.push("-- Archived --");
    for (const a of archived) out.push(`  ${a.name} · ${a.type}`);
  }
  out.push("");
  out.push("-- Last error --");
  out.push(plugin.lastError() || "(none this session)");
  out.push("");

  return out.join("\n");
}

// Test hook: the harness checks the report without going through the settings UI.
if (typeof window !== "undefined") {
  (window as any).__tjDiagnostics = { buildDiagnostics, diagnosticsFilename };
}
