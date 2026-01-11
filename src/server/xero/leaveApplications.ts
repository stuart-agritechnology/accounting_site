// src/server/xero/leaveApplications.ts

import type { PayLine } from "~/payroll_calc/types";
import type { XeroPayItem } from "~/server/xero/payrollAu";

function s(v: any) {
  return String(v ?? "").trim();
}

function norm(v: any) {
  return s(v).toLowerCase().replace(/\s+/g, " ");
}

function hoursFromPayLine(l: any): number {
  const h = Number(l?.hours);
  if (Number.isFinite(h) && h > 0) return h;
  const minutes = Number(l?.minutes);
  if (Number.isFinite(minutes) && minutes > 0) return minutes / 60;
  return 0;
}

export type LeaveApplicationDraft = {
  EmployeeID: string;
  LeaveTypeID: string;
  Title: string;
  StartDate: string; // YYYY-MM-DD
  EndDate: string; // YYYY-MM-DD
  LeavePeriods?: Array<{
    PayPeriodStartDate?: string;
    PayPeriodEndDate?: string;
    NumberOfUnits?: number;
  }>;
};

/**
 * Xero Payroll AU does NOT accept leave as TimesheetLines.
 * Leave must be sent via LeaveApplications.
 */
export function buildLeaveApplicationsFromPayLines(args: {
  payLines: PayLine[];
  employeeNameToId: Map<string, string>; // normalized name -> EmployeeID
  payItems: XeroPayItem | null;
  periodStartISO: string;
  periodEndISOInclusive: string;
}) {
  const { payLines, employeeNameToId, payItems, periodStartISO, periodEndISOInclusive } = args;

  const leaveLines = payLines.filter((l: any) => Boolean((l as any)?.isLeave));
  if (!leaveLines.length) return { leaveApplications: [] as LeaveApplicationDraft[], warnings: [] as string[] };

  const leaveTypes = (payItems as any)?.leaveTypes ?? (payItems as any)?.LeaveTypes ?? [];
  const leaveTypeByName = new Map<string, string>();
  for (const lt of leaveTypes as any[]) {
    const id = s(lt?.leaveTypeID ?? lt?.LeaveTypeID);
    const name = s(lt?.name ?? lt?.Name);
    if (id && name) leaveTypeByName.set(norm(name), id);
  }

  const warnings: string[] = [];
  const out: LeaveApplicationDraft[] = [];

  // Create one LeaveApplication per leave entry (usually per day).
  for (const l of leaveLines as any[]) {
    const employeeName = s(l?.employeeName);
    const employeeID = employeeNameToId.get(norm(employeeName)) || "";
    if (!employeeID) {
      warnings.push(`Leave skipped: no Xero EmployeeID for "${employeeName}"`);
      continue;
    }

    const title = s(l?.category || l?.type || "Leave");
    const leaveTypeId = leaveTypeByName.get(norm(title)) || "";
    if (!leaveTypeId) {
      warnings.push(`Leave skipped: could not find Xero LeaveTypeID for "${title}"`);
      continue;
    }

    // Our canonical field is `date` (YYYY-MM-DD). Older callers may use dateISO/day.
    const day = s(l?.date || l?.dayISO || l?.day || l?.dateISO);
    if (!day) {
      warnings.push(`Leave skipped: missing date for "${employeeName}" (${title})`);
      continue;
    }

    const hours = hoursFromPayLine(l);
    if (!(hours > 0)) {
      warnings.push(`Leave skipped: 0 hours for "${employeeName}" (${title}) on ${day}`);
      continue;
    }

    out.push({
      EmployeeID: employeeID,
      LeaveTypeID: leaveTypeId,
      Title: title,
      StartDate: day,
      EndDate: day,
      // Provide units explicitly so Xero uses the exact leave hours requested.
      LeavePeriods: [
        {
          PayPeriodStartDate: periodStartISO,
          PayPeriodEndDate: periodEndISOInclusive,
          NumberOfUnits: Math.round(hours * 10000) / 10000,
        },
      ],
    });
  }

  return { leaveApplications: out, warnings };
}
