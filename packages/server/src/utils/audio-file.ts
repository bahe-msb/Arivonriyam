import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const knownAudioExtensions = new Set([".wav"]);

/** Returns true when a file looks like a supported audio upload. */
export function isSupportedAudioFile(fileName: string, mimeType: string): boolean {
  const ext = path.extname(fileName || "").toLowerCase();
  const hasKnownAudioExt = knownAudioExtensions.has(ext);
  const mimeLooksAudio = mimeType === "audio/wav" || mimeType === "audio/x-wav";
  const mimeIsGeneric =
    mimeType === "application/octet-stream" ||
    mimeType === "" ||
    mimeType === "application/x-unknown-content-type";

  return mimeLooksAudio || (mimeIsGeneric && hasKnownAudioExt);
}

const sanitizeFileExtension = (fileName: string): string => {
  const ext = path
    .extname(fileName || "")
    .toLowerCase()
    .replace(".", "");
  return ext.replace(/[^a-z0-9]/g, "") || "wav";
};

/** Saves an uploaded in-memory audio file into OS temp storage. */
export async function saveUploadedAudioToTemp(file: Express.Multer.File): Promise<string> {
  const extension = sanitizeFileExtension(file.originalname);
  const tempPath = path.join(
    os.tmpdir(),
    `arivonriyam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`,
  );
  await fs.writeFile(tempPath, file.buffer);
  return tempPath;
}

/** Removes temp audio file if it exists. */
export async function removeTempAudio(filePath: string | null): Promise<void> {
  if (!filePath) return;
  await fs.rm(filePath, { force: true });
}
