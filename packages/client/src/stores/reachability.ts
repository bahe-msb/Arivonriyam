import { writable } from "svelte/store";

type ReachabilityState = {
  online: boolean;
  serverReachable: boolean;
};

const initialState: ReachabilityState = {
  online: true,
  serverReachable: true,
};

export const reachability = writable<ReachabilityState>(initialState);

let stopMonitoring: (() => void) | null = null;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function resolveRequestUrl(input: RequestInfo | URL): URL | null {
  if (typeof window === "undefined") return null;

  if (input instanceof Request) {
    return new URL(input.url, window.location.origin);
  }

  if (input instanceof URL) {
    return new URL(input.toString(), window.location.origin);
  }

  if (typeof input === "string") {
    return new URL(input, window.location.origin);
  }

  return null;
}

function isApiRequest(input: RequestInfo | URL): boolean {
  const url = resolveRequestUrl(input);
  return url !== null && url.origin === window.location.origin && url.pathname.startsWith("/api");
}

async function probeServer(nativeFetch: typeof window.fetch): Promise<void> {
  try {
    const response = await nativeFetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error(`Health probe failed with ${response.status}`);
    reachability.set({ online: navigator.onLine, serverReachable: true });
  } catch {
    reachability.set({ online: navigator.onLine, serverReachable: false });
  }
}

export function startReachabilityMonitoring(): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (stopMonitoring) return stopMonitoring;

  const nativeFetch = window.fetch.bind(window);

  const handleOnline = () => {
    reachability.update((state) => ({ ...state, online: true }));
    void probeServer(nativeFetch);
  };

  const handleOffline = () => {
    reachability.set({ online: false, serverReachable: false });
  };

  if (!navigator.onLine) {
    handleOffline();
  } else {
    void probeServer(nativeFetch);
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const watchRequest = isApiRequest(input);

    try {
      const response = await nativeFetch(input, init);
      if (watchRequest) {
        reachability.set({ online: navigator.onLine, serverReachable: true });
      }

      return response;
    } catch (error) {
      if (watchRequest && !isAbortError(error)) {
        reachability.set({ online: navigator.onLine, serverReachable: false });
      }

      throw error;
    }
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  stopMonitoring = () => {
    window.fetch = nativeFetch;
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    stopMonitoring = null;
  };

  return stopMonitoring;
}
