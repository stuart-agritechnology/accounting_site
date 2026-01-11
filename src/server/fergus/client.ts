// src/server/fergus/client.ts
import { getFergusAuth } from "~/app/app/_lib/fergusStore";

export type FergusApiError = {
  status: number;
  message: string;
  body?: unknown;
};

function isAbsoluteUrl(u: string) {
  return /^https?:\/\//i.test(u);
}

export async function fergusFetch<T>(pathOrUrl: string, init?: RequestInit): Promise<T> {
  const auth = await getFergusAuth();
  const token = auth.token;
  if (!token) {
    throw { status: 401, message: "Fergus not connected (missing token)." } satisfies FergusApiError;
  }

  const url = isAbsoluteUrl(pathOrUrl) ? pathOrUrl : `https://api.fergus.com${pathOrUrl}`;

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");

  // Some integrations require company-id; the OpenAPI schema defines it as a header.
  // If the user provides it, we send it.
  if (typeof auth.companyId === "number" && Number.isFinite(auth.companyId)) {
    headers.set("company-id", String(auth.companyId));
  }

  const res = await fetch(url, {
    ...init,
    headers,
    // Fergus API is rate limited, so we avoid Next caching here.
    cache: "no-store",
  });

  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      try {
        body = await res.text();
      } catch {
        body = null;
      }
    }

    const msg =
      (body && typeof body === "object" && (body as any).message) ||
      (body && typeof body === "object" && (body as any).error) ||
      `Fergus API error (${res.status})`;

    throw { status: res.status, message: String(msg), body } satisfies FergusApiError;
  }

  return (await res.json()) as T;
}
