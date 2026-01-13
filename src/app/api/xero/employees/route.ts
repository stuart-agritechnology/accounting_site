// src/app/api/xero/employees/route.ts
import { NextResponse } from "next/server";
import { xeroFetch } from "~/app/app/_lib/xeroApi";
import { deriveBaseRates } from "~/server/xero/payrollAu";
import { db } from "~/server/db";

export const runtime = "nodejs";

function s(v: any) {
  return String(v ?? "").trim();
}

function n(v: any, fallback: number | null = null) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

// ✅ Salary helpers (used only when Xero doesn't provide an hourly EarningsRate)
function periodsPerYear(calendarType?: string) {
  const ct = String(calendarType ?? "").toLowerCase();
  if (ct.includes("weekly") && !ct.includes("fort")) return 52;
  if (ct.includes("fortnight")) return 26;
  if (ct.includes("four")) return 13; // four-weekly
  if (ct.includes("month")) return 12;
  return 52; // safe default
}

/**
 * Some Xero salary employees do NOT expose AnnualSalary.
 * Instead, PayTemplate.EarningsLines may contain:
 *  - Amount / FixedAmount / AmountPerPeriod (total $ per pay period), OR
 *  - RatePerUnit * NumberOfUnits (still total $ per pay period).
 *
 * We annualise that based on the employee's payroll calendar type.
 */
function deriveAnnualFromEarningsLines(e: any, calendarType?: string): number | null {
  const pt: any = e?.PayTemplate ?? e?.payTemplate ?? {};
  const lines: any[] = pt?.EarningsLines ?? pt?.earningsLines ?? [];
  if (!Array.isArray(lines) || !lines.length) return null;

  const perYear = periodsPerYear(calendarType);

  // candidates for "units" in an earnings line (used to compute total = rate * units)
  const unitCandidates = (line: any) => [
    line?.NumberOfUnitsPerWeek,
    line?.numberOfUnitsPerWeek,
    line?.NormalNumberOfUnits,
    line?.normalNumberOfUnits,
    line?.NumberOfUnits,
    line?.numberOfUnits,
    line?.Units,
    line?.units,
    line?.Quantity,
    line?.quantity,
  ];

  for (const line of lines) {
    // 1) Prefer direct total-per-period amount fields
    const directAmount =
      line?.Amount ??
      line?.amount ??
      line?.FixedAmount ??
      line?.fixedAmount ??
      line?.AmountPerPeriod ??
      line?.amountPerPeriod ??
      line?.Total ??
      line?.total ??
      null;

    let periodTotal = n(directAmount, null);

    // 2) If no amount, try compute total = ratePerUnit * units
    if (periodTotal === null || periodTotal <= 0) {
      const rate =
        n(line?.RatePerUnit ?? line?.ratePerUnit ?? line?.Rate ?? line?.rate, null) ??
        n(line?.EarningsRate?.RatePerUnit ?? line?.earningsRate?.ratePerUnit, null);

      let units: number | null = null;
      for (const c of unitCandidates(line)) {
        const u = n(c, null);
        if (u && u > 0) {
          units = u;
          break;
        }
      }

      if (rate && units) {
        periodTotal = rate * units;
      }
    }

    if (periodTotal === null || !Number.isFinite(periodTotal) || periodTotal <= 0) continue;

    // sanity: salary per period typically isn't tiny like $1–$20
    if (periodTotal < 50) continue;

    const annual = periodTotal * perYear;

    // sanity: ignore absurd annual numbers
    if (annual >= 1000 && annual <= 5_000_000) return Number(annual.toFixed(6));
  }

  return null;
}

