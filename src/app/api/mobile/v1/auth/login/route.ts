import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "~/server/db";
import { signMobileAccessToken, newRefreshToken, hashRefreshToken } from "~/server/auth/mobileJwt";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body.email ?? "").toLowerCase().trim();
    const password = String(body.password ?? "");
    if (!email || !password) return NextResponse.json({ ok: false, error: "MISSING_EMAIL_PASSWORD" }, { status: 400 });

    const user = await db.user.findUnique({ where: { email } });
    if (!user?.passwordHash) return NextResponse.json({ ok: false, error: "INVALID_LOGIN" }, { status: 401 });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return NextResponse.json({ ok: false, error: "INVALID_LOGIN" }, { status: 401 });

    const accessToken = signMobileAccessToken({ sub: user.id, email: user.email ?? undefined }, 60 * 15);

    const refreshToken = newRefreshToken();
    const tokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // 30 days

    await db.mobileRefreshToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    return NextResponse.json({
      ok: true,
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
