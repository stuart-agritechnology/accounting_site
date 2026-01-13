import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { signMobileAccessToken, hashRefreshToken, newRefreshToken } from "~/server/auth/mobileJwt";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const refreshToken = String(body.refreshToken ?? "").trim();
    if (!refreshToken) return NextResponse.json({ ok: false, error: "MISSING_REFRESH_TOKEN" }, { status: 400 });

    const tokenHash = hashRefreshToken(refreshToken);

    const row = await db.mobileRefreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!row || row.revokedAt) return NextResponse.json({ ok: false, error: "INVALID_REFRESH_TOKEN" }, { status: 401 });
    if (row.expiresAt.getTime() < Date.now()) return NextResponse.json({ ok: false, error: "REFRESH_EXPIRED" }, { status: 401 });

    // rotate refresh token
    const newRt = newRefreshToken();
    const newHash = hashRefreshToken(newRt);
    const newExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

    await db.$transaction([
      db.mobileRefreshToken.update({ where: { tokenHash }, data: { revokedAt: new Date() } }),
      db.mobileRefreshToken.create({ data: { userId: row.userId, tokenHash: newHash, expiresAt: newExpires } }),
    ]);

    const accessToken = signMobileAccessToken({ sub: row.userId, email: row.user.email ?? undefined }, 60 * 15);

    return NextResponse.json({ ok: true, accessToken, refreshToken: newRt });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
