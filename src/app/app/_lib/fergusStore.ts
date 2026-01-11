// src/app/app/_lib/fergusStore.ts

export type FergusAuth = {
  token: string | null;
  companyId: number | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __fergusAuth: FergusAuth | undefined;
}

function store(): FergusAuth {
  if (!globalThis.__fergusAuth) {
    globalThis.__fergusAuth = { token: null, companyId: null };
  }
  return globalThis.__fergusAuth;
}

export async function getFergusAuth(): Promise<FergusAuth> {
  const s = store();
  return { token: s.token ?? null, companyId: s.companyId ?? null };
}

export async function saveFergusAuth(next: { token: string; companyId?: number | null }) {
  const s = store();
  s.token = next.token;
  s.companyId = typeof next.companyId === "number" && Number.isFinite(next.companyId) ? next.companyId : null;
}

export async function clearFergusAuth() {
  const s = store();
  s.token = null;
  s.companyId = null;
}
