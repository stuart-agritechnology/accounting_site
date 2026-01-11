// src/app/api/xero/push-timesheets/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getAuthedXeroClient, getTenantOrPickFirst } from "../../../app/_lib/xeroAuth";
import { buildTimesheetsFromPayLines } from "~/server/xero/timesheets";
import { buildLeaveApplicationsFromPayLines } from "~/server/xero/leaveApplications";
import type { PayLine } from "~/payroll_calc/types";
import type { XeroEmployee, XeroPayItem } from "~/server/xero/payrollAu";

export const runtime = "nodejs";

/* ============================
   Helpers
============================ */

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toISODateOnly(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseISODateOnly(s: string): Date {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid ISO date: ${s}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function addDaysISO(iso: string, days: number): string {
  const d = parseISODateOnly(iso);
  d.setDate(d.getDate() + days);
  return toISODateOnly(d);
}

function n(v: any, fallback = 0) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function normName(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function pickFirstNonEmpty(...vals: Array<any>) {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function firstLine(s: any, max = 900) {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function round2(x: number) {
  return Math.round(x * 100) / 100;
}

/** Stable-ish hash for idempotency keys (changes when payload changes). */
function hashLeaveApps(apps: any[]) {
  try {
    // Ensure stable ordering so the same logical payload hashes the same way
    const stable = JSON.stringify(apps ?? [], Object.keys(apps ?? {}).sort());
    return crypto.createHash("sha256").update(stable).digest("hex").slice(0, 32); // longer + safer
  } catch {
    // last resort: timestamp so we never collide
    return String(Date.now());
  }
}

/**
 * Xero Payroll AU does NOT accept leave as TimesheetLines.
 * Leave must be pushed via LeaveApplications (LeaveTypeID).
 *
 * We therefore must ensure any leave-like pay lines never reach
 * buildTimesheetsFromPayLines().
 */
function isLeaveCategory(category: any) {
  const c = String(category ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!c) return false;
  // Common leave labels from Fergus + UI
  return (
    c.includes("leave") ||
    c.includes("annual") ||
    c.includes("sick") ||
    c.includes("personal") ||
    c.includes("carer") ||
    c.includes("long service") ||
    c.includes("ls") ||
    c.includes("holiday") ||
    c.includes("public holiday")
  );
}

/* ============================
   Fetch w/ timeout
============================ */

async function fetchWithTimeout(url: string, init: RequestInit, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);

  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/* ============================
   Error extraction (robust)
============================ */

function extractXeroError(text: string, json: any) {
  const out: string[] = [];

  const push = (v: any) => {
    const s = firstLine(String(v ?? ""), 900);
    if (s && !out.includes(s)) out.push(s);
  };

  push(json?.Message);
  push(json?.Detail);
  push(json?.message);
  push(json?.detail);
  push(json?.Error?.Message);
  push(json?.Error?.Detail);

  const seen = new Set<any>();
  const walk = (v: any) => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    for (const [k, val] of Object.entries(v)) {
      const key = k.toLowerCase();
      if (
        typeof val === "string" &&
        (key.includes("message") || key.includes("detail") || key.includes("description"))
      ) {
        push(val);
      }
      if (val && typeof val === "object") walk(val);
    }
  };
  walk(json);

  const xmlMsgs = String(text || "").match(/<Message>([\s\S]*?)<\/Message>/gi);
  if (xmlMsgs?.length) {
    for (const m of xmlMsgs) {
      const inner = m.replace(/<\/?Message>/gi, "");
      push(inner);
    }
  }

  if (out.length === 0) push(text);

  const best =
    out.find((s) => !s.toLowerCase().includes("validation exception occurred")) ||
    out[0] ||
    "Xero push failed";

  const extras = out.filter((s) => s !== best).slice(0, 3);
  return extras.length ? `${best} | ${extras.join(" | ")}` : best;
}

function classifyXeroError(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes("timesheet already exists")) return { code: "TIMESHEET_EXISTS" as const };
  if (m.includes("pay run calendar")) return { code: "NO_PAY_CALENDAR" as const };
  if (m.includes("end date doesn't correspond with a pay period"))
    return { code: "BAD_PERIOD" as const };
  if (m.includes("validation exception")) return { code: "VALIDATION" as const };
  if (m.includes("aborted") || m.includes("timeout")) return { code: "TIMEOUT" as const };
  return { code: "UNKNOWN" as const };
}

/* ============================
   Types (lite, for comparison)
============================ */

type TimesheetLineLite = {
  EarningsRateID: string;
  NumberOfUnits: number[];
};

type TimesheetLite = {
  EmployeeID: string;
  StartDate: string;
  EndDate: string;
  TimesheetLines: TimesheetLineLite[];
};

/* ============================
   Xero fetchers
============================ */

async function fetchXeroEmployees(tenantId: string, xero: any) {
  const res = await xero.payrollAUApi.getEmployees(tenantId);
  const employees = (res?.body?.employees ?? []) as Array<any>;

  const byName = new Map<
    string,
    { employeeID: string; display: string; payRunCalendarID?: string }
  >();
  const byId = new Map<string, { employeeName: string; payRunCalendarID?: string }>();

  for (const e of employees) {
    const first = String(e.firstName ?? e.FirstName ?? "").trim();
    const last = String(e.lastName ?? e.LastName ?? "").trim();
    const fullDisplay = `${first} ${last}`.trim();
    const full = normName(fullDisplay);
    if (!full) continue;

    const employeeID = String(e.employeeID ?? e.EmployeeID ?? "").trim();
    if (!employeeID) continue;

    const payRunCalendarID = String(e.payRunCalendarID ?? e.PayRunCalendarID ?? "").trim();

    byName.set(full, {
      employeeID,
      display: fullDisplay,
      payRunCalendarID: payRunCalendarID || undefined,
    });

    byId.set(employeeID, {
      employeeName: fullDisplay,
      payRunCalendarID: payRunCalendarID || undefined,
    });
  }

  return { employees, byName, byId };
}

async function fetchXeroPayItems(tenantId: string, xero: any) {
  const res = await xero.payrollAUApi.getPayItems(tenantId);
  return (res?.body?.payItems ?? null) as XeroPayItem | null;
}

async function createLeaveApplicationsInXero(args: {
  accessToken: string;
  tenantId: string;
  leaveApplications: any[];
  idempotencyKey?: string;
}) {
  const { accessToken, tenantId, leaveApplications, idempotencyKey } = args;
  if (!leaveApplications.length) return { ok: true as const, status: 200, json: null, text: "" };

  const url = "https://api.xero.com/payroll.xro/1.0/LeaveApplications";
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(leaveApplications),
      cache: "no-store",
    },
    20000,
  );

  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    return { ok: false as const, status: res.status, json, text };
  }

  return { ok: true as const, status: res.status, json, text };
}

