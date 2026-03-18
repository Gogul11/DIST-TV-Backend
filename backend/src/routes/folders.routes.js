const express = require("express");

const { asyncHandler } = require("../middleware/asyncHandler");
const foldersController = require("../controllers/folders.controller");
const { createUploader } = require("../middleware/upload");

const router = express.Router();

router.get("/", asyncHandler(foldersController.listFolders));

router.post("/", asyncHandler(foldersController.createFolder));

router.delete("/:folder", asyncHandler(foldersController.deleteFolder));

router.delete("/:folder/items/:filename", asyncHandler(foldersController.deleteItem));

router.get("/:folder/contents", asyncHandler(foldersController.listContents));

router.post(
  "/:folder/videos",
  createUploader({ kind: "video" }).single("file"),
  asyncHandler(foldersController.uploadVideo)
);

router.post(
  "/:folder/images",
  createUploader({ kind: "image" }).single("file"),
  asyncHandler(foldersController.uploadImage)
);

module.exports = router;
