// src/app/api/xero/last-paid-date/route.ts
import { NextResponse } from "next/server";
import { xeroFetch } from "~/app/app/_lib/xeroApi";

export const runtime = "nodejs";

/**
 * Xero dates can come in:
 * - "YYYY-MM-DD"
 * - "YYYY-MM-DDTHH:mm:ss..."
 * - "/Date(1768435200000+0000)/"
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

function parseISODateLocal(iso: string): Date | null {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function isValidISODateOnly(iso: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? ""));
}

/**
 * JS: Sunday=0 ... Saturday=6
 */
function dowLocal(iso: string): number | null {
  const d = parseISODateLocal(iso);
  if (!d) return null;
  return d.getDay();
}

function normCycle(cycle: string): "weekly" | "fortnightly" | "monthly" | "" {
  const c = String(cycle ?? "").toLowerCase().trim();
  if (c === "weekly") return "weekly";
  if (c === "fortnightly") return "fortnightly";
  if (c === "monthly") return "monthly";
  return "";
}

/**
 * Xero CalendarType values vary but are typically: Weekly / Fortnightly / FourWeekly / Monthly etc.
 * We'll match loosely.
 */
function matchesCycle(calendarType: string, desired: "weekly" | "fortnightly" | "monthly" | ""): boolean {
  const t = String(calendarType ?? "").toLowerCase();
  if (!desired) return true;

  if (desired === "weekly") return t.includes("week") && !t.includes("fortnight") && !t.includes("four");
  if (desired === "fortnightly") return t.includes("fortnight") || t.includes("two") || t.includes("bi");
  if (desired === "monthly") return t.includes("month");

  return false;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // Optional selectors (recommended)
    const desiredCycle = normCycle(url.searchParams.get("cycle") ?? "");
    const desiredWeekStartDow = Number(url.searchParams.get("weekStartDow") ?? "");
    const hasDesiredWeekStartDow = Number.isFinite(desiredWeekStartDow) && desiredWeekStartDow >= 0 && desiredWeekStartDow <= 6;

    // Fetch payroll calendars (pay frequencies)
    const cj = await xeroFetch("https://api.xero.com/payroll.xro/1.0/PayrollCalendars");
    let calendars = (cj?.payrollCalendars ?? cj?.PayrollCalendars ?? []) as any[];
    if (!Array.isArray(calendars)) calendars = [];

    // Map + score each calendar
    const candidates = calendars
      .map((c) => {
        const name = String(c?.name ?? c?.Name ?? "");
        const calendarType = String(c?.calendarType ?? c?.CalendarType ?? "");
        const startISO = xeroDateToISODateOnly(c?.startDate ?? c?.StartDate);
        const payISO = xeroDateToISODateOnly(c?.paymentDate ?? c?.PaymentDate);
        const startDow = startISO ? dowLocal(startISO) : null;

        let score = 0;

        // 1) Match cycle (weekly/fortnightly/monthly)
        if (matchesCycle(calendarType, desiredCycle)) score += 50;

        // 2) If weekly and we know weekStartDow, match that too
        if (desiredCycle === "weekly" && hasDesiredWeekStartDow && startDow !== null) {
          if (startDow === desiredWeekStartDow) score += 40;
          else score -= 40;
        }

        // 3) Also check name hints (helps when Xero's CalendarType is weird)
        const n = name.toLowerCase();
        if (desiredCycle === "weekly" && n.includes("weekly")) score += 10;
        if (desiredCycle === "fortnightly" && (n.includes("fortnight") || n.includes("biweek"))) score += 10;
        if (desiredCycle === "monthly" && n.includes("monthly")) score += 10;

        // If we have a start date at all, prefer it
        if (startISO) score += 3;

        return { c, name, calendarType, startISO, payISO, startDow, score };
      })
      .filter((x) => x.startISO || x.payISO);

    if (candidates.length === 0) {
      return NextResponse.json({ ok: false, error: "No Payroll Calendars returned from Xero." }, { status: 500 });
    }

    // Choose highest score; tie-breaker: earliest upcoming payment date, else earliest start date
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      const ap = a.payISO && isValidISODateOnly(a.payISO) ? parseISODateLocal(a.payISO)?.getTime() ?? 0 : 0;
      const bp = b.payISO && isValidISODateOnly(b.payISO) ? parseISODateLocal(b.payISO)?.getTime() ?? 0 : 0;

      if (ap && bp) return ap - bp;
      if (ap && !bp) return -1;
      if (!ap && bp) return 1;

      const as = a.startISO && isValidISODateOnly(a.startISO) ? parseISODateLocal(a.startISO)?.getTime() ?? 0 : 0;
      const bs = b.startISO && isValidISODateOnly(b.startISO) ? parseISODateLocal(b.startISO)?.getTime() ?? 0 : 0;
      return as - bs;
    });

    const chosen = candidates[0];

    return NextResponse.json({
      ok: true,
      nextPeriodStartISO: isValidISODateOnly(chosen.startISO) ? chosen.startISO : "",
      nextPayDayISO: isValidISODateOnly(chosen.payISO) ? chosen.payISO : "",
      source: {
        type: "PAYROLL_CALENDAR",
        payrollCalendarID: String(chosen.c?.payrollCalendarID ?? chosen.c?.PayrollCalendarID ?? ""),
        name: chosen.name,
        calendarType: chosen.calendarType,
        startDate: isValidISODateOnly(chosen.startISO) ? chosen.startISO : "",
        paymentDate: isValidISODateOnly(chosen.payISO) ? chosen.payISO : "",
        score: chosen.score,
        matchedUsing: {
          desiredCycle,
          desiredWeekStartDow: hasDesiredWeekStartDow ? desiredWeekStartDow : null,
        },
      },

      // Optional: include a short list for debugging in dev (safe)
      debugTop: candidates.slice(0, 5).map((x) => ({
        payrollCalendarID: String(x.c?.payrollCalendarID ?? x.c?.PayrollCalendarID ?? ""),
        name: x.name,
        calendarType: x.calendarType,
        startDate: x.startISO,
        paymentDate: x.payISO,
        startDow: x.startDow,
        score: x.score,
      })),
    });
  } catch (e: any) {
    const detail =
      e?.message ||
      e?.response?.body?.Detail ||
      e?.response?.body?.detail ||
      e?.response?.body?.message ||
      "Failed to load Xero payroll calendar";

    return NextResponse.json({ ok: false, error: String(detail) }, { status: 500 });
  }
}
