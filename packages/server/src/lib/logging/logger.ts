type LogLevel = "INFO" | "ERROR";

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
} as const;

const color = (text: string, ansiColor: string): string => `${ansiColor}${text}${ANSI.reset}`;

const formatMeta = (meta?: Record<string, unknown>): string => {
  if (!meta || Object.keys(meta).length === 0) return "";

  return Object.entries(meta)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
};

const printLog = (
  level: LogLevel,
  requestId: string,
  stage: string,
  message: string,
  meta?: Record<string, unknown>,
): void => {
  const timestamp = new Date().toISOString();
  const levelColor = level === "ERROR" ? ANSI.red : ANSI.green;
  const stageColor = stage === "stt" ? ANSI.yellow : ANSI.cyan;

  const prefix = [
    color(timestamp, ANSI.dim),
    color(`[${level}]`, levelColor),
    color(`[${requestId}]`, ANSI.cyan),
    color(`[${stage}]`, stageColor),
  ].join(" ");

  const line = formatMeta(meta)
    ? `${prefix} ${message} | ${formatMeta(meta)}`
    : `${prefix} ${message}`;
  if (level === "ERROR") {
    console.error(line);
    return;
  }
  console.log(line);
};

/** Logs an informational line with request context. */
export function logInfo(
  requestId: string,
  stage: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  printLog("INFO", requestId, stage, message, meta);
}

/** Logs an error line with request context. */
export function logError(
  requestId: string,
  stage: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  printLog("ERROR", requestId, stage, message, meta);
}