/**
 * Employee LIST sometimes doesn't include PayRunCalendarID.
 * Backfill using Employee DETAIL endpoint.
 */
async function fetchEmployeePayRunCalendarID(args: {
  accessToken: string;
  tenantId: string;
  employeeID: string;
}) {
  const { accessToken, tenantId, employeeID } = args;

  const url = `https://api.xero.com/payroll.xro/1.0/Employees/${encodeURIComponent(employeeID)}`;

  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
      },
      cache: "no-store",
    },
    10000
  );

  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) return { ok: false as const, calendarID: "", status: res.status, text };

  const emp =
    json?.Employees?.[0] ??
    json?.employees?.[0] ??
    json?.Employee ??
    json?.employee ??
    json ??
    null;

  const cal = String(
    emp?.PayRunCalendarID ??
      emp?.payRunCalendarID ??
      emp?.PayrollCalendarID ??
      emp?.payrollCalendarID ??
      ""
  ).trim();

  return { ok: true as const, calendarID: cal, status: res.status, text };
}

/* ============================
   Timesheet existence + compare
============================ */

function normalizeTimesheetForCompare(ts: TimesheetLite) {
  const lines = (ts.TimesheetLines ?? [])
    .map((l) => ({
      EarningsRateID: String(l.EarningsRateID ?? "").trim(),
      NumberOfUnits: Array.isArray(l.NumberOfUnits)
        ? l.NumberOfUnits.map((x) => round2(n(x, 0)))
        : [],
    }))
    .filter((l) => l.EarningsRateID && l.NumberOfUnits.length > 0);

  lines.sort((a, b) => a.EarningsRateID.localeCompare(b.EarningsRateID));

  return {
    EmployeeID: String(ts.EmployeeID).trim(),
    StartDate: String(ts.StartDate).trim(),
    EndDate: String(ts.EndDate).trim(),
    TimesheetLines: lines,
  };
}

