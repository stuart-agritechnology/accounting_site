import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { requireMobileUser } from "~/server/auth/requireMobileUser";

export const runtime = "nodejs";

function parseISODateOnly(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("BAD_DATE");
  return new Date(s + "T00:00:00.000Z");
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireMobileUser(req);
    const body = await req.json();
    const from = String(body.from ?? "");
    const to = String(body.to ?? "");
    if (!from || !to) return NextResponse.json({ ok: false, error: "MISSING_FROM_TO" }, { status: 400 });

    const fromD = parseISODateOnly(from);
    const toD = parseISODateOnly(to);
    const toExclusive = new Date(toD.getTime() + 24 * 60 * 60 * 1000);

    // mark entries in range as SUBMITTED (no longer editable)
    await db.mobileTimeEntry.updateMany({
      where: { userId: user.userId, startAt: { gte: fromD, lt: toExclusive }, status: "DRAFT" },
      data: { status: "SUBMITTED" },
    });

    const submission = await db.mobileTimesheetSubmission.upsert({
      where: { userId_periodStart_periodEnd: { userId: user.userId, periodStart: fromD, periodEnd: toD } },
      create: { userId: user.userId, periodStart: fromD, periodEnd: toD, status: "SUBMITTED" },
      update: { status: "SUBMITTED", submittedAt: new Date() },
    });

    return NextResponse.json({ ok: true, submission });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "UNAUTHENTICATED" || msg === "TOKEN_EXPIRED" ? 401 : msg === "BAD_DATE" ? 400 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
