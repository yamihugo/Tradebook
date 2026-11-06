const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const BODY_SIZE = 26;

type InlineRun = { text: string; bold: boolean; italic: boolean };
export type ReviewRun = InlineRun & { x: number; size: number; width: number };
export type ReviewLine = { runs: ReviewRun[]; before: number; height: number; size: number; indent: number; bullet: boolean };

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function appendRun(runs: InlineRun[], text: string, bold: boolean, italic: boolean): void {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && last.bold === bold && last.italic === italic) last.text += text;
  else runs.push({ text, bold, italic });
}

/** The editor's bounded inline vocabulary: bold, italic, combined emphasis and escapes. */
function inlineMarkdown(value: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let bold = false;
  let italic = false;
  for (let i = 0; i < value.length;) {
    const char = value[i];
    if (char === "\\" && /[\\*_]/.test(value[i + 1] || "")) {
      appendRun(runs, value[i + 1], bold, italic); i += 2; continue;
    }
    if (char !== "*" && char !== "_") { appendRun(runs, char, bold, italic); i++; continue; }
    if (char === "_" && /[\p{L}\p{N}]/u.test(value[i - 1] || "") && /[\p{L}\p{N}]/u.test(value[i + 1] || "")) {
      appendRun(runs, char, bold, italic); i++; continue;
    }
    let length = 1;
    while (value[i + length] === char) length++;
    let remaining = length;
    while (remaining) {
      const amount = remaining === 3 ? 3 : remaining >= 2 ? 2 : 1;
      const marker = char.repeat(amount);
      const active = amount === 3 ? bold || italic : amount === 2 ? bold : italic;
      const hasClosing = value.indexOf(marker, i + amount) >= 0;
      // Single emphasis needs non-whitespace content. Double markers stay tolerant of old editor saves.
      if (!active && (!hasClosing || (amount === 1 && /\s|^$/.test(value[i + amount] || "")))) appendRun(runs, marker, bold, italic);
      else {
        if (amount >= 2) bold = !bold;
        if (amount !== 2) italic = !italic;
      }
      i += amount; remaining -= amount;
    }
  }
  return runs;
}

function inlineHtml(value: string): string {
  return inlineMarkdown(value).map((run) => {
    let text = escapeHtml(run.text);
    if (run.italic) text = `<em>${text}</em>`;
    if (run.bold) text = `<strong>${text}</strong>`;
    return text;
  }).join("");
}

/** Shared by the editable review display and the exported card; raw HTML is never interpreted. */
export function reviewMarkdownToHtml(markdown: string): string {
  const html: string[] = [];
  let inList = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*[-*] /.test(line)) {
      if (!inList) { html.push("<ul>"); inList = true; }
      html.push(`<li>${inlineHtml(line.replace(/^\s*[-*] /, ""))}</li>`);
      continue;
    }
    if (inList) { html.push("</ul>"); inList = false; }
    if (!line.trim()) continue;
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    html.push(heading ? `<h2>${inlineHtml(heading[1])}</h2>` : `<p>${inlineHtml(line)}</p>`);
  }
  if (inList) html.push("</ul>");
  return html.join("");
}

function isHtmlElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).namespaceURI === "http://www.w3.org/1999/xhtml";
}

function domInline(nodes: Node[], inheritedBold = false, inheritedItalic = false): InlineRun[] {
  const runs: InlineRun[] = [];
  const visit = (node: Node, bold: boolean, italic: boolean): void => {
    if (node.nodeType === Node.TEXT_NODE) { appendRun(runs, (node.nodeValue || "").replace(/\u00a0/g, " "), bold, italic); return; }
    if (!(isHtmlElement(node))) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") { appendRun(runs, "\n", bold, italic); return; }
    let nextBold = bold || tag === "b" || tag === "strong";
    let nextItalic = italic || tag === "i" || tag === "em";
    if (node.style.fontWeight) nextBold = node.style.fontWeight === "bold" || Number(node.style.fontWeight) >= 600;
    if (node.style.fontStyle) nextItalic = node.style.fontStyle === "italic" || node.style.fontStyle === "oblique";
    for (const child of Array.from(node.childNodes)) visit(child, nextBold, nextItalic);
  };
  nodes.forEach((node) => visit(node, inheritedBold, inheritedItalic));
  return runs;
}

function portableInline(nodes: Node[]): string {
  return domInline(nodes).map((run) => {
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text)!;
    if (!match[2]) return run.text;
    const marker = run.bold && run.italic ? "***" : run.bold ? "**" : run.italic ? "*" : "";
    // Spaces belong outside delimiters, and inherited styles do not create nested duplicate markers.
    return match[1] + marker + match[2] + marker + match[3];
  }).join("");
}