function timesheetsEqual(a: TimesheetLite, b: TimesheetLite) {
  const A = normalizeTimesheetForCompare(a);
  const B = normalizeTimesheetForCompare(b);

  if (A.EmployeeID !== B.EmployeeID) return false;
  if (A.StartDate !== B.StartDate) return false;
  if (A.EndDate !== B.EndDate) return false;

  if (A.TimesheetLines.length !== B.TimesheetLines.length) return false;

  for (let i = 0; i < A.TimesheetLines.length; i++) {
    const la = A.TimesheetLines[i];
    const lb = B.TimesheetLines[i];
    if (la.EarningsRateID !== lb.EarningsRateID) return false;
    if (la.NumberOfUnits.length !== lb.NumberOfUnits.length) return false;
    for (let j = 0; j < la.NumberOfUnits.length; j++) {
      if (round2(la.NumberOfUnits[j]) !== round2(lb.NumberOfUnits[j])) return false;
    }
  }
  return true;
}

async function findExistingTimesheet(args: {
  accessToken: string;
  tenantId: string;
  employeeID: string;
  startISO: string;
  endISOInclusive: string;
}) {
  const { accessToken, tenantId, employeeID, startISO, endISOInclusive } = args;

  // Xero GET list (we’ll filter client-side for safety)
  const url = "https://api.xero.com/payroll.xro/1.0/Timesheets";

  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
      },
      cache: "no-store",
    },
    15000
  );

  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) {
    return {
      ok: false as const,
      res,
      text,
      json,
      detail: extractXeroError(text, json),
      found: null as any,
    };
  }

  const list = (json?.Timesheets ?? json?.timesheets ?? []) as any[];

  const match = list.find((t) => {
    const eid = String(t?.EmployeeID ?? t?.employeeID ?? "").trim();
    const sd = String(t?.StartDate ?? t?.startDate ?? "").trim();
    const ed = String(t?.EndDate ?? t?.endDate ?? "").trim();
    return eid === employeeID && sd === startISO && ed === endISOInclusive;
  });

  if (!match) return { ok: true as const, res, text, json, detail: "", found: null };

  const found: TimesheetLite = {
    EmployeeID: String(match?.EmployeeID ?? match?.employeeID ?? "").trim(),
    StartDate: String(match?.StartDate ?? match?.startDate ?? "").trim(),
    EndDate: String(match?.EndDate ?? match?.endDate ?? "").trim(),
    TimesheetLines: (match?.TimesheetLines ?? match?.timesheetLines ?? []).map((l: any) => ({
      EarningsRateID: String(l?.EarningsRateID ?? l?.earningsRateID ?? "").trim(),
      NumberOfUnits: Array.isArray(l?.NumberOfUnits ?? l?.numberOfUnits)
        ? (l?.NumberOfUnits ?? l?.numberOfUnits).map((x: any) => n(x, 0))
        : [],
    })),
  };

  return { ok: true as const, res, text, json, detail: "", found };
}

/* ============================
   POST Timesheet (array root)
============================ */

async function postTimesheetArrayRoot(args: {
  accessToken: string;
  tenantId: string;
  timesheet: any;
}) {
  const { accessToken, tenantId, timesheet } = args;

  const url = "https://api.xero.com/payroll.xro/1.0/Timesheets";

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify([timesheet]),
    },
    15000
  );

  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  return { res, text, json, detail: extractXeroError(text, json) };
}

/* ============================
   Route
============================ */

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const periodStartISO = String(body?.periodStartISO ?? "");
    const periodEndISOInclusive = String(body?.periodEndISOInclusive ?? "");
    const payLinesRaw = (body?.payLines ?? []) as Array<any>;

    if (!periodStartISO || !periodEndISOInclusive) {
      return NextResponse.json(
        { ok: false, error: "Missing periodStartISO / periodEndISOInclusive" },
        { status: 400 }
      );
    }

    if (!Array.isArray(payLinesRaw) || payLinesRaw.length === 0) {
      return NextResponse.json({ ok: false, error: "No payLines provided" }, { status: 400 });
    }

    // Normalize to PayLine[] (engine expects these keys)
    const payLines: PayLine[] = payLinesRaw
      .map((l) => ({
        employeeName: String(l?.employeeName ?? "").trim(),
        jobCode: String(l?.jobCode ?? "").trim(),
        // Accept either our canonical `date` field, or legacy/provider `dateISO`.
        date: String(l?.date ?? l?.dateISO ?? "").trim(),
        category: String(l?.category ?? "").trim(),
        minutes: n(l?.minutes, 0),
        hours: Number.isFinite(n(l?.hours, NaN)) ? n(l?.hours, 0) : n(l?.minutes, 0) / 60,
        multiplier: n(l?.multiplier, 1),
        employeeId: l?.employeeId ? String(l.employeeId) : undefined,
        baseRate: Number.isFinite(n(l?.baseRate, NaN)) ? n(l?.baseRate, 0) : undefined,
        cost: Number.isFinite(n(l?.cost, NaN)) ? n(l?.cost, 0) : undefined,
        // IMPORTANT: PayLine type doesn't include isLeave, but our UI/provider does.
        // Preserve it for LeaveApplications builder and for filtering out of Timesheets.
        ...(typeof (l as any)?.isLeave === "boolean" ? { isLeave: Boolean((l as any).isLeave) } : {}),
      }))
      .filter((l) => l.employeeName && l.date && l.category && Number.isFinite(l.hours) && l.hours > 0);

    if (payLines.length === 0) {
      return NextResponse.json(
        { ok: false, error: "payLines had no usable rows (need employeeName/date/category/hours)" },
        { status: 400 }
      );
    }

    const xero = await getAuthedXeroClient();
