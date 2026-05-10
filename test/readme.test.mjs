// T-503 — README example freshness.
//
// Runs the command shown in README.md's Example output block and asserts the
// documented output stays in sync with the CLI renderer.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("README example output matches the CLI", () => {
  const readme = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
  const block = extractExampleBlock(readme);
  const [commandLine, ...expectedOutputLines] = block.split("\n");
  const expectedOutput = expectedOutputLines.join("\n");

  assert.ok(commandLine.startsWith("$ "), "example block begins with a shell command");
  const output = runDocumentedCommand(commandLine.slice(2));
  assert.equal(output.trimEnd(), expectedOutput.trimEnd());
});

function extractExampleBlock(readme) {
  const match = readme.match(/## Example output[\s\S]*?```text\n([\s\S]*?)\n```/);
  assert.ok(match, "README contains an Example output text block");
  return match[1];
}

function runDocumentedCommand(command) {
  const args = command.split(/\s+/);
  assert.equal(args[0], "node", "README example uses node");
  return execFileSync(process.execPath, args.slice(1), {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
}
