// src/app/app/_lib/xeroAuth.ts
import { XeroClient } from "xero-node";
import { getXeroTenant, getXeroTokens, saveXeroTenant, saveXeroTokens } from "./xeroStore";
import { getXeroConfig } from "./xeroConfigStore";

export const XERO_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "email",

  // payroll AU timesheets + employees
  "payroll.employees",
  "payroll.timesheets",

  // needed to read PayRuns (so we can find the last posted/paid date)
  "payroll.payruns.read",

  // needed for Payroll AU PayItems (earnings rates)
  "payroll.settings",

  // sometimes needed depending on what you call later
  "accounting.settings",
];

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getClientConfigOrEnv() {
  const cfg = getXeroConfig();

  const clientId = cfg.clientId?.trim() || process.env.XERO_CLIENT_ID?.trim() || "";
  const clientSecret = cfg.clientSecret?.trim() || process.env.XERO_CLIENT_SECRET?.trim() || "";
  const redirectUri = cfg.redirectUri?.trim() || process.env.XERO_REDIRECT_URI?.trim() || "";

  // If UI config not present, require env vars (keeps prod sane)
  if (!clientId || !clientSecret || !redirectUri) {
    return {
      clientId: requireEnv("XERO_CLIENT_ID"),
      clientSecret: requireEnv("XERO_CLIENT_SECRET"),
      redirectUri: requireEnv("XERO_REDIRECT_URI"),
    };
  }

  return { clientId, clientSecret, redirectUri };
}

export function makeXeroClient() {
  const { clientId, clientSecret, redirectUri } = getClientConfigOrEnv();

  return new XeroClient({
    clientId,
    clientSecret,
    redirectUris: [redirectUri],
    scopes: XERO_SCOPES,
  });
}

// xero-node requires initialize() before refreshToken/apiCallback/buildConsentUrl
export async function ensureXeroInitialized(xero: XeroClient) {
  const anyX = xero as any;
  if (anyX.__initialized) return;
  await xero.initialize();
  anyX.__initialized = true;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * ✅ Refresh token if expired/near-expiry.
 * This keeps xero-node calls alive (push-timesheets, employees, etc.)
 */
async function refreshTokenIfNeeded(tokenSet: any) {
  const expiresAt = Number(tokenSet?.expires_at ?? tokenSet?.expiresAt ?? 0);
  const isExpiredOrSoon = !expiresAt || expiresAt <= nowSec() + 60;

  if (!isExpiredOrSoon) return tokenSet;

  const { clientId, clientSecret } = getClientConfigOrEnv();
  const refreshToken = String(tokenSet?.refresh_token ?? tokenSet?.refreshToken ?? "").trim();
  if (!refreshToken) throw new Error("Xero token expired and no refresh_token is available. Reconnect Xero.");

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: body.toString(),
    cache: "no-store",
  });

  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error_description ?? json?.error ?? `Xero token refresh failed (${res.status})`;
    throw new Error(msg);
  }

  // Xero returns: access_token, expires_in, token_type, scope, refresh_token (rotating)
  const next = {
    ...tokenSet,
    ...json,
    // keep a consistent unix seconds expiry
    expires_at: nowSec() + Number(json?.expires_in ?? 0),
  };

  await saveXeroTokens(next as any);
  return next;
}

export async function getAuthedXeroClient() {
  const stored = await getXeroTokens();
  if (!stored) throw new Error("Xero not connected");

  // ✅ refresh if needed BEFORE setTokenSet
  const freshTokenSet = await refreshTokenIfNeeded(stored);

  const xero = makeXeroClient();
  await ensureXeroInitialized(xero);
  await xero.setTokenSet(freshTokenSet as any);

  return xero;
}

export async function getTenantOrPickFirst(xero: XeroClient) {
  const cachedTenant = await getXeroTenant();
  if (cachedTenant?.tenantId) {
    return { xero, tenantId: cachedTenant.tenantId, tenantName: cachedTenant.tenantName ?? "" };
  }

  const tenants = await xero.updateTenants();
  if (!tenants?.length) throw new Error("No Xero tenants available");

  const t0 = tenants[0];
  await saveXeroTenant(t0.tenantId, t0.tenantName ?? "");
  return { xero, tenantId: t0.tenantId, tenantName: t0.tenantName ?? "" };
}
