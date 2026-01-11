// src/app/api/xero/disconnect/route.ts
import { NextResponse } from "next/server";
import { clearXeroAll } from "~/app/app/_lib/xeroStore";

export const runtime = "nodejs";

export async function POST() {
  await clearXeroAll();
  return NextResponse.json({ ok: true });
}
