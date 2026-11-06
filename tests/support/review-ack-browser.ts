import * as reviewView from "../../src/views/tradeDetailView";
const { TradeDetailView } = reviewView;
const { __mountReviewAckTest } = reviewView as unknown as { __mountReviewAckTest: (...args: unknown[]) => void };
import { parseTradeFromMarkdown } from "../../src/storage";
import { TFile } from "obsidian";

// The runner compiles the verbatim production tagSection closure into a test-only export.
// Only host element helpers and in-memory file I/O are adapted; handlers/storage are real.
Object.assign(HTMLElement.prototype, {
  createEl(this: HTMLElement, tag: string, options: any = {}) { const e = document.createElement(tag); if (options.cls) e.className = options.cls; if (options.text) e.textContent = options.text; Object.entries(options.attr || {}).forEach(([k,v]) => e.setAttribute(k,String(v))); this.append(e); return e; },
  createDiv(this: HTMLElement, options: any = {}) { return this.createEl("div", options); },
  createSpan(this: HTMLElement, options: any = {}) { return this.createEl("span", options); },
  setText(this: HTMLElement, text: string) { this.textContent = text; },
  setAttr(this: HTMLElement, k: string, v: string) { this.setAttribute(k,v); },
  toggleClass(this: HTMLElement, k: string, on: boolean) { this.classList.toggle(k,on); },
  addClass(this: HTMLElement, ...names: string[]) { this.classList.add(...names); },
  removeClass(this: HTMLElement, ...names: string[]) { this.classList.remove(...names); },
  empty(this: HTMLElement) { this.replaceChildren(); },
});
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const tick = () => new Promise((r) => setTimeout(r, 15));
const groups = [
  { key: "psychology_tags", field: "psychologyAcknowledged", yaml: "psychology_acknowledged", label: "Psychology", text: "No psychology state", tag: "Focused" },
  { key: "mistake_tags", field: "mistakesAcknowledged", yaml: "mistakes_acknowledged", label: "Execution / Mistakes", text: "No execution issue", tag: "Entered early" },
] as const;
function mount(group: typeof groups[number], initial: string, label: string) {
  let content = initial;
  const file = Object.assign(new TFile(), { path: "synthetic-review.md" });
  const panel = document.body.createDiv({ cls: "tj-td-panel ack-test" });
  panel.createDiv({ cls: "tj-td-review-prompts", text: `${group.label} · ${label}` });
  const view: any = Object.create(TradeDetailView.prototype);
  view.trade = { id: file.path, ...parseTradeFromMarkdown(content) };
  view.allTrades = []; view._saveTimers = {};
  view.plugin = { settings: { reviewOptions: { psychology: ["Focused"], mistakes: ["Entered early"] } } };
  view.app = { vault: { getAbstractFileByPath: () => file, process: async (_: unknown, change: (s: string) => string) => { content = change(content); } } };
  view.refreshReviewHeader = () => {};
  view.debounceReview = (_key: string, run: () => Promise<void>) => { void run(); };
  __mountReviewAckTest.call(view, panel, group.key, group.label, "Synthetic test", { field: group.field, text: group.text });
  const button = panel.querySelector<HTMLButtonElement>(".tj-td-ack")!;
  return { view, panel, button, content: () => content };
}
const blank = "---\nsymbol: MES\npsychology_tags: []\nmistake_tags: []\n---\n";
function inspect(button: HTMLButtonElement, active: boolean, label: string): object {
  const css = getComputedStyle(button);
  assert(button.getAttribute("aria-pressed") === String(active), `${label}: pressed state is incorrect`);
  if (active) {
    const green = "rgb(46, 204, 113)"; // Both host modes currently contain a dark TradeBook panel.
    assert(css.color === green && css.borderColor === green, `${label}: selected None is visually neutral (${css.color}, ${css.borderColor})`);
    assert(css.backgroundColor !== "rgba(0, 0, 0, 0)", `${label}: selected tint was overridden`);
  }
  return { label, active, color: css.color, border: css.borderColor, background: css.backgroundColor };
}
async function runReviewAckCases(mode: string) {
  document.body.replaceChildren(); document.documentElement.className = `theme-${mode}`;
  const vars = mode === "light" ? { "--background-primary":"#ffffff", "--background-modifier-border":"#d0d0d0", "--text-normal":"#202020", "--text-muted":"#595959" } : { "--background-primary":"#191919", "--background-modifier-border":"#424242", "--text-normal":"#f4f4f4", "--text-muted":"#b8b8b8" };
  Object.entries(vars).forEach(([k,v]) => document.documentElement.style.setProperty(k,v));
  const checks: object[] = [];
  for (const group of groups) {
    const current = mount(group, blank, "Untouched");
    assert(current.view.trade[group.field] === undefined, "Empty arrays defaulted to acknowledged");
    checks.push(inspect(current.button,false,`${group.key}: untouched`));
    current.button.click(); await tick();
    assert(parseTradeFromMarkdown(current.content())[group.field] === true, "Selected true did not persist");
    checks.push(inspect(current.button,true,`${group.key}: click on`));
    current.button.focus(); checks.push(inspect(current.button,true,`${group.key}: focused`));
    const restored = mount(group,current.content(),"Saved selection");
    checks.push(inspect(restored.button,true,`${group.key}: reload true`));
    current.button.click(); await tick();
    assert(parseTradeFromMarkdown(current.content())[group.field] === false, "Click off did not persist false");
    checks.push(inspect(current.button,false,`${group.key}: click off`));
    const cleared = mount(group,current.content(),"Saved unselected");
    checks.push(inspect(cleared.button,false,`${group.key}: reload false`));
    restored.panel.querySelector<HTMLButtonElement>(".tj-mg-dd-btn")!.click();
    const option = [...document.querySelectorAll<HTMLElement>("[data-dd-value]")].find((el) => el.dataset.ddValue === group.tag)!;
    assert(option, "Actual tag picker option missing"); option.click(); await tick();
    assert(restored.view.trade[group.field] === false && restored.view.trade[group.key].includes(group.tag), "Real tag did not clear acknowledgement");
    checks.push(inspect(restored.button,false,`${group.key}: tag overrides None`));
    restored.button.click(); await tick();
    const saved = parseTradeFromMarkdown(restored.content());
    assert(saved[group.field] === true && saved[group.key]?.length === 0, "None did not clear and persist conflicting tags");
    checks.push(inspect(restored.button,true,`${group.key}: None clears tags`));
    const conflict = mount(group,blank.replace(`${group.key}: []`,`${group.key}: ["${group.tag}"]`).replace("\n---\n",`\n${group.yaml}: true\n---\n`),"Conflicting legacy state");
    checks.push(inspect(conflict.button,false,`${group.key}: tags prevent false None`));
  }
  document.body.replaceChildren();
  for (const group of groups) for (const [label, value] of [["Unanswered", undefined],["Selected",true],["Deselected",false]] as const) mount(group,value === undefined ? blank : blank.replace("\n---\n",`\n${group.yaml}: ${value}\n---\n`),label);
  return { mode, checks };
}
Object.assign(window,{ runReviewAckCases });
