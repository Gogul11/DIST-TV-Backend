const fs = require("fs");
const path = require("path");

const { config } = require("../config");
const { HttpError } = require("../utils/httpError");
const { sanitizeFolderName, resolveInside } = require("../utils/safePath");

function listFolders(req, res) {
  const entries = fs.readdirSync(config.baseMediaDir, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name }));

  res.json({ ok: true, folders });
}

function createFolder(req, res) {
  const folderName = sanitizeFolderName(req.body?.name);
  if (!folderName) throw new HttpError(400, "Invalid folder name");

  const folderPath = resolveInside(config.baseMediaDir, folderName);
  if (!folderPath) throw new HttpError(400, "Invalid folder path");

  fs.mkdirSync(folderPath, { recursive: true });
  res.json({ ok: true, folder: { name: folderName } });
}

function deleteFolder(req, res) {
  const folderName = sanitizeFolderName(req.params.folder);
  if (!folderName) throw new HttpError(400, "Invalid folder name");

  const folderPath = resolveInside(config.baseMediaDir, folderName);
  if (!folderPath) throw new HttpError(400, "Invalid folder path");
  if (!fs.existsSync(folderPath)) throw new HttpError(404, "Folder not found");

  const stat = fs.statSync(folderPath);
  if (!stat.isDirectory()) throw new HttpError(404, "Folder not found");

  fs.rmSync(folderPath, { recursive: true, force: true });
  res.json({ ok: true, deleted: { name: folderName } });
}

function isSafeFilename(input) {
  const value = String(input || "");
  if (!value) return false;
  if (value.includes("/") || value.includes("\\") || value.includes("..")) return false;
  return true;
}

function deleteItem(req, res) {
  const folderName = sanitizeFolderName(req.params.folder);
  if (!folderName) throw new HttpError(400, "Invalid folder name");
  if (!isSafeFilename(req.params.filename)) throw new HttpError(400, "Invalid filename");

  const absPath = resolveInside(config.baseMediaDir, folderName, req.params.filename);
  if (!absPath) throw new HttpError(400, "Invalid file path");
  if (!fs.existsSync(absPath)) throw new HttpError(404, "File not found");

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) throw new HttpError(404, "File not found");

  fs.unlinkSync(absPath);
  res.json({ ok: true, deleted: { folder: folderName, filename: req.params.filename } });
}

function uploadVideo(req, res) {
  if (!req.file) throw new HttpError(400, "Missing file");
  res.json({
    ok: true,
    file: {
      kind: "video",
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      folder: req.params.folder,
      storedAt: path.relative(config.baseMediaDir, req.file.path),
    },
  });
}

function uploadImage(req, res) {
  if (!req.file) throw new HttpError(400, "Missing file");
  res.json({
    ok: true,
    file: {
      kind: "image",
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      folder: req.params.folder,
      storedAt: path.relative(config.baseMediaDir, req.file.path),
    },
  });
}

function listContents(req, res) {
  const folderName = sanitizeFolderName(req.params.folder);
  if (!folderName) throw new HttpError(400, "Invalid folder name");

  const folderPath = resolveInside(config.baseMediaDir, folderName);
  if (!folderPath) throw new HttpError(400, "Invalid folder path");
  if (!fs.existsSync(folderPath)) throw new HttpError(404, "Folder not found");

  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const items = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => {
      const ext = path.extname(filename).toLowerCase();
      const isVideo = [".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"].includes(ext);
      const isImage = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"].includes(ext);
      const kind = isVideo ? "video" : isImage ? "image" : "other";

      return {
        filename,
        kind,
        url: `/media/${encodeURIComponent(folderName)}/${encodeURIComponent(filename)}`,
      };
    })
    .filter((item) => item.kind !== "other");

  res.json({ ok: true, folder: { name: folderName }, items });
}

module.exports = {
  listFolders,
  createFolder,
  deleteFolder,
  deleteItem,
  uploadVideo,
  uploadImage,
  listContents,
};
