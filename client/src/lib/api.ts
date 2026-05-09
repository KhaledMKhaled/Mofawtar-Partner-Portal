export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.error || `HTTP ${status}`);
  }
}

export async function api<T = any>(
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
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return text; }
}
