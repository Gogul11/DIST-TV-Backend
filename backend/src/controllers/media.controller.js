const fs = require("fs");
const path = require("path");

const { config } = require("../config");
const { HttpError } = require("../utils/httpError");
const { sanitizeFolderName, resolveInside } = require("../utils/safePath");

function isSafeFilename(input) {
  const value = String(input || "");
  if (!value) return false;
  if (value.includes("/") || value.includes("\\") || value.includes("..")) return false;
  return true;
}

function getMediaFile(req, res) {
  const folderName = sanitizeFolderName(req.params.folder);
  if (!folderName) throw new HttpError(400, "Invalid folder name");
  if (!isSafeFilename(req.params.filename)) throw new HttpError(400, "Invalid filename");

  const absPath = resolveInside(config.baseMediaDir, folderName, req.params.filename);
  if (!absPath) throw new HttpError(400, "Invalid file path");
  if (!fs.existsSync(absPath)) throw new HttpError(404, "File not found");

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) throw new HttpError(404, "File not found");

  res.setHeader("Cache-Control", "no-store");
  res.sendFile(absPath);
}

module.exports = { getMediaFile };

