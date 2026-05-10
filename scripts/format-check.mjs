#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const files = listFiles();

const offenders = files.filter((file) => {
  const content = readFileSync(file, "utf8");
  return content.includes("\t") || (content.length > 0 && !content.endsWith("\n"));
});

if (offenders.length > 0) {
  console.error(`Formatting check failed:\n${offenders.join("\n")}`);
  process.exit(1);
}

console.log("Formatting check passed.");

function listFiles() {
  try {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter(Boolean);
    if (tracked.length > 0) return tracked;
  } catch {
    // Fall back for the initial pre-git scaffold.
  }
  return walk(process.cwd()).filter((file) => {
    const relative = path.relative(process.cwd(), file);
    return !relative.startsWith(".git/")
      && !relative.startsWith(".omc/")
      && !relative.startsWith("node_modules/");
  });
}

function walk(root) {
  const out = [];
  for (const name of readdirSync(root)) {
    const fullPath = path.join(root, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) out.push(...walk(fullPath));
    else out.push(fullPath);
  }
  return out;
}
