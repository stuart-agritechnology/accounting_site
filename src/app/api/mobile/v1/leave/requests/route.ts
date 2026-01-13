import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { requireMobileUser } from "~/server/auth/requireMobileUser";

export const runtime = "nodejs";

function parseISODateOnly(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("BAD_DATE");
  return new Date(s + "T00:00:00.000Z");
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireMobileUser(req);
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const where: any = { userId: user.userId };

    if (from && to) {
      const fromD = parseISODateOnly(from);
      const toD = parseISODateOnly(to);
      const toExclusive = new Date(toD.getTime() + 24 * 60 * 60 * 1000);
      where.startDate = { gte: fromD, lt: toExclusive };
    }

    const requests = await db.mobileLeaveRequest.findMany({
      where,
      orderBy: [{ startDate: "desc" }],
      take: 500,
    });

    return NextResponse.json({ ok: true, requests });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "UNAUTHENTICATED" || msg === "TOKEN_EXPIRED" ? 401 : msg === "BAD_DATE" ? 400 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireMobileUser(req);
    const body = await req.json();

    const type = String(body.type ?? "").trim();
    const startDate = new Date(String(body.startDate));
    const endDate = new Date(String(body.endDate));
    const minutesPerDay = body.minutesPerDay != null ? Number(body.minutesPerDay) : null;
    const notes = body.notes != null && String(body.notes).trim() ? String(body.notes) : null;

    if (!type) return NextResponse.json({ ok: false, error: "MISSING_TYPE" }, { status: 400 });
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return NextResponse.json({ ok: false, error: "BAD_DATE" }, { status: 400 });

    const request = await db.mobileLeaveRequest.create({
      data: {
        userId: user.userId,
        type,
        startDate,
        endDate,
        minutesPerDay,
        notes,
        status: "REQUESTED",
      },
    });

    return NextResponse.json({ ok: true, request });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "UNAUTHENTICATED" || msg === "TOKEN_EXPIRED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
