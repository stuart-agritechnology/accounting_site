// src/app/api/fergus/disconnect/route.ts
import { NextResponse } from "next/server";
import { clearFergusAuth } from "~/app/app/_lib/fergusStore";

export const runtime = "nodejs";

export async function POST() {
  await clearFergusAuth();
  return NextResponse.json({ ok: true });
}
