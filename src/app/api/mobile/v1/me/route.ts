import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { requireMobileUser } from "~/server/auth/requireMobileUser";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireMobileUser(req);
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
    return NextResponse.json({ ok: true, user });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "UNAUTHENTICATED" || msg === "TOKEN_EXPIRED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
