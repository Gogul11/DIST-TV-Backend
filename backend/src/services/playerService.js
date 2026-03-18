const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");

const { config } = require("../config");
const { HttpError } = require("../utils/httpError");
const { sanitizeFolderName, resolveInside } = require("../utils/safePath");

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"]);

function isImagePath(filePath) {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

function createLimitedLogBuffer(maxBytes) {
  let buf = Buffer.alloc(0);
  return {
    append(chunk) {
      if (!chunk || chunk.length === 0) return;
      const next = Buffer.concat([buf, Buffer.from(chunk)]);
      buf = next.length > maxBytes ? next.subarray(next.length - maxBytes) : next;
    },
    toString() {
      return buf.toString("utf8");
    },
    get size() {
      return buf.length;
    },
  };
}

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

function writeM3uPlaylist(tmpDir, items) {
  // Use .m3u (not .m3u8) to avoid some VLC builds treating it as HLS.
  const playlistPath = path.join(tmpDir, `playlist_${Date.now()}.m3u`);
  const content =
    ["#EXTM3U", ...items.flatMap((p) => [`#EXTINF:-1,${path.basename(p)}`, pathToFileURL(p).href])].join(
      "\n"
    ) + "\n";
  fs.writeFileSync(playlistPath, content, "utf8");
  return playlistPath;
}

function escapeXml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function writeXspfPlaylist(tmpDir, items) {
  const playlistPath = path.join(tmpDir, `playlist_${Date.now()}.xspf`);
  const tracks = items
    .map((p) => {
      const url = pathToFileURL(p).href;
      const title = path.basename(p);
      return `    <track><location>${escapeXml(url)}</location><title>${escapeXml(
        title
      )}</title></track>`;
    })
    .join("\n");
  const content = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<playlist version="1" xmlns="http://xspf.org/ns/0/">',
    "  <trackList>",
    tracks,
    "  </trackList>",
    "</playlist>",
    "",
  ].join("\n");
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
    this._seq = null; // { token, cancelled }
  }

  getState() {
    return this._state;
  }

  async play({ folder, imageDurationSeconds, fullscreen }) {
    if (this._proc || this._seq) throw new HttpError(409, "Already playing. Call /api/player/stop first.");

    const folderName = sanitizeFolderName(folder);
    if (!folderName) throw new HttpError(400, "Invalid folder name");

    const absFolderPath = resolveInside(config.baseMediaDir, folderName);
    if (!absFolderPath) throw new HttpError(400, "Invalid folder path");
    if (!fs.existsSync(absFolderPath)) throw new HttpError(404, "Folder not found");

    const items = listPlayableFiles(absFolderPath);
    if (items.length === 0) throw new HttpError(400, "No playable media found in folder");

    const player = String(config.player || "vlc").toLowerCase();

    const duration =
      typeof imageDurationSeconds === "number" && Number.isFinite(imageDurationSeconds)
        ? Math.max(1, Math.floor(imageDurationSeconds))
        : config.defaultImageDurationSeconds;

    const useFullscreen =
      typeof fullscreen === "boolean" ? fullscreen : config.playerFullscreen;

    // Raspberry Pi fullscreen + VLC can fail to render after the first item when
    // switching playlist entries. In that case, run VLC per-item with
    // --play-and-exit and loop in Node.
    const vlcSequential = player === "vlc" && useFullscreen && items.length > 1;

    if (vlcSequential) {
      await this._startVlcSequential({ items, duration, fullscreen: useFullscreen });
      this._state = {
        playing: true,
        folder: folderName,
        itemsCount: items.length,
        imageDurationSeconds: duration,
        fullscreen: useFullscreen,
        player: config.player,
        startedAt: new Date().toISOString(),
        mode: "vlc-sequential",
      };
      return this._state;
    }

    const playlistPath =
      player === "mpv" ? writeM3uPlaylist(config.tmpDir, items) : writeXspfPlaylist(config.tmpDir, items);
    this._playlistPath = playlistPath;

    const { cmd, args } = buildPlayerCommand({
      player,
      duration,
      items,
      playlistPath,
      fullscreen: useFullscreen,
    });

    const debug = Boolean(config.playerDebug);
    const logBuf = debug ? createLimitedLogBuffer(64 * 1024) : null;
    const proc = spawn(cmd, args, {
      detached: process.platform !== "win32",
      stdio: debug ? ["ignore", "pipe", "pipe"] : "ignore",
      windowsHide: true,
    });

    if (debug) {
      proc.stdout?.on("data", (d) => logBuf.append(d));
      proc.stderr?.on("data", (d) => logBuf.append(d));
    }

    await new Promise((resolve, reject) => {
      proc.once("spawn", resolve);
      proc.once("error", reject);
    }).catch((err) => {
      if (playlistPath) {
        try {
          fs.unlinkSync(playlistPath);
        } catch {
          // ignore
        }
      }
      this._playlistPath = null;
      throw new HttpError(
        500,
        "Failed to start media player. Is VLC installed and in PATH?",
        { code: err.code, player: config.player, cmd }
      );
    });

    proc.unref();
    proc.on("exit", (code, signal) => {
      this._proc = null;
      this._state = { playing: false };
      if (this._playlistPath) {
        try {
          fs.unlinkSync(this._playlistPath);
        } catch {
          // ignore
        }
      }
      if (debug && logBuf?.size) {
        try {
          const logPath = path.join(config.tmpDir, "player_last.log");
          fs.writeFileSync(
            logPath,
            [
              `cmd: ${cmd}`,
              `args: ${JSON.stringify(args)}`,
              `itemsCount: ${items.length}`,
              `exitCode: ${code}`,
              `signal: ${signal || ""}`,
              "",
              logBuf.toString(),
              "",
            ].join("\n"),
            "utf8"
          );
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
      mode: player === "mpv" ? "mpv-playlist" : "vlc-playlist",
    };

    return this._state;
  }

  async _startVlcSequential({ items, duration, fullscreen }) {
    const token = Date.now() + Math.random();
    this._seq = { token, cancelled: false, index: 0 };

    const debug = Boolean(config.playerDebug);
    const logBuf = debug ? createLimitedLogBuffer(64 * 1024) : null;
    const delayMs = Math.max(0, Number(config.playerLoopDelaySeconds || 0)) * 1000;
    const nextDelayMs = 150 + delayMs;

    const spawnNext = () => {
      if (!this._seq || this._seq.token !== token || this._seq.cancelled) return;

      const index = this._seq.index % items.length;
      const itemPath = items[index];
      const isImage = isImagePath(itemPath);

      const args = buildVlcSingleItemArgs({ duration, itemPath, isImage, fullscreen });
      const proc = spawn(config.vlcPath, args, {
        detached: process.platform !== "win32",
        stdio: debug ? ["ignore", "pipe", "pipe"] : "ignore",
        windowsHide: true,
      });

      if (debug) {
        logBuf.append(`\n--- item ${index + 1}/${items.length}: ${itemPath}\n`);
        proc.stdout?.on("data", (d) => logBuf.append(d));
        proc.stderr?.on("data", (d) => logBuf.append(d));
      }

      proc.once("error", () => {
        // Stop the sequence on spawn error.
        this._seq = null;
        this._proc = null;
        this._state = { playing: false };
      });

      proc.once("exit", (code, signal) => {
        if (!this._seq || this._seq.token !== token) return;
        if (this._seq.cancelled) {
          this._seq = null;
          this._proc = null;
          this._state = { playing: false };
          if (debug && logBuf?.size) {
            try {
              const logPath = path.join(config.tmpDir, "player_last.log");
              fs.writeFileSync(
                logPath,
                [
                  `cmd: ${config.vlcPath}`,
                  `mode: vlc-sequential`,
                  `itemsCount: ${items.length}`,
                  `lastExitCode: ${code}`,
                  `lastSignal: ${signal || ""}`,
                  "",
                  logBuf.toString(),
                  "",
                ].join("\n"),
                "utf8"
              );
            } catch {
              // ignore
            }
          }
          return;
        }

        // Advance and spawn next item.
        this._seq.index = (this._seq.index + 1) % items.length;
        setTimeout(spawnNext, nextDelayMs);
      });

      proc.unref();
      this._proc = proc;
    };

    // First spawn must succeed before we return from play().
    await new Promise((resolve, reject) => {
      if (!this._seq || this._seq.token !== token) return reject(new Error("Sequence aborted"));

      const index = this._seq.index % items.length;
      const itemPath = items[index];
      const isImage = isImagePath(itemPath);
      const args = buildVlcSingleItemArgs({ duration, itemPath, isImage, fullscreen });
      const proc = spawn(config.vlcPath, args, {
        detached: process.platform !== "win32",
        stdio: debug ? ["ignore", "pipe", "pipe"] : "ignore",
        windowsHide: true,
      });

      if (debug) {
        logBuf.append(`\n--- item ${index + 1}/${items.length}: ${itemPath}\n`);
        proc.stdout?.on("data", (d) => logBuf.append(d));
        proc.stderr?.on("data", (d) => logBuf.append(d));
      }

      proc.once("spawn", resolve);
      proc.once("error", reject);
      proc.once("exit", (code, signal) => {
        // If it exits immediately, still proceed to next item (unless cancelled).
        if (!this._seq || this._seq.token !== token) return;
        if (this._seq.cancelled) return;
        this._seq.index = (this._seq.index + 1) % items.length;
        setTimeout(spawnNext, nextDelayMs);
      });

      proc.unref();
      this._proc = proc;
    }).catch((err) => {
      this._seq = null;
      this._proc = null;
      throw new HttpError(
        500,
        "Failed to start VLC for fullscreen playback. Is VLC installed and working on this device?",
        { code: err.code, cmd: config.vlcPath }
      );
    });
  }

  async stop() {
    if (!this._proc && !this._seq) return { playing: false };

    if (this._seq) this._seq.cancelled = true;
    if (this._proc) killProcessTree(this._proc);

    const previous = this._state;
    this._proc = null;
    this._seq = null;
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

function buildPlayerCommand({ player, duration, items, playlistPath, fullscreen }) {
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
    "--no-one-instance",
    "--no-playlist-enqueue",
    "--playlist-autostart",
    "--no-video-title-show",
    "--loop",
    `--image-duration=${duration}`,
  ];
  if (config.playerDebug) {
    args.push("-vv");
  } else {
    args.push("--quiet");
  }

  if (fullscreen) args.push("--fullscreen", "--no-video-deco", "--video-on-top");
  if (config.vlcVout) args.push(`--vout=${config.vlcVout}`);
  if (Array.isArray(config.vlcExtraArgs) && config.vlcExtraArgs.length) args.push(...config.vlcExtraArgs);
  args.push(playlistPath);

  return { cmd: config.vlcPath, args };
}

function buildVlcSingleItemArgs({ duration, itemPath, isImage, fullscreen }) {
  const args = [
    "--intf",
    "dummy",
    "--no-one-instance",
    "--no-playlist-enqueue",
    "--playlist-autostart",
    "--no-video-title-show",
    "--play-and-exit",
  ];

  if (config.playerDebug) {
    args.push("-vv");
  } else {
    args.push("--quiet");
  }

  if (fullscreen) args.push("--fullscreen", "--no-video-deco", "--video-on-top");
  if (config.vlcVout) args.push(`--vout=${config.vlcVout}`);
  if (Array.isArray(config.vlcExtraArgs) && config.vlcExtraArgs.length) args.push(...config.vlcExtraArgs);

  // Make images behave like timed slides, then exit.
  args.push(`--image-duration=${duration}`);
  if (isImage) args.push(`--run-time=${duration}`);

  args.push(itemPath);
  return args;
}
