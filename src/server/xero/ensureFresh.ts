import { loadXeroConnection, saveXeroConnection, type XeroConnection } from "./localStore";
import { refreshXeroToken } from "./refresh";

function isExpired(expiresAtISO: string, skewSeconds = 60): boolean {
  const t = Date.parse(expiresAtISO);
  if (!Number.isFinite(t)) return true;
  return t - Date.now() <= skewSeconds * 1000;
}

/**
 * Loads the saved Xero connection and refreshes it if required.
 *
 * NOTE: This app stores the token set in .xero_local.json (dev-friendly).
 */
export async function getFreshXeroConnection(): Promise<XeroConnection | null> {
  const conn = loadXeroConnection();
  if (!conn) return null;

  if (!conn.expiresAt || isExpired(conn.expiresAt)) {
    const next = await refreshXeroToken(conn.refreshToken);
    const updated: XeroConnection = {
      ...conn,
      accessToken: next.access_token,
      refreshToken: next.refresh_token ?? conn.refreshToken,
      expiresAt: new Date(Date.now() + next.expires_in * 1000).toISOString(),
      scope: next.scope ?? conn.scope,
    };
    saveXeroConnection(updated);
    return updated;
  }

  return conn;
}
