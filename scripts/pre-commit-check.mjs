#!/usr/bin/env node
// Pre-commit forbidden-language scan.
//
// Reads staged file paths via `git diff --cached --name-only --diff-filter=ACM`,
// reads each file's STAGED content via `git show :<path>`, and runs the same
// forbidden-phrase check that test/forbidden-language.test.mjs uses.
//
// Forbidden-phrase list is duplicated here intentionally (zero-dep constraint).
// Cross-reference: test/forbidden-language.test.mjs (FORBIDDEN_PHRASES +
// CONTEXTUAL_RULES). Any change to that list MUST be mirrored here.
//
// Exit 0 = clean. Exit 1 = forbidden phrase found (prints file:line + match).

import { execFileSync } from "node:child_process";

// ---------- forbidden phrase list (mirror of test/forbidden-language.test.mjs) ----------

const FORBIDDEN_PHRASES = [
  // decision-calculus §11
  "safe to delete",
  "safe cleanup",
  "trash",
  "junk",
  "obviously unused",
  "auto-fix",
  "guaranteed rollback",

  // report-grammar §8 (additional)
  "deletion-ready",
  "definitely unused",

  // vocabulary §3 (stricter set)
  "optimized",
  "clean bill of health",
  "fixed everything",

  // repair-rollback-spec §8
  "rollback guaranteed"
];

const CONTEXTUAL_RULES = [
  {
    phrase: "unused",
    allowedPrefixes: ["not referenced", "candidate", "may be", "call ", "say ", "label "]
  },
  {
    phrase: "healthy",
    allowedPrefixes: ["after verification", "live probe", "claim ", "call "]
  }
];

// ---------- allowed extensions ----------

const ALLOWED_EXTENSIONS = new Set([
  ".mjs", ".js", ".json", ".md", ".yaml", ".yml", ".txt", ".sh"
]);

// Files that define the forbidden-phrase list itself are exempt from scanning.
// They contain the phrases as string literals by necessity (the list IS the data).
const SELF_EXEMPT = new Set([
  "scripts/pre-commit-check.mjs",
  "test/forbidden-language.test.mjs"
]);

function isTextFile(filePath) {
  if (SELF_EXEMPT.has(filePath)) return false;
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false; // no extension — skip
  return ALLOWED_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

// ---------- word-boundary helper (mirrors test/forbidden-language.test.mjs) ----------

function isWordBoundary(text, idx, length) {
  const left = idx === 0 ? "" : text[idx - 1];
  const right = idx + length >= text.length ? "" : text[idx + length];
  const isWordChar = (ch) => /[A-Za-z0-9_]/.test(ch);
  return !isWordChar(left) && !isWordChar(right);
}

function snippet(text, idx, length) {
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + length + 30);
  return `"${text.slice(start, end).replace(/\n/g, " ")}"`;
}

// ---------- scan one file's content ----------
// Returns an array of {line, phrase, context} objects.

function scanContent(content) {
  const violations = [];
  const lines = content.split("\n");

  // Hard-banned phrases — scan line by line for accurate line numbers.
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      const needle = phrase.toLowerCase();
      const idx = lower.indexOf(needle);
      if (idx !== -1) {
        violations.push({
          line: i + 1,
          phrase,
          context: snippet(lines[i], idx, needle.length)
        });
      }
    }
  }

  // Contextual rules — scan whole content for word-boundary matches.
  const lower = content.toLowerCase();
  for (const rule of CONTEXTUAL_RULES) {
    const needle = rule.phrase.toLowerCase();
    let cursor = 0;
    while (cursor < lower.length) {
      const idx = lower.indexOf(needle, cursor);
      if (idx === -1) break;
      if (!isWordBoundary(lower, idx, needle.length)) {
        cursor = idx + needle.length;
        continue;
      }
      const windowStart = Math.max(0, idx - 80);
      const before = lower.slice(windowStart, idx);
      const allowed = rule.allowedPrefixes.some((prefix) =>
        before.includes(prefix.toLowerCase())
      );
      if (!allowed) {
        // Find line number for this position.
        const lineNum = content.slice(0, idx).split("\n").length;
        const lineStart = content.lastIndexOf("\n", idx - 1) + 1;
        const lineEnd = content.indexOf("\n", idx);
        const lineText = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        const colIdx = idx - lineStart;
        violations.push({
          line: lineNum,
          phrase: rule.phrase,
          context: snippet(lineText, colIdx, needle.length)
        });
      }
      cursor = idx + needle.length;
    }
  }

  return violations;
}

// ---------- main ----------

function main() {
  // Get staged files.
  let stagedOutput;
  try {
    stagedOutput = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch {
    // Not in a git repo or no staged files — treat as clean.
    if (process.env.VERBOSE === "1") {
      console.log("Pre-commit forbidden-language scan: pass (no git context)");
    }
    process.exit(0);
  }

  const stagedFiles = stagedOutput
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter(isTextFile);

  if (stagedFiles.length === 0) {
    if (process.env.VERBOSE === "1") {
      console.log("Pre-commit forbidden-language scan: pass (no text files staged)");
    }
    process.exit(0);
  }

  let anyViolation = false;

  for (const filePath of stagedFiles) {
    let content;
    try {
      content = execFileSync("git", ["show", `:${filePath}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch {
      // File staged but unreadable — skip.
      continue;
    }

    const violations = scanContent(content);
    for (const v of violations) {
      console.error(`${filePath}:${v.line}: forbidden phrase "${v.phrase}" — ${v.context}`);
      anyViolation = true;
    }
  }

  if (anyViolation) {
    console.error(
      "\nPre-commit forbidden-language scan: FAIL\n" +
      "Remove the flagged phrases and try again, or use --no-verify to bypass\n" +
      "(the upstream block-no-verify hook may still reject that)."
    );
    process.exit(1);
  }

  if (process.env.VERBOSE === "1") {
    console.log("Pre-commit forbidden-language scan: pass");
  }
  process.exit(0);
}

main();