function extractAnnualSalary(e: any): number | null {
  const pt: any = e?.PayTemplate ?? e?.payTemplate ?? {};

  // 1) First try the known/common fields
  const v =
    pt?.AnnualSalary ??
    pt?.annualSalary ??
    pt?.Salary ??
    pt?.salary ??
    pt?.SalaryAmount ??
    pt?.salaryAmount ??
    pt?.SalaryAndWages?.AnnualSalary ??
    pt?.salaryAndWages?.annualSalary ??
    pt?.SalaryAndWages?.AnnualSalaryAmount ??
    pt?.salaryAndWages?.annualSalaryAmount ??
    pt?.SalaryAndWages?.SalaryAmount ??
    pt?.salaryAndWages?.salaryAmount ??
    e?.AnnualSalary ??
    e?.annualSalary;

  const direct = Number(v);
  if (Number.isFinite(direct) && direct > 0) return direct;

  // 2) Deep scan fallback (handles weird/nested Xero shapes)
  const seen = new Set<any>();

  function walk(node: any, path: string, depth: number): number | null {
    if (!node || depth > 6) return null;
    if (typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);

    for (const k of Object.keys(node)) {
      const val = (node as any)[k];
      const p = path ? `${path}.${k}` : k;
      const pLower = p.toLowerCase();

      if (typeof val === "number" || typeof val === "string") {
        const num = Number(val);
        if (Number.isFinite(num) && num > 0) {
          const looksLikeAnnualSalary =
            (pLower.includes("annual") && pLower.includes("salary")) ||
            pLower.includes("annualsalary") ||
            pLower.includes("salaryannual");

          if (looksLikeAnnualSalary && num >= 1000 && num <= 5_000_000) {
            return num;
          }
        }
      }

      if (val && typeof val === "object") {
        const hit = walk(val, p, depth + 1);
        if (hit !== null) return hit;
      }
    }

    return null;
  }

  return walk(e, "", 0);
}

function extractHoursPerWeekDirect(e: any): number | null {
  const pt: any = e?.PayTemplate ?? e?.payTemplate ?? {};
  const v =
    pt?.HoursPerWeek ??
    pt?.hoursPerWeek ??
    pt?.StandardHoursPerWeek ??
    pt?.standardHoursPerWeek ??
    pt?.SalaryAndWages?.HoursPerWeek ??
    pt?.salaryAndWages?.hoursPerWeek ??
    e?.HoursPerWeek ??
    e?.hoursPerWeek;
  const x = Number(v);
  return Number.isFinite(x) && x > 0 && x <= 80 ? x : null;
}

/**
 * Best-effort: Xero AU Payroll Employee.PayTemplate.EarningsLines often carries the contracted
 * weekly "units" (hours) for Ordinary Earnings.
 */