export function reviewHtmlToMarkdown(editor: HTMLElement): string {
  const blocks = (nodes: Node[]): string => {
    let result = "";
    let inline: Node[] = [];
    const flush = (): void => { if (inline.length) { result += portableInline(inline) + "\n\n"; inline = []; } };
    for (const node of nodes) {
      if (!(isHtmlElement(node))) { inline.push(node); continue; }
      const tag = node.tagName.toLowerCase();
      const children = Array.from(node.childNodes);
      if (/^h[1-3]$/.test(tag)) { flush(); result += `## ${portableInline(children)}\n\n`; }
      else if (tag === "li") { flush(); result += `- ${portableInline(children)}\n`; }
      else if (tag === "ul" || tag === "ol") { flush(); result += blocks(children) + "\n"; }
      else if (tag === "p" || tag === "div") { flush(); result += blocks(children) + "\n\n"; }
      else inline.push(node);
    }
    flush(); return result;
  };
  return blocks(Array.from(editor.childNodes)).replace(/\n{3,}/g, "\n\n").trim();
}

function runFont(run: InlineRun, size: number): string {
  return `${run.italic ? "italic " : ""}${run.bold ? 700 : 500} ${size}px ${FONT}`;
}

/** Layout styled runs at their actual font widths; headings/list indents affect the content budget. */
export function measureReviewText(ctx: CanvasRenderingContext2D, markdown: string, width: number): ReviewLine[] {
  const parsed = new DOMParser().parseFromString(reviewMarkdownToHtml(markdown), "text/html");
  const lines: ReviewLine[] = [];
  const addBlock = (node: HTMLElement, bullet = false): void => {
    const heading = /^H[1-3]$/.test(node.tagName);
    const size = heading ? 30 : BODY_SIZE;
    const indent = bullet ? 24 : 0;
    const fragments = domInline(Array.from(node.childNodes), heading);
    let runs: ReviewRun[] = [];
    let x = indent;
    let pendingSpace = false;
    let first = true;
    const flush = (): void => {
      if (!runs.length) return;
      const before = lines.length && first ? bullet ? 2 : 6 : 0;
      lines.push({ runs, before, height: size + 6, size, indent, bullet: bullet && first });
      runs = []; x = indent; first = false;
    };
    const append = (text: string, style: InlineRun): void => {
      ctx.font = runFont(style, size);
      const w = ctx.measureText(text).width;
      const last = runs[runs.length - 1];
      if (last && last.bold === style.bold && last.italic === style.italic) { last.text += text; last.width += w; }
      else runs.push({ ...style, text, x, size, width: w });
      x += w;
    };
    for (const fragment of fragments) {
      for (const token of fragment.text.match(/\n|[^\S\n]+|[^\s]+/g) || []) {
        if (token === "\n") { flush(); pendingSpace = false; continue; }
        if (/^\s+$/.test(token)) { pendingSpace = !!runs.length; continue; }
        ctx.font = runFont(fragment, size);
        const wordWidth = ctx.measureText(token).width;
        const spaceWidth = pendingSpace && runs.length ? ctx.measureText(" ").width : 0;
        if (runs.length && x + spaceWidth + wordWidth > width) flush();
        if (pendingSpace && runs.length) append(" ", fragment);
        pendingSpace = false;
        if (wordWidth <= width - indent) append(token, fragment);
        else for (const character of token) {
          ctx.font = runFont(fragment, size);
          if (runs.length && x + ctx.measureText(character).width > width) flush();
          append(character, fragment);
        }
      }
    }
    flush();
  };
  for (const node of Array.from(parsed.body.children)) {
    if (!(isHtmlElement(node))) continue;
    if (node.tagName === "UL" || node.tagName === "OL") {
      for (const item of Array.from(node.children)) if (isHtmlElement(item)) addBlock(item, true);
    } else addBlock(node);
  }
  return lines;
}

export function reviewTextHeight(lines: ReviewLine[]): number {
  return lines.reduce((sum, line) => sum + line.before + line.height, 0);
}

/** Paint every measured line. The caller expands the canvas instead of truncating text. */
export function drawReviewText(ctx: CanvasRenderingContext2D, lines: ReviewLine[], x: number, y: number, width: number, color: string): void {
  let top = y;
  for (const line of lines) {
    top += line.before;
    ctx.fillStyle = color;
    if (line.bullet) { ctx.font = runFont({ text: "", bold: false, italic: false }, BODY_SIZE); ctx.fillText("•", x, top); }
    for (const run of line.runs) {
      ctx.font = runFont(run, run.size);
      if (run.x + ctx.measureText(run.text).width > width + 0.5) throw new Error("Review line exceeds its measured width; export stopped without cutting text.");
      ctx.fillText(run.text, x + run.x, top);
    }
    top += line.height;
  }
}
