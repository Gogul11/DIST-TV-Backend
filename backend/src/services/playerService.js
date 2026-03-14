const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { config } = require("../config");
const { HttpError } = require("../utils/httpError");
const { sanitizeFolderName, resolveInside } = require("../utils/safePath");

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"]);

function listPlayableFiles(absFolderPath) {
  const entries = fs.readdirSync(absFolderPath, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => {
      const ext = path.extname(name).toLowerCase();
      return VIDEO_EXTS.has(ext) || IMAGE_EXTS.has(ext);
    })
    .sort((a, b) => a.localeCompare(b));

  return files.map((name) => path.join(absFolderPath, name));
}

function writePlaylist(tmpDir, items) {
  const playlistPath = path.join(tmpDir, `playlist_${Date.now()}.m3u8`);
  const content = ["#EXTM3U", ...items].join("\n") + "\n";
  fs.writeFileSync(playlistPath, content, "utf8");
  return playlistPath;
}

function killProcessTree(proc) {
  if (!proc || !proc.pid) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    try {
      process.kill(proc.pid, "SIGTERM");
    } catch {
      // ignore
    }
  }
}

class PlayerService {
  constructor() {
    this._proc = null;
    this._state = { playing: false };
    this._playlistPath = null;
  }

  getState() {
    return this._state;
  }

  async play({ folder, imageDurationSeconds, fullscreen }) {
    if (this._proc) throw new HttpError(409, "Already playing. Call /api/player/stop first.");

    const folderName = sanitizeFolderName(folder);
    if (!folderName) throw new HttpError(400, "Invalid folder name");

    const absFolderPath = resolveInside(config.baseMediaDir, folderName);
    if (!absFolderPath) throw new HttpError(400, "Invalid folder path");
    if (!fs.existsSync(absFolderPath)) throw new HttpError(404, "Folder not found");

    const items = listPlayableFiles(absFolderPath);
    if (items.length === 0) throw new HttpError(400, "No playable media found in folder");

    const playlistPath = writePlaylist(config.tmpDir, items);
    this._playlistPath = playlistPath;

    const duration =
      typeof imageDurationSeconds === "number" && Number.isFinite(imageDurationSeconds)
        ? Math.max(1, Math.floor(imageDurationSeconds))
        : config.defaultImageDurationSeconds;

    const useFullscreen =
      typeof fullscreen === "boolean" ? fullscreen : config.playerFullscreen;

    const { cmd, args } = buildPlayerCommand({
      duration,
      playlistPath,
      fullscreen: useFullscreen,
    });

    const proc = spawn(cmd, args, {
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true,
    });

    await new Promise((resolve, reject) => {
      proc.once("spawn", resolve);
      proc.once("error", reject);
    }).catch((err) => {
      try {
        fs.unlinkSync(playlistPath);
      } catch {
        // ignore
      }
      this._playlistPath = null;
      throw new HttpError(
        500,
        "Failed to start media player. Is VLC installed and in PATH?",
        { code: err.code, player: config.player, cmd }
      );
    });

    proc.unref();
    proc.on("exit", () => {
      this._proc = null;
      this._state = { playing: false };
      if (this._playlistPath) {
        try {
          fs.unlinkSync(this._playlistPath);
        } catch {
          // ignore
        }
      }
      this._playlistPath = null;
    });
    proc.on("error", () => {
      // If mpv dies after spawn, treat as stopped.
      this._proc = null;
      this._state = { playing: false };
    });

    this._proc = proc;
    this._state = {
      playing: true,
      folder: folderName,
      itemsCount: items.length,
      imageDurationSeconds: duration,
      fullscreen: useFullscreen,
      player: config.player,
      startedAt: new Date().toISOString(),
    };

    return this._state;
  }

  async stop() {
    if (!this._proc) return { playing: false };

    killProcessTree(this._proc);

    const previous = this._state;
    this._proc = null;
    this._state = { playing: false };

    if (this._playlistPath) {
      try {
        fs.unlinkSync(this._playlistPath);
      } catch {
        // ignore
      }
      this._playlistPath = null;
    }

    return { stopped: true, previous };
  }
}

const playerService = new PlayerService();

module.exports = { playerService };

function buildPlayerCommand({ duration, playlistPath, fullscreen }) {
  const player = String(config.player || "vlc").toLowerCase();

  if (player === "mpv") {
    const args = [
      "--no-terminal",
      "--really-quiet",
      `--image-display-duration=${duration}`,
      "--loop-playlist=inf",
      `--playlist=${playlistPath}`,
    ];
    if (fullscreen) args.unshift("--fs");
    return { cmd: config.mpvPath, args };
  }

  // VLC: play a playlist, loop forever. Image duration applies when VLC treats
  // images as still frames in the playlist.
  const args = [
    "--intf",
    "dummy",
    "--no-video-title-show",
    "--quiet",
    "--loop",
    `--image-duration=${duration}`,
  ];
  if (fullscreen) args.push("--fullscreen");
  args.push(playlistPath);

  return { cmd: config.vlcPath, args };
}
