// src/app/app/_lib/xeroApi.ts
import { getXeroTokens, saveXeroTokens } from "./xeroStore";

/**
 * Requires env vars:
 * - XERO_CLIENT_ID
 * - XERO_CLIENT_SECRET
 */
function envOrThrow(k: string) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

type XeroTokens = {
  access_token: string;
  refresh_token: string;
  expires_at?: number; // unix seconds
  expires_in?: number;
  token_type?: string;
  scope?: string;

  tenant_id?: string;
  tenant_name?: string;
};

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

async function refreshTokenIfNeeded(tokens: XeroTokens): Promise<XeroTokens> {
  const expiresAt = Number(tokens.expires_at ?? 0);
  const isExpiredOrSoon = !expiresAt || expiresAt <= nowSec() + 60;

  if (!isExpiredOrSoon) return tokens;

  const clientId = envOrThrow("XERO_CLIENT_ID");
  const clientSecret = envOrThrow("XERO_CLIENT_SECRET");

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", tokens.refresh_token);

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: body.toString(),
    cache: "no-store",
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error_description ?? json?.error ?? `Xero token refresh failed (${res.status})`);
  }

  const next: XeroTokens = {
    ...tokens,
    ...json,
    expires_at: nowSec() + Number(json.expires_in ?? 0),
  };

  await saveXeroTokens(next);
  return next;
}

async function ensureTenant(tokens: XeroTokens): Promise<XeroTokens> {
  if (tokens.tenant_id) return tokens;

  const res = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: "no-store",
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.message ?? `Xero connections failed (${res.status})`);
  }

  const first = Array.isArray(json) ? json[0] : null;
  if (!first?.tenantId) throw new Error("No Xero tenant connected.");

  const next: XeroTokens = {
    ...tokens,
    tenant_id: String(first.tenantId),
    tenant_name: String(first.tenantName ?? ""),
  };

  await saveXeroTokens(next);
  return next;
}

export async function getXeroAuthOrThrow() {
  const tokens = (await getXeroTokens()) as XeroTokens | null;
  if (!tokens?.access_token || !tokens?.refresh_token) {
    throw new Error("Xero not connected (missing tokens).");
  }

  const fresh = await refreshTokenIfNeeded(tokens);
  const withTenant = await ensureTenant(fresh);

  return {
    accessToken: withTenant.access_token,
    tenantId: withTenant.tenant_id!,
    tenantName: withTenant.tenant_name ?? "",
  };
}

export async function xeroFetch(path: string, init?: RequestInit) {
  const { accessToken, tenantId } = await getXeroAuthOrThrow();

  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      "xero-tenant-id": tenantId,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore parse
  }

  if (!res.ok) {
    // surface Xero error payloads cleanly
    throw new Error(json?.Detail ?? json?.Message ?? json?.error ?? text ?? `Xero request failed (${res.status})`);
  }

  return json;
}

export function normFullName(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
