// src/app/api/fergus/connect/route.ts
import { NextResponse } from "next/server";
import { clearFergusAuth, saveFergusAuth } from "~/app/app/_lib/fergusStore";
import { fergusFetch } from "~/server/fergus/client";

export const runtime = "nodejs";

type Body = {
  token?: string;
  companyId?: number | string | null;
};

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const token = String(body?.token ?? "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing Fergus Personal Access Token." }, { status: 400 });
  }

  const rawCompany = body?.companyId;
  const companyIdNum = rawCompany == null ? null : Number(rawCompany);
  const companyId = Number.isFinite(companyIdNum) && companyIdNum > 0 ? companyIdNum : null;

  // Save first so fergusFetch can use it
  await saveFergusAuth({ token, companyId });

  // Validate immediately so UI can show success/failure
  try {
    await fergusFetch("/version", { method: "GET" });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // If validation fails, clear the stored token to avoid confusing state.
    await clearFergusAuth();
    const msg = e?.message ?? "Failed to validate token";
    return NextResponse.json({ ok: false, error: String(msg) }, { status: 401 });
  }
}
