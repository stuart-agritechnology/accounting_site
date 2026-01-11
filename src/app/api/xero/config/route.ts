// src/app/api/xero/config/route.ts
import { NextResponse } from "next/server";
import { hasXeroConfig, saveXeroConfig, getXeroConfig } from "~/app/app/_lib/xeroConfigStore";
import { makeXeroClient, ensureXeroInitialized } from "~/app/app/_lib/xeroAuth";

export const runtime = "nodejs";

type Body = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
};

export async function GET() {
  const cfg = getXeroConfig();
  return NextResponse.json({
    configured: hasXeroConfig(),
    clientId: cfg.clientId ? mask(cfg.clientId) : "",
    redirectUri: cfg.redirectUri ?? "",
  });
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const clientId = String(body.clientId ?? "").trim();
  const clientSecret = String(body.clientSecret ?? "").trim();
  const redirectUri = String(body.redirectUri ?? "").trim();

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { ok: false, error: "Missing clientId, clientSecret or redirectUri" },
      { status: 400 },
    );
  }

  // Save first
  saveXeroConfig({ clientId, clientSecret, redirectUri });

  // Validate: ensure we can initialize + build consent url
  try {
    const xero = makeXeroClient();
    await ensureXeroInitialized(xero);
    await xero.buildConsentUrl();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Failed to validate Xero config";
    return NextResponse.json({ ok: false, error: String(msg) }, { status: 401 });
  }
}

function mask(v: string) {
  if (v.length <= 8) return "****";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}
