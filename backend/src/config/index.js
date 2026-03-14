const path = require("path");
const fs = require("fs");

const backendRoot = path.resolve(__dirname, "..", "..");

require("dotenv").config({ path: path.join(backendRoot, ".env") });

function mustGetEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

const baseMediaDir = path.resolve(mustGetEnv("BASE_MEDIA_DIR"));
ensureDirSync(baseMediaDir);

const tmpDir = path.join(backendRoot, ".tmp");
ensureDirSync(tmpDir);

const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || "0.0.0.0",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  baseMediaDir,
  tmpDir,
  player: (process.env.PLAYER || "vlc").toLowerCase(),
  mpvPath: process.env.MPV_PATH || "mpv",
  vlcPath: process.env.VLC_PATH || process.env.CVLC_PATH || "vlc",
  defaultImageDurationSeconds: Number(process.env.IMAGE_DURATION_SECONDS || 5),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 1024),
  playerFullscreen: String(process.env.PLAYER_FULLSCREEN || "true") === "true",
};

module.exports = { config };
