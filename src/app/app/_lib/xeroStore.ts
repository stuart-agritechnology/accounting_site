// src/app/app/_lib/xeroStore.ts
import type { TokenSet } from "xero-node";

type Stored = {
  tokenSet: TokenSet | null;
  tenantId: string | null;
  tenantName: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __xeroStore: Stored | undefined;
}

function store(): Stored {
  if (!globalThis.__xeroStore) {
    globalThis.__xeroStore = { tokenSet: null, tenantId: null, tenantName: null };
  }
  return globalThis.__xeroStore;
}

export async function getXeroTokens() {
  return store().tokenSet ?? null;
}

export async function saveXeroTokens(tokenSet: TokenSet) {
  store().tokenSet = tokenSet;
}

export async function clearXeroTokens() {
  store().tokenSet = null;
}

export async function getXeroTenant() {
  const s = store();
  if (!s.tenantId) return null;
  return { tenantId: s.tenantId, tenantName: s.tenantName ?? "" };
}

export async function saveXeroTenant(tenantId: string, tenantName: string) {
  store().tenantId = tenantId;
  store().tenantName = tenantName;
}

export async function clearXeroTenant() {
  store().tenantId = null;
  store().tenantName = null;
}

export async function clearXeroAll() {
  store().tokenSet = null;
  store().tenantId = null;
  store().tenantName = null;
}
