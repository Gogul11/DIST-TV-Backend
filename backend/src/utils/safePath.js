const path = require("path");

function sanitizeFolderName(input) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (value.length > 64) return null;
  if (value.includes("/") || value.includes("\\") || value.includes("..")) return null;
  if (!/^[a-zA-Z0-9 _-]+$/.test(value)) return null;
  return value;
}

function sanitizeFileName(input) {
  const base = path.basename(String(input || "file"));
  const cleaned = base.replace(/[^\w.\- ]+/g, "_").trim();
  if (!cleaned) return "file";
  if (cleaned.length > 160) return cleaned.slice(cleaned.length - 160);
  return cleaned;
}

function resolveInside(baseDir, ...parts) {
  const resolved = path.resolve(baseDir, ...parts);
  const baseResolved = path.resolve(baseDir);
  if (!resolved.startsWith(baseResolved + path.sep) && resolved !== baseResolved) {
    return null;
  }
  return resolved;
}

module.exports = { sanitizeFolderName, sanitizeFileName, resolveInside };

