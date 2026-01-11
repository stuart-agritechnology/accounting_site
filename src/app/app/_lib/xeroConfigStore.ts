// src/app/app/_lib/xeroConfigStore.ts

export type XeroConfig = {
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __xeroConfig: XeroConfig | undefined;
}

function store(): XeroConfig {
  if (!globalThis.__xeroConfig) {
    globalThis.__xeroConfig = { clientId: null, clientSecret: null, redirectUri: null };
  }
  return globalThis.__xeroConfig;
}

export function getXeroConfig(): XeroConfig {
  const s = store();
  return {
    clientId: s.clientId ?? null,
    clientSecret: s.clientSecret ?? null,
    redirectUri: s.redirectUri ?? null,
  };
}

export function saveXeroConfig(next: { clientId: string; clientSecret: string; redirectUri: string }) {
  const s = store();
  s.clientId = next.clientId;
  s.clientSecret = next.clientSecret;
  s.redirectUri = next.redirectUri;
}

export function clearXeroConfig() {
  const s = store();
  s.clientId = null;
  s.clientSecret = null;
  s.redirectUri = null;
}

export function hasXeroConfig() {
  const s = store();
  return Boolean(s.clientId && s.clientSecret && s.redirectUri);
}
