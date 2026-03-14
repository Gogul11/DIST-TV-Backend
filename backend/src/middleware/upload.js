const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { config } = require("../config");
const { HttpError } = require("../utils/httpError");
const { sanitizeFileName, sanitizeFolderName, resolveInside } = require("../utils/safePath");

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createUploader({ kind }) {
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      const folderRaw = req.params.folder;
      const folderName = sanitizeFolderName(folderRaw);
      if (!folderName) return cb(new HttpError(400, "Invalid folder name"));

      const folderPath = resolveInside(config.baseMediaDir, folderName);
      if (!folderPath) return cb(new HttpError(400, "Invalid folder path"));
      ensureDirSync(folderPath);
      cb(null, folderPath);
    },
    filename(req, file, cb) {
      const safe = sanitizeFileName(file.originalname);
      const ext = path.extname(safe);
      const nameWithoutExt = ext ? safe.slice(0, -ext.length) : safe;
      const unique = `${nameWithoutExt}_${Date.now()}${ext}`;
      cb(null, unique);
    },
  });

  const fileFilter = (req, file, cb) => {
    const mime = String(file.mimetype || "");
    if (kind === "video") {
      if (mime.startsWith("video/") || mime === "application/octet-stream") return cb(null, true);
      return cb(new HttpError(400, "Only video uploads are allowed"));
    }
    if (kind === "image") {
      if (mime.startsWith("image/") || mime === "application/octet-stream") return cb(null, true);
      return cb(new HttpError(400, "Only image uploads are allowed"));
    }
    cb(new HttpError(500, "Invalid uploader kind"));
  };

  return multer({
    storage,
    fileFilter,
    limits: {
      fileSize: config.maxUploadMb * 1024 * 1024,
    },
  });
}

module.exports = { createUploader };

