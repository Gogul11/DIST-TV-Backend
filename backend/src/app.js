const express = require("express");
const cors = require("cors");

const { config } = require("./config");
const foldersRoutes = require("./routes/folders.routes");
const playerRoutes = require("./routes/player.routes");
const { notFound } = require("./middleware/notFound");
const { errorHandler } = require("./middleware/errorHandler");
const mediaController = require("./controllers/media.controller");
const { asyncHandler } = require("./middleware/asyncHandler");

function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    })
  );

  app.use(express.json({ limit: "5mb" }));

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/folders", foldersRoutes);
  app.use("/api/player", playerRoutes);
  app.get("/media/:folder/:filename", asyncHandler(mediaController.getMediaFile));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
