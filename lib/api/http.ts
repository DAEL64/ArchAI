/*
 * The single seam between the UI and the backend. Every client data call goes
 * through apiFetch, so migrating from Next API routes to a standalone backend
 * is just setting NEXT_PUBLIC_API_BASE_URL — no component changes.
 */

const API_BASE =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_API_BASE_URL) ||
  "";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** JSON payload to send; sets method to POST and the Content-Type header. */
  json?: unknown;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { json, headers, ...rest } = options;
  const init: RequestInit = { ...rest };

  if (json !== undefined) {
    init.method = init.method ?? "POST";
    init.body = JSON.stringify(json);
    init.headers = { "Content-Type": "application/json", ...(headers ?? {}) };
  } else if (headers) {
    init.headers = headers;
  }

  const res = await fetch(`${API_BASE}${path}`, init);

  if (!res.ok) {
    // Surface the server's `details`/`error` so callers' existing error UX
    // (which reads err.message) keeps showing meaningful messages.
    let body: unknown = null;
    let message = `Request failed (${res.status})`;
    try {
      body = await res.json();
      const b = body as Record<string, unknown> | null;
      message =
        (typeof b?.details === "string" && b.details) ||
        (typeof b?.error === "string" && b.error) ||
        (typeof b?.message === "string" && b.message) ||
        message;
    } catch {
      try {
        const text = await res.text();
        if (text) message = text;
      } catch {
        /* keep default message */
      }
    }
    throw new ApiError(message, res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
