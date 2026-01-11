// src/app/api/xero/employees/route.ts
import { NextResponse } from "next/server";
import { xeroFetch } from "~/app/app/_lib/xeroApi";
import { deriveBaseRates } from "~/server/xero/payrollAu";

export const runtime = "nodejs";

function s(v: any) {
  return String(v ?? "").trim();
}

/**
 * Xero can return dates as:
 *  - "YYYY-MM-DD"
 *  - "YYYY-MM-DDTHH:mm:ss"
 *  - "/Date(1768435200000+0000)/"
 * Normalize all to "YYYY-MM-DD".
 */
function xeroDateToISODateOnly(v: any): string {
  const str = String(v ?? "").trim();
  if (!str) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const isoPrefix = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefix?.[1]) return isoPrefix[1];

  const m = str.match(/^\/Date\((\d+)([+-]\d{4})?\)\/$/);
  if (m) {
    const ms = Number(m[1]);
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return "";
}

function toISODateOnly(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDateOnlyLoose(v: any): Date {
  const iso = xeroDateToISODateOnly(v);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Bad date: ${String(v)}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function addDaysISO(startLike: any, days: number) {
  const d = parseDateOnlyLoose(startLike);
  d.setDate(d.getDate() + days);
  return toISODateOnly(d);
}

function addMonthsISO(startLike: any, months: number) {
  const d = parseDateOnlyLoose(startLike);
  d.setMonth(d.getMonth() + months);
  return toISODateOnly(d);
}

function computeEndExclusiveFromCalendarType(startLike: any, calendarType: string) {
  const startISO = xeroDateToISODateOnly(startLike);
  if (!startISO) return "";

  const t = String(calendarType ?? "").toUpperCase();

  if (t.includes("WEEKLY") && !t.includes("FORT")) return addDaysISO(startISO, 7);
  if (t.includes("FORTNIGHT")) return addDaysISO(startISO, 14);
  if (t.includes("FOURWEEK")) return addDaysISO(startISO, 28);
  if (t.includes("MONTH")) return addMonthsISO(startISO, 1);

  return "";
}

function mapCycleForApp(calendarType: string): "weekly" | "fortnightly" | "monthly" {
  const t = String(calendarType ?? "").toUpperCase();
  if (t.includes("WEEKLY") && !t.includes("FORT")) return "weekly";
  if (t.includes("MONTH")) return "monthly";
  return "fortnightly";
}

export async function GET() {
  try {
    const empJson = await xeroFetch("https://api.xero.com/payroll.xro/1.0/Employees");
    const rawEmployees = (empJson?.employees ?? empJson?.Employees ?? []) as any[];

    // PayItems gives us EarningsRates (incl Ordinary Hours + RatePerUnit)
    const payItemsJson = await xeroFetch("https://api.xero.com/payroll.xro/1.0/PayItems");

    const employees = rawEmployees
      .map((e: any) => {
        const employeeID = s(e?.employeeID ?? e?.EmployeeID);
        const firstName = s(e?.firstName ?? e?.FirstName);
        const lastName = s(e?.lastName ?? e?.LastName);
        const status = s(e?.status ?? e?.Status);

        const nameFallback = s(
          e?.fullName ??
            e?.FullName ??
            e?.name ??
            e?.Name ??
            e?.displayName ??
            e?.DisplayName,
        );

        const fullName = nameFallback || `${firstName} ${lastName}`.trim() || "Unnamed Employee";

        const payrollCalendarID = s(
          e?.payrollCalendarID ??
            e?.PayrollCalendarID ??
            e?.payRunCalendarID ??
            e?.PayRunCalendarID,
        );

        return { employeeID, firstName, lastName, fullName, status, payrollCalendarID };
      })
      .filter((e) => e.employeeID);

    const toXeroEmployeeShape = (e: any) => {
      return {
        EmployeeID: s(e?.EmployeeID ?? e?.employeeID),
        FirstName: s(e?.FirstName ?? e?.firstName),
        LastName: s(e?.LastName ?? e?.lastName),
        Status: s(e?.Status ?? e?.status),
        PayTemplate: e?.PayTemplate ?? e?.payTemplate ?? undefined,
        OrdinaryEarningsRateID: s(e?.OrdinaryEarningsRateID ?? e?.ordinaryEarningsRateID),
      };
    };

    let baseRates = deriveBaseRates(
      rawEmployees.map(toXeroEmployeeShape),
      {
        earningsRates: payItemsJson?.earningsRates ?? payItemsJson?.EarningsRates ?? payItemsJson?.earningsrates ?? [],
      } as any,
    );

    // If list call didn’t include PayTemplate, hydrate per-employee.
    if (baseRates.length < Math.min(3, employees.length)) {
      const detailed: any[] = [];

      const concurrency = 5;
      let i = 0;

      async function worker() {
        while (i < employees.length) {
          const idx = i++;
          const id = employees[idx]?.employeeID;
          if (!id) continue;
          try {
            const j = await xeroFetch(`https://api.xero.com/payroll.xro/1.0/Employees/${encodeURIComponent(id)}`);
            const arr = (j?.Employees ?? j?.employees ?? []) as any[];
            if (arr[0]) detailed.push(arr[0]);
          } catch {
            // ignore
          }
        }
      }

      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      if (detailed.length) {
        baseRates = deriveBaseRates(
          detailed.map(toXeroEmployeeShape),
          {
            earningsRates: payItemsJson?.earningsRates ?? payItemsJson?.EarningsRates ?? payItemsJson?.earningsrates ?? [],
          } as any,
        );
      }
    }

    const byName = new Map<string, number>();
    for (const br of baseRates) {
      const k = s(br.employeeName).toLowerCase().replace(/\s+/g, " ");
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, br.baseRate);
    }

    const employeesWithRates = employees.map((e) => {
      const k = s(e.fullName).toLowerCase().replace(/\s+/g, " ");
      const baseRate = byName.get(k) ?? null;
      return { ...e, baseRate };
    });

    const calJson = await xeroFetch("https://api.xero.com/payroll.xro/1.0/PayrollCalendars");
    const rawCals = (calJson?.payrollCalendars ?? calJson?.PayrollCalendars ?? []) as any[];

    const calendars = rawCals
      .map((c: any) => {
        const payrollCalendarID = s(c?.payrollCalendarID ?? c?.PayrollCalendarID);
        const name = s(c?.name ?? c?.Name) || "Payroll Calendar";
        const calendarType = s(c?.calendarType ?? c?.CalendarType);

        const startDate = xeroDateToISODateOnly(c?.startDate ?? c?.StartDate);
        const paymentDate = xeroDateToISODateOnly(c?.paymentDate ?? c?.PaymentDate);

        const endISOExclusive = startDate ? computeEndExclusiveFromCalendarType(startDate, calendarType) : "";
        const endISOInclusive = endISOExclusive ? addDaysISO(endISOExclusive, -1) : "";

        return {
          payrollCalendarID,
          name,
          calendarType,
          startDate,
          endISOExclusive,
          endISOInclusive,
          paymentDate,
        };
      })
      .filter((c) => c.payrollCalendarID);

    const freq = new Map<string, number>();
    for (const e of employees) {
      if (!e.payrollCalendarID) continue;
      freq.set(e.payrollCalendarID, (freq.get(e.payrollCalendarID) ?? 0) + 1);
    }

    let chosenCalendarId = "";
    let bestCount = -1;
    for (const [id, count] of freq.entries()) {
      if (count > bestCount) {
        bestCount = count;
        chosenCalendarId = id;
      }
    }

    const chosen = calendars.find((c) => c.payrollCalendarID === chosenCalendarId) ?? calendars[0] ?? null;

    const suggestedPeriod =
      chosen?.startDate && (chosen?.endISOInclusive || chosen?.endISOExclusive)
        ? {
            startISO: chosen.startDate,
            // App uses inclusive end date everywhere.
            endISOInclusive: chosen.endISOInclusive || (chosen.endISOExclusive ? addDaysISO(chosen.endISOExclusive, -1) : ""),
            // Keep exclusive for debugging / backwards-compat (some earlier UI stored exclusive)
            endISOExclusive: chosen.endISOExclusive,
            cycle: mapCycleForApp(chosen.calendarType),
            source: {
              payrollCalendarID: chosen.payrollCalendarID,
              name: chosen.name,
              calendarType: chosen.calendarType,
              paymentDate: chosen.paymentDate,
            },
          }
        : null;

    return NextResponse.json({
      ok: true,
      employees: employeesWithRates, // includes baseRate from Ordinary Hours
      calendars,
      suggestedPeriod,
      baseRates, // debug: includes earningsRateName/id/source
    });
  } catch (e: any) {
    const detail =
      e?.message ||
      e?.response?.body?.Detail ||
      e?.response?.body?.detail ||
      e?.response?.body?.message ||
      "Failed to load employees/calendars";

    return NextResponse.json({ ok: false, error: String(detail) }, { status: 500 });
  }
}
