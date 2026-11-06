export interface PrintFileMove { from: string; to: string }

/** Only replace a link that identifies a moved file, never a matching substring. */
export function remapPrintReference(value: string, moves: readonly PrintFileMove[], notePath: string): string {
  const wrapper = /^(!?\[\[)([^\]]*)(\]\])$/.exec(value);
  const inner = wrapper ? wrapper[2] : value;
  const split = inner.search(/[|#]/);
  const target = split < 0 ? inner : inner.slice(0, split);
  const suffix = split < 0 ? "" : inner.slice(split);
  const relative = target.startsWith("./") || target.startsWith("../");
  const resolve = (path: string) => {
    const parts: string[] = [];
    for (const part of path.split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    return parts.join("/");
  };
  const absolute = relative ? resolve(`${notePath.slice(0, notePath.lastIndexOf("/"))}/${target}`) : target;
  const move = moves.find(({ from }) => from === absolute || (!target.includes("/") && from.split("/").pop() === target));
  if (!move) {
    // Older scalar screenshot fields may contain a delimited list. Try exact
    // whole filenames first, so a comma inside a real filename is not split.
    if (!wrapper && /[,;\n]/.test(value)) {
      return value.split(/([,;\n])/).map((part) => {
        if (!part.trim() || /^[,;\n]$/.test(part)) return part;
        const trimmed = part.trim();
        return part.replace(trimmed, remapPrintReference(trimmed, moves, notePath));
      }).join("");
    }
    return value;
  }
  let renamed = move.to;
  if (relative) {
    const directory = notePath.split("/").slice(0, -1);
    const destination = move.to.split("/");
    while (directory.length && destination.length && directory[0] === destination[0]) { directory.shift(); destination.shift(); }
    renamed = "../".repeat(directory.length) + destination.join("/");
    if (target.startsWith("./") && !renamed.startsWith("../")) renamed = `./${renamed}`;
  } else if (!target.includes("/")) renamed = move.to.split("/").pop() ?? move.to;
  const result = renamed + suffix;
  return wrapper ? wrapper[1] + result + wrapper[3] : result;
}

/** Preserve unknown metadata and captions; only the documented reference fields change. */
export function remapTradePrintFields(data: Record<string, unknown>, moves: readonly PrintFileMove[], notePath: string): void {
  if (typeof data.screenshot === "string") data.screenshot = remapPrintReference(data.screenshot, moves, notePath);
  if (Array.isArray(data.screenshots)) {
    for (const entry of data.screenshots) {
      if (entry && typeof entry === "object" && "file" in entry && typeof entry.file === "string") {
        entry.file = remapPrintReference(entry.file, moves, notePath);
      }
    }
  }
}
