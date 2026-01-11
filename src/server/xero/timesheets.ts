import type { PayLine } from "~/payroll_calc/types";
import type { XeroPayItem, XeroEmployee } from "./payrollAu";

export type XeroTimesheetLine = {
  EarningsRateID: string;
  NumberOfUnits: number[]; // one number per day in the period
};

export type XeroTimesheet = {
  EmployeeID: string;
  StartDate: string; // YYYY-MM-DD
  EndDate: string; // YYYY-MM-DD (inclusive in Xero Payroll AU)
  Status: "DRAFT" | "APPROVED";
  TimesheetLines: XeroTimesheetLine[];
};

function isoToTime(iso: string): number {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function dayIndex(periodStartISO: string, dayISO: string): number {
  const start = isoToTime(periodStartISO);
  const d = isoToTime(dayISO);
  return Math.floor((d - start) / 86400000);
}

function daysInPeriodInclusive(startISO: string, endISOInclusive: string): number {
  const start = isoToTime(startISO);
  const end = isoToTime(endISOInclusive);
  return Math.floor((end - start) / 86400000) + 1;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function employeeFullName(e: XeroEmployee): string {
  const fn = (e.FirstName ?? "").toString().trim();
  const ln = (e.LastName ?? "").toString().trim();
  return `${fn} ${ln}`.trim();
}

function pickEarningsRateIdForCategory(
  category: string,
  xeroEmployee: XeroEmployee,
  payItems: XeroPayItem,
): string | null {
  const cat = norm(category);

  // 1) Ordinary: prefer the employee's own OrdinaryEarningsRateID (most reliable)
  if (cat === "ord" || cat.includes("ordinary")) {
    const ord = (xeroEmployee.OrdinaryEarningsRateID ?? (xeroEmployee as any).ordinaryEarningsRateID ?? "").toString();
    if (ord) return ord;
  }

  // NOTE: Xero SDK responses sometimes vary casing (earningsRates vs EarningsRates)
  // Also: do NOT reference `rates` in its own initializer (will throw TDZ error).
  const rates = (((payItems as any)?.earningsRates ?? (payItems as any)?.EarningsRates ?? []) as Array<any>) ?? [];

  // 2) Name matches
  const byName = (needle: RegExp) => {
    for (const r of rates) {
      const id = (r.earningsRateID ?? r.EarningsRateID ?? "").toString();
      const name = (r.name ?? r.Name ?? "").toString();
      if (!id) continue;
      if (needle.test(name.toLowerCase())) return id;
    }
    return null;
  };

  if (cat === "ord" || cat.includes("ordinary")) {
    return byName(/ordinary|normal|base/) ?? null;
  }

  // 2b) Leave types (we mainly use name matching)
  if (cat.includes("leave") || cat.includes("holiday") || cat.includes("sick")) {
    return (
      byName(/annual\s*leave/) ??
      byName(/sick\s*leave/) ??
      byName(/personal\s*leave|carer/) ??
      byName(/long\s*service/) ??
      byName(/public\s*holiday/) ??
      byName(/leave/) ??
      null
    );
  }

  // 3) Overtime heuristics (labels like "OT1.5", "OT2.0")
  const mult = (() => {
    const m = category.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  })();

  if (cat.includes("ot") || cat.includes("overtime")) {
    if (mult != null) {
      if (mult >= 1.9) {
        return byName(/double|2(\.0)?|x\s*2|2x/) ?? byName(/overtime/) ?? null;
      }
      if (mult >= 1.4 && mult < 1.9) {
        return byName(/time\s*and\s*a\s*half|1\.5|x\s*1\.5|1\.5x/) ?? byName(/overtime/) ?? null;
      }
    }
    return byName(/overtime|ot/) ?? null;
  }

  return null;
}

export function buildTimesheetsFromPayLines(args: {
  payLines: PayLine[];
  periodStartISO: string;
  periodEndISOInclusive: string;
  xeroEmployees: XeroEmployee[];
  payItems: XeroPayItem;
  explicitCategoryToEarningsRateId?: Record<string, string>;
}) {
  const {
    payLines,
    periodStartISO,
    periodEndISOInclusive,
    xeroEmployees,
    payItems,
    explicitCategoryToEarningsRateId,
  } = args;

  // IMPORTANT: leave is pushed via LeaveApplications, not Timesheets.
  const nonLeavePayLines = (payLines ?? []).filter((l: any) => !Boolean(l?.isLeave));

  const endISOInclusive = periodEndISOInclusive;

  const dayCount = daysInPeriodInclusive(periodStartISO, endISOInclusive);
  if (dayCount <= 0 || dayCount > 31) {
    throw new Error(`Bad pay period: ${periodStartISO} -> ${endISOInclusive} (inclusive)`);
  }

  // name -> employee
  const employeeByName = new Map<string, XeroEmployee>();
  for (const e of xeroEmployees) {
    const status = ((e.Status ?? (e as any).status ?? "") as string).toString().toUpperCase();
    if (status && status !== "ACTIVE") continue;
    const n = norm(employeeFullName(e));
    if (n) employeeByName.set(n, e);
  }

  // employeeId -> earningsRateId -> units[]
  const acc = new Map<string, Map<string, number[]>>();
  const missingEmployees: string[] = [];
  const missingCategories: Array<{ employeeName: string; category: string }> = [];

  for (const l of nonLeavePayLines) {
    const e = employeeByName.get(norm(l.employeeName));
    if (!e) {
      if (!missingEmployees.includes(l.employeeName)) missingEmployees.push(l.employeeName);
      continue;
    }

    const employeeId = (e.EmployeeID ?? (e as any).employeeID ?? "").toString();
    if (!employeeId) continue;

    const idx = dayIndex(periodStartISO, l.date);
    if (idx < 0 || idx >= dayCount) continue;

    const explicit = explicitCategoryToEarningsRateId?.[l.category];
    const earningsRateId =
      (explicit ? explicit.toString() : "") ||
      pickEarningsRateIdForCategory(l.category, e, payItems) ||
      (l.category === "ORD" ? (e.OrdinaryEarningsRateID ?? "").toString() : "");

    if (!earningsRateId) {
      missingCategories.push({ employeeName: l.employeeName, category: l.category });
      continue;
    }

    if (!acc.has(employeeId)) acc.set(employeeId, new Map());
    const byRate = acc.get(employeeId)!;
    if (!byRate.has(earningsRateId)) byRate.set(earningsRateId, Array.from({ length: dayCount }, () => 0));
    const units = byRate.get(earningsRateId)!;
    units[idx] += Number(l.hours ?? 0) || 0;
  }

  const timesheets: XeroTimesheet[] = [];
  for (const [employeeId, byRate] of acc.entries()) {
    const lines: XeroTimesheetLine[] = [];
    for (const [earningsRateId, units] of byRate.entries()) {
      const rounded = units.map((u) => Math.round(u * 100) / 100);
      lines.push({ EarningsRateID: earningsRateId, NumberOfUnits: rounded });
    }
    if (lines.length === 0) continue;

    timesheets.push({
      EmployeeID: employeeId,
      StartDate: periodStartISO,
      EndDate: endISOInclusive,
      Status: "DRAFT",
      TimesheetLines: lines,
    });
  }

  return {
    timesheets,
    endISOInclusive,
    dayCount,
    warnings: {
      missingEmployees,
      missingCategories,
    },
  };
}

export async function createTimesheetsInXero(args: {
  accessToken: string;
  tenantId: string;
  timesheets: XeroTimesheet[];
  idempotencyKey?: string;
}) {
  const { accessToken, tenantId, timesheets, idempotencyKey } = args;

  const res = await fetch("https://api.xero.com/payroll.xro/1.0/Timesheets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ Timesheets: timesheets }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Xero Timesheets POST failed (${res.status}): ${txt}`);
  }

  return await res.json();
}
