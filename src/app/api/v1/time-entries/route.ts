import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { requireUser } from "~/server/auth/requireUser";

export const runtime = "nodejs";

function parseISODateOnly(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("BAD_DATE");
  return new Date(s + "T00:00:00.000Z");
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return NextResponse.json({ ok: false, error: "MISSING_FROM_TO" }, { status: 400 });

    const fromD = parseISODateOnly(from);
    const toD = parseISODateOnly(to);
    const toExclusive = new Date(toD.getTime() + 24 * 60 * 60 * 1000);

    const entries = await db.timeEntry.findMany({
      where: { userId: user.userId, startAt: { gte: fromD, lt: toExclusive } },
      orderBy: [{ startAt: "asc" }],
      include: { job: { select: { id: true, code: true, name: true, clientName: true } } },
      take: 2000,
    });

    return NextResponse.json({ ok: true, entries });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "BAD_DATE" ? 400 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json();

    const jobId = String(body.jobId ?? "").trim();
    const startAt = new Date(String(body.startAt));
    const endAt = new Date(String(body.endAt));
    const timezone = String(body.timezone ?? "Australia/Sydney");
    const notes = body.notes != null && String(body.notes).trim() ? String(body.notes) : null;

    if (!jobId) return NextResponse.json({ ok: false, error: "MISSING_JOB_ID" }, { status: 400 });
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) return NextResponse.json({ ok: false, error: "BAD_TIME" }, { status: 400 });

    const minutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
    if (minutes <= 0) return NextResponse.json({ ok: false, error: "END_BEFORE_START" }, { status: 400 });

    const entry = await db.timeEntry.create({
      data: {
        userId: user.userId,
        jobId,
        startAt,
        endAt,
        timezone,
        minutes,
        notes,
        source: "APP",
      },
      include: { job: { select: { id: true, code: true, name: true, clientName: true } } },
    });

    return NextResponse.json({ ok: true, entry });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
