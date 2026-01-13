// src/app/api/payroll/employees/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";

export const runtime = "nodejs";

function s(v: any) {
  return String(v ?? "").trim();
}
function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

export async function GET() {
  try {
    const rows = await db.payrollEmployee.findMany({
      orderBy: [{ noTimesheets: "desc" }, { fullName: "asc" }],
    });
    return NextResponse.json({ ok: true, employees: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const xeroEmployeeId = s(body?.xeroEmployeeId);
    if (!xeroEmployeeId) {
      return NextResponse.json({ ok: false, error: "Missing xeroEmployeeId" }, { status: 400 });
    }

    const fullName = s(body?.fullName) || "Unnamed";

    // Treat baseRate/weeklyHours as PATCH-like:
    // - if not provided, do not overwrite
    // - if provided but <=0, do not overwrite
    const incomingBaseRate = num(body?.baseRate);
    const incomingWeeklyHours = num(body?.weeklyHours);

    const noTimesheets = Boolean(body?.noTimesheets);

    const existing = await db.payrollEmployee.findUnique({ where: { xeroEmployeeId } });

    const nextBaseRate =
      incomingBaseRate !== null && incomingBaseRate > 0 ? incomingBaseRate : existing?.baseRate ?? 0;

    const nextWeeklyHours =
      incomingWeeklyHours !== null && incomingWeeklyHours > 0
        ? incomingWeeklyHours
        : existing?.weeklyHours ?? null;

    const shouldUpdateBaseRate =
      existing && incomingBaseRate !== null && incomingBaseRate > 0 && Math.abs((existing.baseRate ?? 0) - incomingBaseRate) > 1e-6;

    const shouldUpdateWeekly =
      existing &&
      incomingWeeklyHours !== null &&
      incomingWeeklyHours > 0 &&
      (existing.weeklyHours === null || Math.abs(Number(existing.weeklyHours) - incomingWeeklyHours) > 1e-6);

    const row = await db.payrollEmployee.upsert({
      where: { xeroEmployeeId },
      create: {
        xeroEmployeeId,
        fullName,
        baseRate: nextBaseRate,
        noTimesheets,
        weeklyHours: nextWeeklyHours,
      },
      update: {
        fullName,
        noTimesheets,
        ...(shouldUpdateBaseRate ? { baseRate: nextBaseRate } : {}),
        ...(shouldUpdateWeekly ? { weeklyHours: nextWeeklyHours } : {}),
      },
    });

    return NextResponse.json({ ok: true, employee: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}