function extractWeeklyHours(e: any, calendarType?: string): number | null {
  const pt: any = e?.PayTemplate ?? e?.payTemplate ?? {};
  const directHpW = n(
    pt?.HoursPerWeek ??
      pt?.hoursPerWeek ??
      pt?.StandardHoursPerWeek ??
      pt?.standardHoursPerWeek ??
      pt?.SalaryAndWages?.HoursPerWeek ??
      pt?.salaryAndWages?.hoursPerWeek ??
      e?.HoursPerWeek ??
      e?.hoursPerWeek,
    null,
  );
  if (directHpW && directHpW > 0 && directHpW <= 80) return directHpW;

  function toWeeklyFromCalendar(unitsPerPeriod: number) {
    const ct = String(calendarType ?? "").toUpperCase();
    if (ct.includes("FORTNIGHT")) return unitsPerPeriod / 2;
    if (ct.includes("FOURWEEK")) return unitsPerPeriod / 4;
    if (ct.includes("MONTH")) return (unitsPerPeriod * 12) / 52;
    return unitsPerPeriod; // weekly default
  }

  const ordinaryId = s(
    e?.ordinaryEarningsRateID ??
      e?.OrdinaryEarningsRateID ??
      e?.payTemplate?.ordinaryEarningsRateID ??
      e?.PayTemplate?.OrdinaryEarningsRateID,
  );

  const lines =
    (e?.PayTemplate?.EarningsLines ??
      e?.payTemplate?.earningsLines ??
      e?.payTemplate?.EarningsLines ??
      []) as any[];

  if (!Array.isArray(lines) || !lines.length) return null;

  const pickLine = () => {
    if (ordinaryId) {
      const hit = lines.find((l) => s(l?.EarningsRateID ?? l?.earningsRateID) === ordinaryId);
      if (hit) return hit;
    }
    return lines.find((l) => /ordinary/i.test(String(l?.EarningsRateName ?? l?.Name ?? ""))) ?? lines[0];
  };

  const line = pickLine();
  if (!line) return null;

  const candidates = [
    line?.NumberOfUnitsPerWeek,
    line?.numberOfUnitsPerWeek,
    line?.NormalNumberOfUnits,
    line?.normalNumberOfUnits,
    line?.NumberOfUnits,
    line?.numberOfUnits,
    line?.Units,
    line?.units,
    line?.Quantity,
    line?.quantity,
  ];

  for (const c of candidates) {
    const v = n(c, null);
    if (v && v > 0 && v <= 200) {
      const weekly = toWeeklyFromCalendar(v);
      if (weekly > 0 && weekly <= 80) return Number(weekly.toFixed(4));
    }
  }

  return null;
}

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

    const payItemsJson = await xeroFetch("https://api.xero.com/payroll.xro/1.0/PayItems");

    // ✅ Calendars (keep working even if hydration fails)
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

        return { payrollCalendarID, name, calendarType, startDate, endISOExclusive, endISOInclusive, paymentDate };
      })
      .filter((c) => c.payrollCalendarID);

    const calTypeById = new Map<string, string>();
    for (const c of calendars) {
      const id = String(c?.payrollCalendarID ?? "").trim();
      if (!id) continue;
      calTypeById.set(id, String(c?.calendarType ?? "").trim());
    }

    // ✅ Internal employee records (PayTemplate kept only for calculations, NOT returned)
    const employees = rawEmployees
      .map((e: any) => {
        const employeeID = s(e?.employeeID ?? e?.EmployeeID);
        const firstName = s(e?.firstName ?? e?.FirstName);
        const lastName = s(e?.lastName ?? e?.LastName);
        const status = s(e?.status ?? e?.Status);

        const nameFallback = s(
          e?.fullName ?? e?.FullName ?? e?.name ?? e?.Name ?? e?.displayName ?? e?.DisplayName,
        );

        const fullName = nameFallback || `${firstName} ${lastName}`.trim() || "Unnamed Employee";

        const payrollCalendarID = s(
          e?.payrollCalendarID ?? e?.PayrollCalendarID ?? e?.payRunCalendarID ?? e?.PayRunCalendarID,
        );

        const payTemplate = e?.PayTemplate ?? e?.payTemplate ?? undefined;
        const ordinaryEarningsRateID = s(e?.OrdinaryEarningsRateID ?? e?.ordinaryEarningsRateID);

        return {
          employeeID,
          firstName,
          lastName,
          fullName,
          status,
          payrollCalendarID,
          PayTemplate: payTemplate,
          OrdinaryEarningsRateID: ordinaryEarningsRateID,
        };
      })
      .filter((e) => e.employeeID);

    const toXeroEmployeeShape = (e: any) => ({
      EmployeeID: s(e?.EmployeeID ?? e?.employeeID),
      FirstName: s(e?.FirstName ?? e?.firstName),
      LastName: s(e?.LastName ?? e?.lastName),
      Status: s(e?.Status ?? e?.status),
      PayTemplate: e?.PayTemplate ?? e?.payTemplate ?? undefined,
      OrdinaryEarningsRateID: s(e?.OrdinaryEarningsRateID ?? e?.ordinaryEarningsRateID),
    });

    let baseRates = deriveBaseRates(
      rawEmployees.map(toXeroEmployeeShape),
      {
        earningsRates:
          payItemsJson?.earningsRates ?? payItemsJson?.EarningsRates ?? payItemsJson?.earningsrates ?? [],
      } as any,
    );

    const byName = new Map<string, number>();
    for (const br of baseRates) {
      const k = s(br.employeeName).toLowerCase().replace(/\s+/g, " ");
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, br.baseRate);
    }

    // ✅ Initial rows (strip PayTemplate from returned data)
    let employeesWithRates = employees.map((e) => {
      const k = s(e.fullName).toLowerCase().replace(/\s+/g, " ");
      const baseRate = byName.get(k) ?? null;
      const ct = e?.payrollCalendarID ? calTypeById.get(String(e.payrollCalendarID).trim()) : undefined;
      const weeklyHours = extractWeeklyHours(e, ct);

      return {
        employeeID: e.employeeID,
        firstName: e.firstName,
        lastName: e.lastName,
        fullName: e.fullName,
        status: e.status,
        payrollCalendarID: e.payrollCalendarID,
        OrdinaryEarningsRateID: e.OrdinaryEarningsRateID,
        baseRate,
        weeklyHours,
      };
    });

    // ✅ Best-effort hydration for salary staff (LIMITED + NEVER breaks endpoint)
    try {
      // treat 0 as missing too
      const missing = employeesWithRates.filter((e: any) => !e.baseRate || e.baseRate <= 0 || !e.weeklyHours);

      // bump cap so you don't "randomly" miss salary people
      const HYDRATE_CAP = 200;
      const targets = missing.slice(0, HYDRATE_CAP);

      if (targets.length) {
        const byId = new Map<string, any>();
        for (const e of employeesWithRates as any[]) byId.set(String(e.employeeID), e);

        const concurrency = 4;
        let i = 0;

        async function worker() {
          while (i < targets.length) {
            const idx = i++;
            const id = targets[idx]?.employeeID;
            if (!id) continue;

            try {
              const j = await xeroFetch(
                `https://api.xero.com/payroll.xro/1.0/Employees/${encodeURIComponent(id)}`,
              );
              const arr = (j?.Employees ?? j?.employees ?? []) as any[];
              const detailed = arr?.[0];
              if (!detailed) continue;

              const current = byId.get(String(id));
              if (!current) continue;

              const ct = current?.payrollCalendarID
                ? calTypeById.get(String(current.payrollCalendarID).trim())
                : undefined;

              const weeklyHours = current.weeklyHours ?? extractWeeklyHours(detailed, ct);

              let baseRate = current.baseRate ?? null;
              if (!baseRate || baseRate <= 0) {
                const hpw = extractHoursPerWeekDirect(detailed) ?? weeklyHours;

                // ✅ Try annual salary first, then derive from earnings lines (salary stored per pay period)
                const annual =
                  extractAnnualSalary(detailed) ??
                  deriveAnnualFromEarningsLines(detailed, ct);

                if (annual && hpw) {
                  baseRate = Number((annual / (hpw * 52)).toFixed(6));
                }
              }

              byId.set(String(id), { ...current, weeklyHours: weeklyHours ?? null, baseRate: baseRate ?? null });
            } catch {
              // ignore single employee failures
            }
          }
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
        employeesWithRates = Array.from(byId.values());
      }
    } catch {
      // ignore hydration failures entirely
    }

    // ✅ Persist baseRate + weeklyHours into DB (do not touch noTimesheets)
    try {
      for (const e of employeesWithRates as any[]) {
        const xeroEmployeeId = s(e.employeeID);
        const fullName = s(e.fullName) || "Unnamed";
        const baseRate = n(e.baseRate, null);
        const weeklyHours = n(e.weeklyHours, null);
        if (!xeroEmployeeId) continue;

        const existing = await db.payrollEmployee.findUnique({ where: { xeroEmployeeId } });

        const shouldUpdateBase =
          baseRate !== null &&
          baseRate > 0 &&
          (!existing || Math.abs((existing.baseRate ?? 0) - baseRate) > 1e-6);

        const shouldUpdateWeekly =
          weeklyHours !== null &&
          weeklyHours > 0 &&
          (!existing ||
            existing.weeklyHours === null ||
            Math.abs(Number(existing.weeklyHours) - weeklyHours) > 1e-6);

        await db.payrollEmployee.upsert({
          where: { xeroEmployeeId },
          create: {
            xeroEmployeeId,
            fullName,
            // keep DB compatible if baseRate is non-nullable in Prisma (0 means "unknown" here)
            baseRate: baseRate !== null && baseRate > 0 ? baseRate : 0,
            weeklyHours: weeklyHours !== null && weeklyHours > 0 ? weeklyHours : null,
            noTimesheets: false,
          },
          update: {
            fullName,
            ...(shouldUpdateBase ? { baseRate: baseRate! } : {}),
            ...(shouldUpdateWeekly ? { weeklyHours: weeklyHours! } : {}),
          },
        });
      }
    } catch {
      // ignore persistence errors
    }

    // Suggested period (unchanged)
    const freq = new Map<string, number>();
    for (const e of employeesWithRates as any[]) {
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
            endISOInclusive:
              chosen.endISOInclusive ||
              (chosen.endISOExclusive ? addDaysISO(chosen.endISOExclusive, -1) : ""),
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
      employees: employeesWithRates,
      calendars,
      suggestedPeriod,
      baseRates,
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
