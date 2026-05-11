import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(__dirname, "..", "scripts");

// snapshot.mjs is the designated v0.2 mutation surface (T-600).
// All other scripts/ files must remain read-only.
const MUTATION_ALLOWLIST = new Set(["lib/snapshot.mjs"]);

const FORBIDDEN = [
  "unlinkSync",
  "rmSync",
  "writeFileSync",
  "renameSync",
  "mkdirSync",
  "appendFileSync",
  "unlink(",
  "rm(",
  "writeFile(",
  "rename(",
  "mkdir(",
  "appendFile("
];

test("scripts/ contains no filesystem mutation primitives", () => {
  const offenders = [];
  for (const file of walkMjs(scriptsDir)) {
    const rel = path.relative(scriptsDir, file);
    if (MUTATION_ALLOWLIST.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    for (const token of FORBIDDEN) {
      if (text.includes(token)) {
        offenders.push(`${rel}: ${token}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `read-only invariant broken:\n${offenders.join("\n")}`);
});

function walkMjs(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = path.join(current, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) stack.push(full);
      else if (full.endsWith(".mjs")) out.push(full);
    }
  }
  return out;
}
