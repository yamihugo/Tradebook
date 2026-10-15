// Deploy only the built plugin to the one development vault. Never copy settings or trades.
import { readFile, copyFile, rename, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const source = path.dirname(fileURLToPath(import.meta.url));
const vault = path.resolve(source, "..", "vault-dev");
const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
if (manifest.id !== "tradebook") throw new Error("Unexpected plugin id; deployment refused");
const target = path.join(vault, ".obsidian", "plugins", manifest.id);
if (!(await stat(target)).isDirectory()) throw new Error("The development plugin folder is missing");
const hash = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
for (const name of ["main.js", "styles.css", "manifest.json"]) {
  const from = path.join(source, name);
  const to = path.join(target, name);
  const expected = await hash(from);
  const staging = `${to}.deploying`;
  await copyFile(from, staging);
  if (await hash(staging) !== expected) throw new Error(`Copy verification failed: ${name}`);
  await rename(staging, to);
  if (await hash(to) !== expected) throw new Error(`Deployment verification failed: ${name}`);
  console.log(`${name}: SHA-256 verified ${expected}`);
}
console.log(`Deployed to ${vault}. Settings and journal data were not copied.`);
console.log("Reload Obsidian with Ctrl+R to load the updated plugin.");
