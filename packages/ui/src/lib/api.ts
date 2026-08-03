import type { SessionResponse } from "./types";

const DEFAULT_BASE_URL = "http://localhost:3000";

interface ImportMetaWithEnv {
  env?: Record<string, string | undefined>;
}

function resolveBaseUrl(): string {
  const env = (import.meta as unknown as ImportMetaWithEnv).env;
  const configured = env?.VITE_API_URL;
  return configured && configured.length > 0 ? configured : DEFAULT_BASE_URL;
}

const BASE_URL = resolveBaseUrl();

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

let csrfToken: string | undefined;

export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

export function getCsrfToken(): string | undefined {
  return csrfToken;
}

const AUTH_PATHS = new Set(["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"]);

interface RequestOptions {
  body?: unknown;
  skipRefresh?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const data = await rawRequest<SessionResponse>("POST", "/api/auth/refresh", {
        skipRefresh: true,
      });
      applySession(data);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function applySession(data: SessionResponse): void {
  setCsrfToken(data.csrfToken);
  window.dispatchEvent(new CustomEvent("session:refresh", { detail: data }));
}

async function rawRequest<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (csrfToken && method !== "GET") {
    headers["x-csrf-token"] = csrfToken;
  }

  let response: Response;
  try {
    const init: RequestInit = {
      method,
      headers,
      credentials: "include",
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    response = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    throw new ApiError(0, "Network error: could not reach the API");
  }

  if (response.status === 401 && !AUTH_PATHS.has(path) && !options.skipRefresh) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      return rawRequest<T>(method, path, { ...options, skipRefresh: true });
    }
  }

  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const payload: unknown =
    contentType.includes("application/json") && text.length > 0 ? JSON.parse(text) : null;

  if (response.ok) {
    return payload as T;
  }

  const errorPayload = payload as { error?: { code?: string; message?: string } } | null;
  const message = errorPayload?.error?.message ?? `Request failed with status ${response.status}`;
  throw new ApiError(response.status, message, errorPayload?.error?.code);
}

export const api = {
  get<T>(path: string): Promise<T> {
    return rawRequest<T>("GET", path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return rawRequest<T>("POST", path, { body });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return rawRequest<T>("PUT", path, { body });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return rawRequest<T>("PATCH", path, { body });
  },
  delete<T>(path: string): Promise<T> {
    return rawRequest<T>("DELETE", path);
  },
};
