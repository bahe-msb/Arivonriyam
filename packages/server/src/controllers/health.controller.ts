import type { Request, Response } from "express";

/** Returns service health payload. */
export function getHealth(_req: Request, res: Response): void {
  res.json({ status: "ok" });
}
