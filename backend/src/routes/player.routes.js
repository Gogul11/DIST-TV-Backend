const express = require("express");

const { asyncHandler } = require("../middleware/asyncHandler");
const playerController = require("../controllers/player.controller");

const router = express.Router();

router.post("/play", asyncHandler(playerController.play));
router.post("/stop", asyncHandler(playerController.stop));

module.exports = router;

