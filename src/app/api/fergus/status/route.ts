// src/app/api/fergus/status/route.ts
import { NextResponse } from "next/server";
import { getFergusAuth } from "~/app/app/_lib/fergusStore";
import { fergusFetch } from "~/server/fergus/client";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getFergusAuth();

  // If we have no token, we can exit early.
  if (!auth.token) {
    return NextResponse.json({ connected: false, companyId: auth.companyId ?? null });
  }

  // Validate token with a lightweight call.
  try {
    await fergusFetch("/version", { method: "GET" });
    return NextResponse.json({ connected: true, companyId: auth.companyId ?? null });
  } catch {
    // Token present but invalid/expired
    return NextResponse.json({ connected: false, companyId: auth.companyId ?? null });
  }
}
