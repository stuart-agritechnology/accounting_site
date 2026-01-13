import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { requireMobileUser } from "~/server/auth/requireMobileUser";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const user = await requireMobileUser(req);
    const id = ctx.params.id;
    const body = await req.json();

    const existing = await db.mobileTimeEntry.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.userId) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    if (existing.status !== "DRAFT") {
      return NextResponse.json({ ok: false, error: "LOCKED" }, { status: 409 });
    }

    const data: any = {};
    if (body.jobId != null) data.jobId = String(body.jobId).trim();
    if (body.startAt != null) data.startAt = new Date(String(body.startAt));
    if (body.endAt != null) data.endAt = new Date(String(body.endAt));
    if (body.timezone != null) data.timezone = String(body.timezone);
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;

    const start = data.startAt ?? existing.startAt;
    const end = data.endAt ?? existing.endAt;
    const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    if (minutes <= 0) return NextResponse.json({ ok: false, error: "END_BEFORE_START" }, { status: 400 });
    data.minutes = minutes;

    const entry = await db.mobileTimeEntry.update({
      where: { id },
      data,
      include: { job: { select: { id: true, code: true, name: true, clientName: true } } },
    });

    return NextResponse.json({ ok: true, entry });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "UNAUTHENTICATED" || msg === "TOKEN_EXPIRED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const user = await requireMobileUser(req);
    const id = ctx.params.id;

    const existing = await db.mobileTimeEntry.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.userId) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    if (existing.status !== "DRAFT") {
      return NextResponse.json({ ok: false, error: "LOCKED" }, { status: 409 });
    }

    await db.mobileTimeEntry.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "UNAUTHENTICATED" || msg === "TOKEN_EXPIRED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
