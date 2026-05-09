export interface ApiErrorBody {
  error?: string;
  [k: string]: unknown;
}

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody | string | null) {
    super(
      (body && typeof body === "object" && body.error) || `HTTP ${status}`,
    );
  }
}

export async function api<T = unknown>(
  url: string,
  opts: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const headers = new Headers(opts.headers || {});
  let body = opts.body;
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(url, { ...opts, headers, body, credentials: "include" });
  const text = await res.text();
  const parsed = text ? safeJson(text) : null;
  if (!res.ok) {
    const errBody: ApiErrorBody | string | null =
      parsed && typeof parsed === "object" ? (parsed as ApiErrorBody) : (parsed as string | null);
    throw new ApiError(res.status, errBody);
  }
  return parsed as T;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
