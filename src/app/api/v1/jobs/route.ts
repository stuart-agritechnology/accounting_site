import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { requireUser } from "~/server/auth/requireUser";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("search") ?? "").trim();
    const active = searchParams.get("active"); // "true" | "false" | null

    const where: any = {};
    if (active === "true") where.active = true;
    if (active === "false") where.active = false;

    if (q) {
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { clientName: { contains: q, mode: "insensitive" } },
      ];
    }

    const jobs = await db.job.findMany({
      where,
      orderBy: [{ active: "desc" }, { code: "asc" }],
      take: 500,
      select: { id: true, code: true, name: true, clientName: true, active: true, source: true, externalId: true },
    });

    return NextResponse.json({ ok: true, jobs });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
