import { vi } from "vitest";

export interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

/** A fetch stub that records requests and answers from a queue of replies. */
export function mockFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const r = replies.length > 1 ? replies.shift()! : replies[0];
    if (!r) throw new Error("mockFetch: no reply queued");
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json", ...r.headers },
    });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

export const noSleep = async () => {};
