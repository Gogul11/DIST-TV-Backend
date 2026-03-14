const { HttpError } = require("../utils/httpError");
const { playerService } = require("../services/playerService");

async function play(req, res) {
  const folder = String(req.body?.folder || "").trim();
  if (!folder) throw new HttpError(400, "Missing folder");

  const imageDurationSeconds =
    req.body?.imageDurationSeconds == null
      ? undefined
      : Number(req.body.imageDurationSeconds);

  const fullscreen = req.body?.fullscreen == null ? undefined : Boolean(req.body.fullscreen);

  const state = await playerService.play({ folder, imageDurationSeconds, fullscreen });
  res.json({ ok: true, state });
}

async function stop(req, res) {
  const state = await playerService.stop();
  res.json({ ok: true, state });
}

module.exports = { play, stop };

