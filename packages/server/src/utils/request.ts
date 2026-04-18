/** Creates a lightweight request id for tracing logs. */
export function createRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
