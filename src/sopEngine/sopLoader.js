import fs from "fs";
import path from "path";
import { load, dump } from "js-yaml";

/**
 * Dynamic SOP Policy Loader
 * Loads external YAML policies with file modification timestamp (mtime) caching.
 * Any edit or live addition to data/sops.yaml takes effect immediately without code changes or restarts!
 */

const DEFAULT_SOP_PATH = path.resolve(process.cwd(), "data", "sops.yaml");

let cachedSops = [];
let cachedVersion = null;
let lastMtimeMs = 0;

/**
 * Load all SOPs from disk. Automatically invalidates cache if file modified.
 * @param {string} [filePath]
 * @returns {Array<object>}
 */
export function loadSOPs(filePath = DEFAULT_SOP_PATH) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`[SOP Loader] Warning: SOP file not found at ${filePath}`);
      return [];
    }

    const stats = fs.statSync(filePath);
    if (stats.mtimeMs !== lastMtimeMs || cachedSops.length === 0) {
      const fileContents = fs.readFileSync(filePath, "utf8");
      const parsed = load(fileContents);

      if (parsed && Array.isArray(parsed.sops)) {
        cachedSops = parsed.sops;
        cachedVersion = parsed.version || "1.0.0";
        lastMtimeMs = stats.mtimeMs;
        console.log(`[SOP Loader] Loaded ${cachedSops.length} SOPs (Version ${cachedVersion}) from disk.`);
      } else {
        console.error(`[SOP Loader] Invalid SOP YAML structure: 'sops' array missing.`);
      }
    }

    return cachedSops;
  } catch (err) {
    console.error(`[SOP Loader] Error loading SOPs from ${filePath}:`, err.message);
    return cachedSops; // Fallback to last valid cache
  }
}

/**
 * Get active SOPs (always checks mtime).
 */
export function getActiveSOPs(filePath = DEFAULT_SOP_PATH) {
  return loadSOPs(filePath);
}

/**
 * Append or update an SOP dynamically to the YAML file.
 * Perfect for the live interview test ("Add an 11th SOP on the spot").
 * @param {object} newSop
 * @param {string} [filePath]
 */
export function appendSOP(newSop, filePath = DEFAULT_SOP_PATH) {
  if (!newSop || !newSop.id || !newSop.title) {
    throw new Error("Invalid SOP: id and title are required.");
  }

  const fileContents = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "sops: []\n";
  const parsed = load(fileContents) || { version: "1.0.0", sops: [] };

  if (!Array.isArray(parsed.sops)) {
    parsed.sops = [];
  }

  // Check if exists -> replace, else append
  const existingIdx = parsed.sops.findIndex(s => s.id === newSop.id);
  if (existingIdx >= 0) {
    parsed.sops[existingIdx] = newSop;
  } else {
    parsed.sops.push(newSop);
  }

  try {
    fs.writeFileSync(filePath, updatedYaml, "utf8");
  } catch (fsErr) {
    console.warn(`[SOP Loader] Warning: Could not write to disk (${fsErr.message}). Persisting in-memory.`);
    cachedSops = parsed.sops;
    return cachedSops;
  }

  // Force cache refresh
  return loadSOPs(filePath);
}
