// Surface classification per docs/surface-classification-spec.md §2 + §4.
// Pure function. No I/O. Path-string heuristics only.

import path from "node:path";
import { makeSurfaceClassification } from "./contracts.mjs";

const SECRET_FILENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".netrc",
  "credentials",
  "credentials.json"
]);

const SECRET_NAME_PATTERNS = [
  /\.env(\.|$)/i,
  /(^|[._-])id_(rsa|ed25519|ecdsa|dsa)([._-]|$)/i,
  /(^|[._-])(secret|secrets|credentials|api[_-]?key)([._-]|$)/i,
  /\.pem$/i,
  /\.key$/i
];

/**
 * @param {string} targetPath - absolute path or path under the home root.
 * @param {object} [hints]
 * @param {string} [hints.home] - the .claude home root (absolute).
 * @param {boolean} [hints.loaded] - whether the surface is referenced by a loader (e.g. a hook entry).
 * @param {boolean} [hints.isPluginCacheVersionDir] - caller already determined this is a plugins/cache/<m>/<p>/<v> dir.
 * @param {boolean} [hints.isHookCommand] - the path is the command target inside a hook entry.
 * @param {boolean} [hints.isMcpCommand] - the path is the command field of an MCP server entry.
 * @returns {object} SurfaceClassification per docs/schemas.md §2.
 */
export function classifySurface(targetPath, hints = {}) {
  const p = String(targetPath || "");
  const home = hints.home ? stripTrailingSep(path.normalize(hints.home)) : null;
  const norm = stripTrailingSep(path.normalize(p));
  const base = path.basename(norm);

  // 1. Housekeeper-owned operation manifest.
  if (segmentsContain(norm, ["housekeeper", "operations"]) && norm.endsWith(".json")) {
    return makeSurfaceClassification({
      surfaceClass: "housekeeper-owned",
      ownerClass: "housekeeper-owned",
      loadBearingClass: "not-load-bearing",
      sensitivityClass: "private-path",
      executionClass: "inert",
      rollbackClass: "manifest-backed",
      scopeClass: "in-scope",
      confidence: "high"
    });
  }

  // 2. Secret-adjacent / secret-content classification (filename and path heuristics).
  if (isSecretPath(base, norm)) {
    const sensitivity = base === ".env" || /\.pem$|\.key$/i.test(base) || /id_(rsa|ed25519|ecdsa|dsa)/i.test(base)
      ? "secret-content"
      : "secret-adjacent";
    return makeSurfaceClassification({
      surfaceClass: "secret-adjacent",
      ownerClass: "user-owned",
      loadBearingClass: "unknown",
      sensitivityClass: sensitivity,
      executionClass: "inert",
      rollbackClass: "unknown",
      scopeClass: "protected",
      confidence: "medium"
    });
  }

  // 3. Hook or MCP command target (executable surface) — hook intent wins over
  //    cache-dir location, since the path is being treated as a script target.
  if (hints.isHookCommand) {
    return makeSurfaceClassification({
      surfaceClass: "executable-surface",
      ownerClass: "user-owned",
      loadBearingClass: hints.loaded ? "known-load-bearing" : "possibly-load-bearing",
      sensitivityClass: "private-path",
      executionClass: hints.loaded ? "runs-hook" : "inert",
      rollbackClass: "unknown",
      scopeClass: "in-scope",
      confidence: hints.loaded ? "high" : "medium"
    });
  }
  if (hints.isMcpCommand) {
    return makeSurfaceClassification({
      surfaceClass: "executable-surface",
      ownerClass: "user-owned",
      loadBearingClass: hints.loaded ? "known-load-bearing" : "possibly-load-bearing",
      sensitivityClass: "private-path",
      executionClass: hints.loaded ? "starts-mcp" : "inert",
      rollbackClass: "unknown",
      scopeClass: "in-scope",
      confidence: hints.loaded ? "high" : "medium"
    });
  }

  // 4. Plugin cache version directory (claude-app-data, claude-managed).
  if (hints.isPluginCacheVersionDir || isPluginCacheVersionDirPath(norm)) {
    return makeSurfaceClassification({
      surfaceClass: "claude-app-data",
      ownerClass: "claude-managed",
      loadBearingClass: "possibly-load-bearing",
      sensitivityClass: "private-path",
      executionClass: "inert",
      rollbackClass: "snapshot-possible",
      scopeClass: "in-scope",
      confidence: "medium"
    });
  }

  // 5. settings.json (authored config, known-load-bearing, inert).
  if (base === "settings.json" || base === "settings.local.json" || base === ".mcp.json") {
    return makeSurfaceClassification({
      surfaceClass: "authored-config",
      ownerClass: "user-owned",
      loadBearingClass: "known-load-bearing",
      sensitivityClass: "private-path",
      executionClass: "inert",
      rollbackClass: "snapshot-possible",
      scopeClass: "in-scope",
      confidence: "high"
    });
  }

  // 6. .claude home content (registry: commands, skills, plugins).
  if (home && norm.startsWith(home + path.sep)) {
    if (segmentsContain(norm, ["plugins"])) {
      return makeSurfaceClassification({
        surfaceClass: "claude-app-data",
        ownerClass: "claude-managed",
        loadBearingClass: "possibly-load-bearing",
        sensitivityClass: "private-path",
        executionClass: "inert",
        rollbackClass: "snapshot-possible",
        scopeClass: "in-scope",
        confidence: "medium"
      });
    }
    if (segmentsContain(norm, ["commands"]) || segmentsContain(norm, ["skills"])) {
      return makeSurfaceClassification({
        surfaceClass: "authored-config",
        ownerClass: "user-owned",
        loadBearingClass: "known-load-bearing",
        sensitivityClass: "private-path",
        executionClass: "inert",
        rollbackClass: "snapshot-possible",
        scopeClass: "in-scope",
        confidence: "high"
      });
    }
  }

  // 7. External reference (path outside the supplied home root).
  if (home && !norm.startsWith(home + path.sep) && norm !== home) {
    return makeSurfaceClassification({
      surfaceClass: "external-reference",
      ownerClass: "unknown",
      loadBearingClass: "unknown",
      sensitivityClass: "unknown",
      executionClass: "inert",
      rollbackClass: "unknown",
      scopeClass: "out-of-scope",
      confidence: "low"
    });
  }

  // 8. Unknown.
  return makeSurfaceClassification();
}

function stripTrailingSep(p) {
  if (p.length <= 1) return p;
  return p.endsWith(path.sep) ? p.slice(0, -1) : p;
}

function segmentsContain(p, segs) {
  const parts = p.split(path.sep);
  for (let i = 0; i + segs.length <= parts.length; i += 1) {
    let ok = true;
    for (let j = 0; j < segs.length; j += 1) {
      if (parts[i + j] !== segs[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function isPluginCacheVersionDirPath(p) {
  // .../plugins/cache/<market>/<plugin>/<version>
  const parts = p.split(path.sep);
  const idx = parts.findIndex((s, i) => s === "plugins" && parts[i + 1] === "cache");
  if (idx < 0) return false;
  // After "plugins/cache" we expect at least 3 more segments: market, plugin, version.
  return parts.length - (idx + 2) >= 3;
}

function isSecretPath(base, fullPath) {
  if (SECRET_FILENAMES.has(base)) return true;
  for (const re of SECRET_NAME_PATTERNS) {
    if (re.test(base)) return true;
  }
  // Path contains a secrets directory segment.
  if (segmentsContain(fullPath, ["secrets"])) return true;
  if (segmentsContain(fullPath, [".ssh"])) return true;
  return false;
}
