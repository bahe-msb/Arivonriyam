import multer from "multer";
import { isSupportedAudioFile } from "../utils";

/** Multer middleware configured for in-memory audio uploads. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (isSupportedAudioFile(file.originalname || "", file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new Error("Only audio files are supported."));
  },
});