const { tenantId } = await getTenantOrPickFirst(xero);

const tokenSet = (xero as any).readTokenSet?.() ?? null;
const accessToken = (tokenSet?.access_token ?? tokenSet?.accessToken ?? "") as string;


    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: "Missing Xero access token (try reconnecting)" },
        { status: 401 }
      );
    }

    const { employees: employeesRaw, byId } = await fetchXeroEmployees(tenantId, xero);
    const payItems = await fetchXeroPayItems(tenantId, xero);

    if (
      !payItems ||
      !Array.isArray((payItems as any)?.earningsRates) ||
      (payItems as any).earningsRates.length === 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No Earnings Rates found in Xero Payroll. Create earnings rates (e.g. Ordinary Hours, Overtime) then retry.",
        },
        { status: 400 }
      );
    }

    // Map the SDK employee shape into the XeroEmployee shape used by the builder.
    // (The builder only needs: EmployeeID, FirstName, LastName, Status, OrdinaryEarningsRateID)
    const xeroEmployees: XeroEmployee[] = (employeesRaw ?? []).map((e: any) => ({
      EmployeeID: String(e.EmployeeID ?? e.employeeID ?? "").trim() || undefined,
      FirstName: String(e.FirstName ?? e.firstName ?? "").trim() || undefined,
      LastName: String(e.LastName ?? e.lastName ?? "").trim() || undefined,
      Status: String(e.Status ?? e.status ?? "").trim() || undefined,
      OrdinaryEarningsRateID:
        String(e.OrdinaryEarningsRateID ?? e.ordinaryEarningsRateID ?? "").trim() || undefined,
    }));

    // ✅ Split leave vs non-leave BEFORE building exports.
    // Leave MUST NOT go to Timesheets (Xero will reject the whole payload).
    const leavePayLines = (payLines as any[]).filter(
      (l) => Boolean(l?.isLeave) || isLeaveCategory(l?.category),
    );
    // Ensure leave lines are explicitly marked for the LeaveApplications builder.
    for (const l of leavePayLines) l.isLeave = true;

    const timesheetPayLines = (payLines as any[]).filter(
      (l) => !(Boolean(l?.isLeave) || isLeaveCategory(l?.category)),
    ) as PayLine[];

    // ✅ Build timesheets from NON-LEAVE lines only.
    const built = buildTimesheetsFromPayLines({
      payLines: timesheetPayLines,
      periodStartISO,
      periodEndISOInclusive,
      xeroEmployees,
      payItems,
    });

    // ✅ Build LeaveApplications (leave cannot be sent as TimesheetLines).
    const employeeNameToId = new Map<string, string>();
    for (const [id, meta] of byId.entries()) {
      const k = normName(meta.employeeName || "");
      if (k && id) employeeNameToId.set(k, id);
    }

    const leaveBuilt = buildLeaveApplicationsFromPayLines({
      payLines: leavePayLines as any,
      employeeNameToId,
      payItems,
      periodStartISO,
      periodEndISOInclusive,
    });

    const leavePush = await createLeaveApplicationsInXero({
      accessToken,
      tenantId,
      leaveApplications: leaveBuilt.leaveApplications,
      idempotencyKey: `leave-v3-${periodStartISO}-${periodEndISOInclusive}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`,
    });

    if (!leavePush.ok) {
      const err = extractXeroError(leavePush.text, leavePush.json);
      return NextResponse.json(
        {
          ok: false,
          error: `Xero leave push failed: ${err}`,
          leaveWarnings: leaveBuilt.warnings,
        },
        { status: 400 },
      );
    }

    const desiredTimesheets = built.timesheets;

    let created = 0;
    const leaveCreated = leaveBuilt.leaveApplications.length;
    let skippedMatch = 0;
    let skippedDiff = 0;

    const results: Array<{
      employeeName: string;
      employeeID?: string;
      status: "CREATED" | "EXISTS_MATCH" | "EXISTS_DIFF" | "MISSING_EMPLOYEE" | "ERROR";
      note?: string;
      payload?: any;
    }> = [];

    for (const desired of desiredTimesheets) {
      const employeeID = String(desired.EmployeeID ?? "").trim();
      if (!employeeID) continue;

      const empMeta = byId.get(employeeID);
      const employeeName = empMeta?.employeeName ?? employeeID;

      // Backfill payrun calendar if missing
      if (!empMeta?.payRunCalendarID) {
        const det = await fetchEmployeePayRunCalendarID({
          accessToken,
          tenantId,
          employeeID,
        });

        if (det.ok && det.calendarID) {
          byId.set(employeeID, {
            employeeName,
            payRunCalendarID: det.calendarID,
          });
        } else {
          results.push({
            employeeName,
            employeeID,
            status: "ERROR",
            note: "Xero: Employee appears to have no Pay Run Calendar assigned (or API did not return it).",
          });
          continue;
        }
      }

      const desiredLite: TimesheetLite = {
        EmployeeID: employeeID,
        StartDate: desired.StartDate,
        EndDate: desired.EndDate,
        TimesheetLines: (desired.TimesheetLines ?? []).map((l) => ({
          EarningsRateID: String(l.EarningsRateID ?? "").trim(),
          NumberOfUnits: Array.isArray(l.NumberOfUnits)
            ? l.NumberOfUnits.map((x) => round2(n(x, 0)))
            : [],
        })),
      };

      // ✅ First: check if it already exists
      const existing = await findExistingTimesheet({
        accessToken,
        tenantId,
        employeeID: desiredLite.EmployeeID,
        startISO: desiredLite.StartDate,
        endISOInclusive: desiredLite.EndDate,
      });

      if (!existing.ok) {
        results.push({
          employeeName,
          employeeID,
          status: "ERROR",
          note: `Failed checking existing timesheets: ${firstLine(existing.detail)}`,
        });
        continue;
      }

      if (existing.found) {
        const same = timesheetsEqual(existing.found, desiredLite);

        if (same) {
          skippedMatch++;
          results.push({
            employeeName,
            employeeID,
            status: "EXISTS_MATCH",
            note: "Exists in Xero and matches.",
          });
          continue;
        } else {
          skippedDiff++;
          results.push({
            employeeName,
            employeeID,
            status: "EXISTS_DIFF",
            note: "Exists in Xero but differs (skipped).",
            payload: {
              desired: normalizeTimesheetForCompare(desiredLite),
              existing: normalizeTimesheetForCompare(existing.found),
            },
          });
          continue;
        }
      }

      // ✅ Only POST if it does NOT exist
      const payload = {
        EmployeeID: desiredLite.EmployeeID,
        StartDate: desiredLite.StartDate,
        EndDate: desiredLite.EndDate,
        TimesheetLines: desiredLite.TimesheetLines.map((l) => ({
          EarningsRateID: l.EarningsRateID,
          NumberOfUnits: l.NumberOfUnits,
        })),
      };

      const r = await postTimesheetArrayRoot({ accessToken, tenantId, timesheet: payload });

      if (!r.res.ok) {
        const detail = r.detail;
        const cls = classifyXeroError(detail);

        results.push({
          employeeName,
          employeeID,
          status: "ERROR",
          note: `Xero: ${firstLine(detail)}`,
          payload: {
            code: cls.code,
            EmployeeID: payload.EmployeeID,
            StartDate: payload.StartDate,
            EndDate: payload.EndDate,
            lines: payload.TimesheetLines?.length ?? 0,
          },
        });
        continue;
      }

      created++;
      results.push({
        employeeName,
        employeeID,
        status: "CREATED",
        note: "Created in Xero.",
      });
    }

    return NextResponse.json(
      {
        ok: true,
        leave: {
          created: leaveCreated,
          warnings: leaveBuilt.warnings,
        },
        created,
        skipped: {
          match: skippedMatch,
          diff: skippedDiff,
        },
        warnings: {
          missingEmployees: built.warnings.missingEmployees,
          missingCategories: built.warnings.missingCategories,
        },
        meta: {
          StartDate: periodStartISO,
          EndDate: built.endISOInclusive,
          periodDaysCount: built.dayCount,
        },
        results,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error("XERO PUSH ERROR:", e);
    return NextResponse.json(
      { ok: false, error: `Server exception: ${msg}` },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
