"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CompanyRuleset, PayLine, TimeEntry } from "~/payroll_calc/types";
import { computePayLinesV1 } from "~/payroll_calc/engine_demo";
import { getCurrentRuleset } from "~/payroll_calc/runtimeRules";
import { loadActivePayPeriod, loadPayrunSettings, saveActivePayPeriod } from "./_lib/payPeriod";

/**
 * Keys
 * - DO NOT overwrite xero_employees_v1 (owned by your Xero sync UI)
 */
const LS_XERO_EMPLOYEES = "xero_employees_v1";
const LS_EMPLOYEES = "employees_v1";
const LS_RAW_TIME = "raw_time_entries_v1";
const LS_COMPUTED = "computed_pay_lines_v1";
const LS_LAST_APPLIED = "payroll_last_applied_at_v1";
const LS_OLD_BLOB = "payroll_live_state_v1";
const API_EMPLOYEE_SETTINGS = "/api/payroll/employees";

/**
 * Types
 */
export type Employee = {
  id: string;
  name: string;
  baseRate: number; // $/hour
  xeroEmployeeId?: string;
  xeroEmployeeNumber?: string;
  status?: string;
  // Office/salaried staff: no Fergus timesheets required
  noTimesheets?: boolean;
  // Weekly contracted hours (e.g. 38/40) pulled from Xero, stored in DB for overrides
  weeklyHours?: number | null;
};

export type ActivePeriod = {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
};

export type ComputedPayLine = PayLine & {
  employeeId: string;
  employeeName: string;
  baseRate: number;
  cost: number;
  jobCode?: string;
  dateISO?: string;
};

type Summary = {
  totalMinutes: number;
  totalCost: number;
  lineCount: number;
};

type PayrollState = {
  // legacy aliases
  timeEntries: TimeEntry[];
  payLines: PayLine[];
  hasImported: boolean;

  employees: Employee[];
  rawTimeEntries: TimeEntry[];
  computedPayLines: ComputedPayLine[];
  activePeriod: ActivePeriod | null;
  summary: Summary;
  lastAppliedAt: string | null;

  setEmployees: (employees: Employee[]) => void;
  upsertEmployee: (emp: Employee) => void;

  setRawTimeEntries: (entries: TimeEntry[]) => void;
  clearComputed: () => void;

  setActivePeriod: (p: ActivePeriod | null) => void;

  importCsvFile: (file: File) => Promise<void>;
  clearAll: () => void;
  applyRules: (ruleset?: CompanyRuleset) => Promise<void>;

  // ✅ Sync (Fergus + Xero)
  syncing: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncNow: (opts?: { autoApplyRules?: boolean; silent?: boolean }) => Promise<{
    ok: boolean;
    pulledFergus?: number;
    syncedXero?: number;
    error?: string;
  }>;
};

const PayrollDataContext = createContext<PayrollState | null>(null);

/**
 * Helpers
 */
function n(v: unknown, fallback = 0): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function isFergusLeaveEntry(e: any): { ok: boolean; leaveType: string } {
  // Fergus usually provides leave via `unchargedTimeType` (e.g. "Annual Leave").
  // But depending on how we store/import entries, we may only retain `entryType` / `category`.
  const candidates = [e?.unchargedTimeType, e?.entryType, e?.leaveType, e?.timeType, e?.category]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);

  const t = candidates[0] ?? "";
  if (!t) return { ok: false, leaveType: "" };

  const k = t.toLowerCase();
  const looksLikeLeave =
    k.includes("leave") ||
    k.includes("annual") ||
    k.includes("sick") ||
    k.includes("personal") ||
    k.includes("carer") ||
    k.includes("long service") ||
    k.includes("lsl") ||
    k.includes("public holiday") ||
    k.includes("holiday");

  return { ok: looksLikeLeave, leaveType: t };
}

function normalizeName(name: string) {
  // Normalize for matching across Xero/Fergus variations:
  // - trims + lowercases
  // - collapses whitespace
  // - converts "Last, First" -> "First Last"
  // - strips most punctuation
  const raw = String(name ?? "").trim();
  if (!raw) return "";
  const swapped = raw.includes(",")
    ? raw
        .split(",")
        .map((s) => s.trim())
        .reverse()
        .filter(Boolean)
        .join(" ")
    : raw;

  return swapped
    .toLowerCase()
    .replace(/[\u2019']/g, "") // apostrophes
    .replace(/[^a-z0-9\s-]/g, " ") // punctuation -> space
    .replace(/\s+/g, " ")
    .trim();
}

function nameParts(norm: string): { first: string; last: string } {
  const parts = String(norm ?? "").trim().split(" ").filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts[parts.length - 1] };
}

function entryBelongsToEmployee(e: any, emp: { xeroEmployeeId?: string; id: string; name: string }) {
  const xeroId = String(emp.xeroEmployeeId ?? emp.id ?? "").trim();
  const eid = String(detectEmployeeId(e) ?? "").trim();
  if (xeroId && eid && eid === xeroId) return true;

  const en = normalizeName(String(detectEmployeeName(e) ?? ""));
  const kn = normalizeName(String(emp.name ?? ""));
  if (kn && en && en === kn) return true;

  // Fuzzy match: same last name and first initial/prefix
  const a = nameParts(en);
  const b = nameParts(kn);
  if (a.last && b.last && a.last === b.last) {
    const ai = a.first.slice(0, 1);
    const bi = b.first.slice(0, 1);
    if (ai && bi && ai === bi) return true;
    if (a.first && b.first && (a.first.startsWith(b.first) || b.first.startsWith(a.first))) return true;
  }
  return false;
}

function withinInclusive(dateISO: string, startISO: string, endISO: string) {
  return dateISO >= startISO && dateISO <= endISO;
}

function entryDateISO(e: any): string | null {
  const candidates = [
    e?.date,
    e?.day, // ✅ Fergus CSV uses "day"
    e?.dateISO,
    e?.workDate,
    e?.startDate,
    e?.start_date,
    e?.start,
    e?.startedAt,
    e?.started_at,
    e?.startTime,
    e?.start_time,
  ].filter(Boolean);

  for (const c of candidates) {
    if (typeof c === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(c)) return c;
      const m = c.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m?.[1]) return m[1];
    }
    if (c instanceof Date && !Number.isNaN(c.getTime())) {
      return c.toISOString().slice(0, 10);
    }
  }
  return null;
}

/**
 * ✅ FIX: Minutes calculation supports:
 * - explicit minutes
 * - explicit hours
 * - start/end full ISO timestamps
 * - OR Fergus CSV style: day="YYYY-MM-DD" + start/end="HH:MM"
 */
function entryMinutes(e: any): number {
  if (Number.isFinite(n(e?.minutes, NaN))) return Math.max(0, n(e?.minutes, 0));
  // If hours is 0, still try to fall back to start/end (leave often comes through like this)
  const h = Number.isFinite(n(e?.hours, NaN)) ? n(e?.hours, 0) : NaN;
  if (Number.isFinite(h) && h > 0) return Math.max(0, Math.round(h * 60));

  const day = entryDateISO(e);
  const s = e?.start ?? e?.startTime ?? e?.start_time ?? e?.startedAt ?? e?.started_at;
  const t = e?.end ?? e?.endTime ?? e?.end_time ?? e?.endedAt ?? e?.ended_at;

  // Case A: full timestamps
  if (typeof s === "string" && typeof t === "string") {
    const ds = new Date(s);
    const dt = new Date(t);
    if (!Number.isNaN(ds.getTime()) && !Number.isNaN(dt.getTime())) {
      const mins = (dt.getTime() - ds.getTime()) / 60000;
      return mins > 0 ? mins : 0;
    }
  }

  // Case B: Fergus CSV style HH:MM with separate day
  if (day && typeof s === "string" && typeof t === "string") {
    const hhmm = (x: string) => /^\d{2}:\d{2}$/.test(x);
    if (hhmm(s) && hhmm(t)) {
      const ds = new Date(`${day}T${s}:00`);
      const dt = new Date(`${day}T${t}:00`);
      if (!Number.isNaN(ds.getTime()) && !Number.isNaN(dt.getTime())) {
        let mins = (dt.getTime() - ds.getTime()) / 60000;
        if (mins < 0) mins += 24 * 60; // overnight
        return mins > 0 ? mins : 0;
      }
    }
  }

  return 0;
}

function detectEmployeeName(e: any): string {
  const v =
    e?.employeeName ??
    e?.staffName ??
    e?.userName ??
    e?.employee ??
    e?.staff ??
    e?.user ??
    "";

  if (typeof v === "string") return v;

  // Fergus sometimes returns nested objects like { name, firstName, lastName }
  if (v && typeof v === "object") {
    const name = (v as any).name ?? (v as any).fullName;
    if (typeof name === "string") return name;

    const first = String((v as any).firstName ?? "").trim();
    const last = String((v as any).lastName ?? "").trim();
    const combo = `${first} ${last}`.trim();
    return combo || "";
  }

  return "";
}

function detectEmployeeId(e: any): string | null {
  // We store / enrich entries with different ID shapes across Fergus/Xero/DB.
  // If we miss the Xero employee id here, salary staff can incorrectly look like
  // they have "no timesheets", causing synthetic weekly hours to be added on top.
  return (
    e?.xeroEmployeeId ??
    e?.employeeXeroId ??
    e?.xeroId ??
    e?.employeeId ??
    e?.employeeID ??
    e?.staffId ??
    e?.staffID ??
    e?.userId ??
    e?.userID ??
    null
  );
}

function detectJobCode(e: any): string | undefined {
  return e?.jobCode ?? e?.job ?? e?.job_id ?? e?.jobId ?? e?.siteCode ?? e?.site ?? undefined;
}

/**
 * engine_demo expects startISO/endISO.
 * Fergus can provide:
 *  - full timestamps (startedAt/endedAt, start/end as ISO)
 *  - OR day (YYYY-MM-DD) + start/end (HH:MM)
 */
function buildStartEndISO(e: any): { startISO?: string; endISO?: string } {
  const s = e?.startISO ?? e?.startedAt ?? e?.started_at ?? e?.startTime ?? e?.start_time ?? e?.start;
  const t = e?.endISO ?? e?.endedAt ?? e?.ended_at ?? e?.endTime ?? e?.end_time ?? e?.end;

  // Case A: already ISO timestamps
  if (typeof s === "string" && typeof t === "string") {
    const ds = new Date(s);
    const dt = new Date(t);
    if (!Number.isNaN(ds.getTime()) && !Number.isNaN(dt.getTime())) {
      return { startISO: ds.toISOString(), endISO: dt.toISOString() };
    }
  }

  // Case B: day + HH:MM
  const day = entryDateISO(e);
  if (day && typeof s === "string" && typeof t === "string") {
    const hhmm = (x: string) => /^\d{2}:\d{2}$/.test(x);
    if (hhmm(s) && hhmm(t)) {
      const ds = new Date(`${day}T${s}:00`);
      let dt = new Date(`${day}T${t}:00`);
      if (!Number.isNaN(ds.getTime()) && !Number.isNaN(dt.getTime())) {
        // Overnight shift
        if (dt.getTime() < ds.getTime()) dt = new Date(dt.getTime() + 24 * 60 * 60 * 1000);
        return { startISO: ds.toISOString(), endISO: dt.toISOString() };
      }
    }
  }

  return {};
}

/**
 * CSV parser
 * ✅ FIX: supports baseRate column from Fergus CSV
 */
async function parseCsvFile(file: File): Promise<TimeEntry[]> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0]!.split(",").map((h) => h.trim());
  const rows = lines.slice(1);

  const idx = (names: string[]) => {
    const lower = header.map((h) => h.toLowerCase());
    for (const nm of names) {
      const i = lower.indexOf(nm.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };

  const iEmployee = idx(["employee", "employeeName", "staff", "staffName", "name"]);
  const iXeroEmployeeId = idx(["xeroEmployeeId", "xero_employee_id", "xeroEmployeeID", "xero_employeeID"]);
  const iJob = idx(["job", "jobCode", "job_code", "site", "siteCode"]);
  const iDate = idx(["date", "day", "workDate"]);
  const iStart = idx(["start", "startTime", "start_time"]);
  const iEnd = idx(["end", "endTime", "end_time"]);
  const iMinutes = idx(["minutes"]);
  const iHours = idx(["hours"]);
  const iBaseRate = idx(["baseRate", "base_rate", "rate", "payRate", "pay_rate"]);
  // Fergus leave often arrives as a "type" field (e.g. Annual Leave) rather than job/category.
  const iEntryType = idx(["entryType", "entry_type", "type", "source", "timeType", "leaveType"]);

  const out: any[] = [];

  for (const r of rows) {
    const cols = r.split(",").map((c) => c.trim());
    if (cols.length === 0) continue;

    const employeeName = iEmployee >= 0 ? cols[iEmployee] : "";
    const xeroEmployeeId = iXeroEmployeeId >= 0 ? cols[iXeroEmployeeId] : "";
    const jobCode = iJob >= 0 ? cols[iJob] : undefined;
    const date = iDate >= 0 ? cols[iDate] : "";

    const entryTypeRaw = iEntryType >= 0 ? cols[iEntryType] || "" : "";

    const start = iStart >= 0 ? cols[iStart] : "";
    const end = iEnd >= 0 ? cols[iEnd] : "";

    const minutes =
      iMinutes >= 0 ? n(cols[iMinutes], 0) : iHours >= 0 ? Math.round(n(cols[iHours], 0) * 60) : 0;

    const baseRate = iBaseRate >= 0 ? n(cols[iBaseRate], 0) : 0;

    // Provide fields the engine expects: day + startISO/endISO.
    const dayISO = date; // Fergus uses YYYY-MM-DD
    const startISO = dayISO && start ? new Date(`${dayISO}T${start}:00`).toISOString() : undefined;
    let endISO = dayISO && end ? new Date(`${dayISO}T${end}:00`).toISOString() : undefined;
    if (startISO && endISO) {
      const ds = new Date(startISO);
      let de = new Date(endISO);
      if (!Number.isNaN(ds.getTime()) && !Number.isNaN(de.getTime()) && de.getTime() < ds.getTime()) {
        // overnight
        de = new Date(de.getTime() + 24 * 60 * 60 * 1000);
        endISO = de.toISOString();
      }
    }

    out.push({
      employeeName,
      xeroEmployeeId: xeroEmployeeId || undefined,
      jobCode,
      entryType: entryTypeRaw || undefined,
      day: dayISO,
      date: dayISO,
      start,
      end,
      startISO,
      endISO,
      minutes,
      baseRate,
    });
  }

  return out as TimeEntry[];
}

/**
 * Provider
 */
export function PayrollDataProvider({ children }: { children: React.ReactNode }) {
  const [employees, setEmployeesState] = useState<Employee[]>([]);
  const [rawTimeEntries, setRawTimeEntriesState] = useState<TimeEntry[]>([]);
  const [computedPayLines, setComputedPayLinesState] = useState<ComputedPayLine[]>([]);
  const [activePeriod, setActivePeriodState] = useState<ActivePeriod | null>(null);
  const [lastAppliedAt, setLastAppliedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);

  useEffect(() => {
    try {
      // load app employees (owned by provider)
      const appEmpRaw = localStorage.getItem(LS_EMPLOYEES);
      if (appEmpRaw) {
        const parsed = JSON.parse(appEmpRaw);
        if (Array.isArray(parsed)) setEmployeesState(parsed);
      } else {
        // fallback: normalize from Xero cache (read-only)
        const xeroRaw = localStorage.getItem(LS_XERO_EMPLOYEES);
        if (xeroRaw) {
          const parsed = JSON.parse(xeroRaw);
          if (Array.isArray(parsed)) {
            const normalized: Employee[] = parsed.map((e: any, i: number) => ({
              id: String(e?.id ?? e?.employeeID ?? e?.employeeId ?? `emp_${i + 1}`),
              name: String(e?.name ?? e?.fullName ?? `${e?.firstName ?? ""} ${e?.lastName ?? ""}`.trim()),
              baseRate: n(e?.baseRate ?? e?.BaseRate ?? e?.ratePerUnit ?? e?.RatePerUnit, 0),
              xeroEmployeeId: e?.xeroEmployeeId ?? e?.employeeID ?? e?.employeeId ?? undefined,
              xeroEmployeeNumber: e?.xeroEmployeeNumber ?? e?.employeeNumber ?? undefined,
              status: e?.status ?? undefined,
              noTimesheets: Boolean(e?.noTimesheets ?? e?.NoTimesheets ?? false),
              weeklyHours: typeof e?.weeklyHours === "number" ? e.weeklyHours : null,
            }));
            setEmployeesState(normalized.filter((x) => x.name));
          }
        }
      }

      const rawRaw = localStorage.getItem(LS_RAW_TIME);
      if (rawRaw) {
        const parsed = JSON.parse(rawRaw);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter((e: any) => String(e?.source ?? "") !== "auto_no_timesheets");
          setRawTimeEntriesState(cleaned);
        }
      }

      const compRaw = localStorage.getItem(LS_COMPUTED);
      if (compRaw) {
        const parsed = JSON.parse(compRaw);
        if (Array.isArray(parsed)) setComputedPayLinesState(parsed);
      }

      // period (support both shapes)
      const p = loadActivePayPeriod() as any;
      const start = p?.startISO ?? p?.start;
      const end = p?.endISO ?? p?.end;
      if (start && end) setActivePeriodState({ start, end });

      const la = localStorage.getItem(LS_LAST_APPLIED);
      if (la) setLastAppliedAt(la);

      // migrate old blob
      const old = localStorage.getItem(LS_OLD_BLOB);
      if (old) {
        const parsed = JSON.parse(old);

        if (!rawRaw && parsed?.timeEntries && Array.isArray(parsed.timeEntries)) {
          const cleaned = parsed.timeEntries.filter((e: any) => String(e?.source ?? "") !== "auto_no_timesheets");
          setRawTimeEntriesState(cleaned);
          localStorage.setItem(LS_RAW_TIME, JSON.stringify(cleaned));
        }

        if (!compRaw && parsed?.payLines && Array.isArray(parsed.payLines)) {
          setComputedPayLinesState(parsed.payLines);
          localStorage.setItem(LS_COMPUTED, JSON.stringify(parsed.payLines));
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // ✅ Load persisted employee settings from DB (noTimesheets, weeklyHours, baseRate)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(API_EMPLOYEE_SETTINGS, { method: "GET" });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok || !Array.isArray(j?.employees)) return;

        const rows = j.employees as any[];
        if (cancelled) return;

        setEmployeesState((prev) => {
          const byKey = new Map<string, Employee>();
          for (const e of prev) {
            const k = String((e as any).xeroEmployeeId ?? e.id ?? "").trim();
            if (k) byKey.set(k, e);
          }

          const out: Employee[] = prev.slice();

          for (const r of rows) {
            const xeroEmployeeId = String(r?.xeroEmployeeId ?? "").trim();
            if (!xeroEmployeeId) continue;

            const existing = byKey.get(xeroEmployeeId);
            const merged: Employee = {
              ...(existing ?? {
                id: xeroEmployeeId,
                name: String(r?.fullName ?? "Unnamed"),
                baseRate: Number(r?.baseRate ?? 0) || 0,
                xeroEmployeeId,
              }),
              name: existing?.name ?? String(r?.fullName ?? "Unnamed"),
              baseRate: Number(r?.baseRate ?? existing?.baseRate ?? 0) || 0,
              noTimesheets: Boolean(r?.noTimesheets ?? existing?.noTimesheets ?? false),
              weeklyHours: typeof r?.weeklyHours === "number" ? r.weeklyHours : existing?.weeklyHours ?? null,
            };

            if (existing) {
              const idx = out.findIndex((x) => String((x as any).xeroEmployeeId ?? x.id) === xeroEmployeeId);
              if (idx >= 0) out[idx] = merged;
            } else {
              out.push(merged);
            }
          }

          return out;
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_EMPLOYEES, JSON.stringify(employees));
    } catch {}
  }, [employees]);

  useEffect(() => {
    try {
      localStorage.setItem(
          LS_RAW_TIME,
          JSON.stringify((rawTimeEntries ?? []).filter((e: any) => String((e as any)?.source ?? "") !== "auto_no_timesheets"))
        );
    } catch {}
  }, [rawTimeEntries]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_COMPUTED, JSON.stringify(computedPayLines));
    } catch {}
  }, [computedPayLines]);

  /**
   * ✅ FIX: saveActivePayPeriod expects an object (startISO/endISO/cycle/computedAtISO).
   * The old code was calling saveActivePayPeriod(start, end) which corrupts localStorage,
   * making the app "forget" the pay period and causing weird/doubled payruns.
   */
  useEffect(() => {
    try {
      if (!activePeriod) return;

      const existing = loadActivePayPeriod() as any;
      const settings = loadPayrunSettings() as any;
      const cycle = (existing?.cycle ?? settings?.cycle ?? "weekly") as any;

      saveActivePayPeriod({
        startISO: activePeriod.start,
        endISO: activePeriod.end,
        cycle,
        computedAtISO: new Date().toISOString(),
      } as any);
    } catch {}
  }, [activePeriod]);

  const employeesById = useMemo(() => {
    const m = new Map<string, Employee>();
    for (const e of employees) m.set(String(e.id), e);
    return m;
  }, [employees]);

  const employeesByName = useMemo(() => {
    const m = new Map<string, Employee>();
    for (const e of employees) m.set(normalizeName(e.name), e);
    return m;
  }, [employees]);

  const summary: Summary = useMemo(() => {
    const totalMinutes = computedPayLines.reduce((a, l: any) => {
      if (l?.isLeave) return a;
      return a + n(l?.minutes, 0);
    }, 0);
    const totalCost = computedPayLines.reduce((a, l: any) => {
      if (l?.isLeave) return a;
      return a + n(l?.cost, 0);
    }, 0);
    return { totalMinutes, totalCost, lineCount: computedPayLines.length };
  }, [computedPayLines]);

  const setEmployees = (next: Employee[]) => setEmployeesState(next);

  const upsertEmployee = (emp: Employee) => {
    setEmployeesState((prev) => {
      const idx = prev.findIndex((p) => String(p.id) === String(emp.id));
      if (idx >= 0) {
        const copy = prev.slice();
        copy[idx] = emp;
        return copy;
      }
      return [...prev, emp];
    });

    // ✅ Persist to DB so employee settings survive restarts
    const xeroEmployeeId = String(emp.xeroEmployeeId ?? emp.id ?? "").trim();
    if (!xeroEmployeeId) return;

    fetch(API_EMPLOYEE_SETTINGS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        xeroEmployeeId,
        fullName: emp.name,
        baseRate: emp.baseRate,
        noTimesheets: Boolean((emp as any).noTimesheets),
        weeklyHours: typeof (emp as any).weeklyHours === "number" ? (emp as any).weeklyHours : null,
      }),
    }).catch(() => {});
  };

  const setRawTimeEntries = (entries: TimeEntry[]) => {
    setRawTimeEntriesState(entries);
  };

  const clearComputed = () => {
    setComputedPayLinesState([]);
    setLastAppliedAt(null);
    try {
      localStorage.removeItem(LS_COMPUTED);
      localStorage.removeItem(LS_LAST_APPLIED);
    } catch {}
  };

  const setActivePeriod = (p: ActivePeriod | null) => {
    setActivePeriodState(p);
  };

  const importCsvFile = async (file: File) => {
    const entries = await parseCsvFile(file);
    setRawTimeEntriesState(entries);
  };

  const clearAll = () => {
    setEmployeesState([]);
    setRawTimeEntriesState([]);
    setComputedPayLinesState([]);
    setActivePeriodState(null);
    setLastAppliedAt(null);

    try {
      localStorage.removeItem(LS_EMPLOYEES);
      localStorage.removeItem(LS_RAW_TIME);
      localStorage.removeItem(LS_COMPUTED);
      localStorage.removeItem(LS_LAST_APPLIED);
      localStorage.removeItem(LS_OLD_BLOB);
      // do NOT delete LS_XERO_EMPLOYEES here
    } catch {}
  };

  const applyRules = async (ruleset?: CompanyRuleset) => {
    const effectiveRuleset: CompanyRuleset = ruleset ?? getCurrentRuleset();

    const p = activePeriod ?? (loadActivePayPeriod() as any);
    const startISO = p?.startISO ?? p?.start ?? null;
    const endISO = p?.endISO ?? p?.end ?? null;

    const filtered =
      startISO && endISO
        ? rawTimeEntries.filter((e: any) => {
            const d = entryDateISO(e);
            if (!d) return true;
            return withinInclusive(d, startISO, endISO);
          })
        : rawTimeEntries;

    // ✅ Add synthetic "ordinary" entries for office/salaried staff who do not submit Fergus timesheets.
    const effectiveEntries: TimeEntry[] = (() => {
      const base = Array.isArray(filtered) ? [...filtered] : [];
      if (!startISO || !endISO) return base;

      const existingMinutesFor = (xeroId: string, name: string) => {
        // IMPORTANT: Salary / "no timesheets" staff should NOT get their weeklyHours added
        // on top of any leave (or other) entries in the same period.
        // Instead: targetMinutes - existingMinutes = synthetic ordinary minutes.
        const empStub = { xeroEmployeeId: xeroId, id: xeroId, name };
        let sum = 0;
        for (const e of base as any[]) {
          if (!e) continue;
          if (String((e as any).source ?? "") === "auto_no_timesheets") continue;
          if (!entryBelongsToEmployee(e, empStub as any)) continue;
          const mins = typeof (e as any).minutes === "number" ? (e as any).minutes : 0;
          if (mins > 0) sum += mins;
        }
        return sum;
      };

      // IMPORTANT:
      // If we fall back to "fortnightly" when the active period is missing/invalid,
      // salaried / no-timesheets staff will get their weeklyHours multiplied by 2
      // ("double hours") even though the user expects a weekly run.
      // Prefer explicit active period cycle, then saved payrun settings, then weekly.
      const fallbackCycle = (() => {
        try {
          return loadPayrunSettings()?.cycle ?? "weekly";
        } catch {
          return "weekly";
        }
      })();

      const pCycle = ((p?.cycle as any) || fallbackCycle) as any;
      const weeksInPeriod = pCycle === "weekly" ? 1 : pCycle === "fortnightly" ? 2 : null;

      const startT = new Date(`${startISO}T00:00:00Z`).getTime();
      const endT = new Date(`${endISO}T00:00:00Z`).getTime();
      if (!Number.isFinite(startT) || !Number.isFinite(endT)) return base;

      const days: string[] = [];
      for (let t = startT; t <= endT; t += 24 * 60 * 60 * 1000) {
        const d = new Date(t);
        days.push(d.toISOString().slice(0, 10));
      }

      for (const emp of employees) {
        if (!emp?.name) continue;
        if (!Boolean((emp as any).noTimesheets)) continue;

        const xeroId = String(emp.xeroEmployeeId ?? emp.id ?? "").trim();
        if (!xeroId) continue;

        const weeklyHoursRaw = typeof (emp as any).weeklyHours === "number" ? (emp as any).weeklyHours : null;
        const weeklyHours = weeklyHoursRaw && weeklyHoursRaw > 0 ? weeklyHoursRaw : 38;
        if (!weeklyHours || weeklyHours <= 0) continue;

        // Work out how many minutes this employee ALREADY has in the period (incl leave).
        // Then only generate the missing ordinary minutes up to their weekly target.
        const already = existingMinutesFor(xeroId, emp.name);

        let totalHours: number;
        if (weeksInPeriod) {
          totalHours = weeklyHours * weeksInPeriod;
        } else {
          const daysCount = days.length || 1;
          totalHours = (weeklyHours / 7) * daysCount;
        }

        const targetMinutes = Math.round(totalHours * 60);
        let minutesRemaining = targetMinutes - already;
        if (minutesRemaining <= 0) continue;

        const weekdayDays = days.filter((iso) => {
          const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
          return dow >= 1 && dow <= 5;
        });
        const targetDays = weekdayDays.length ? weekdayDays : days;

        const perDay = Math.ceil(minutesRemaining / Math.max(1, targetDays.length));

        for (const day of targetDays) {
          if (minutesRemaining <= 0) break;
          const mins = Math.min(perDay, minutesRemaining);

          const start = new Date(`${day}T00:00:00Z`);
          const end = new Date(start.getTime() + mins * 60 * 1000);

          base.push({
            employeeId: xeroId,
            employeeName: emp.name,
            date: day,
            startISO: start.toISOString(),
            endISO: end.toISOString(),
            minutes: mins,
            category: "ordinary",
            entryType: "ordinary",
            source: "auto_no_timesheets",
          } as any);

          minutesRemaining -= mins;
        }
      }

      return base;
    })();

    const out: ComputedPayLine[] = [];

    for (const e of effectiveEntries as any[]) {
      const leaveInfo = isFergusLeaveEntry(e);
      const rawEmpId = detectEmployeeId(e);
      const rawEmpName = detectEmployeeName(e);

      let emp: Employee | undefined;
      if (rawEmpId) emp = employeesById.get(String(rawEmpId));
      if (!emp && rawEmpName) emp = employeesByName.get(normalizeName(rawEmpName));

      const baseRate = n(emp?.baseRate, 0) || n((e as any)?.baseRate, 0);

      const employeeId = String(emp?.id ?? rawEmpId ?? normalizeName(rawEmpName) ?? "unknown");
      const employeeName = emp?.name ?? rawEmpName ?? "Unknown";

      if (leaveInfo.ok) {
        const rawLeaveDur = Number.isFinite(n((e as any)?.unchargedTimeDuration, NaN))
          ? n((e as any)?.unchargedTimeDuration, 0)
          : Number.isFinite(n((e as any)?.paidDuration, NaN))
          ? n((e as any)?.paidDuration, 0)
          : NaN;

        const leaveHours = (() => {
          if (Number.isFinite(rawLeaveDur) && rawLeaveDur > 0) {
            if (rawLeaveDur > 24) return rawLeaveDur / 60;
            return rawLeaveDur;
          }
          return entryMinutes(e) / 60;
        })();

        const minutes = Math.max(0, Math.round(leaveHours * 60));

        out.push({
          employeeId,
          employeeName,
          baseRate,
          cost: 0,
          minutes,
          hours: minutes / 60,
          multiplier: 1,
          jobCode: detectJobCode(e) ?? undefined,
          dateISO: entryDateISO(e) ?? undefined,
          category: leaveInfo.leaveType,
          entryType: leaveInfo.leaveType,
          isLeave: true,
        } as any);

        continue;
      }

      const { startISO: startISOEntry, endISO: endISOEntry } = buildStartEndISO(e);

      const adaptedEntry: any = {
        ...e,
        employeeId,
        employeeName,
        minutes: Number.isFinite(n((e as any)?.minutes, NaN)) ? n((e as any)?.minutes, 0) : entryMinutes(e),
        jobCode: detectJobCode(e),
        date: entryDateISO(e) ?? (e as any)?.date ?? (e as any)?.day,
        startISO: (e as any)?.startISO ?? (e as any)?.startIso ?? startISOEntry,
        endISO: (e as any)?.endISO ?? (e as any)?.endIso ?? endISOEntry,
      };

      const lines = computePayLinesV1(adaptedEntry, effectiveRuleset);

      for (const l of lines as any[]) {
        const minutes = n(
          (l as any)?.minutes,
          Number.isFinite(n((l as any)?.hours, NaN)) ? Math.round(n((l as any)?.hours, 0) * 60) : 0
        );
        const hours = minutes / 60;
        const multiplier = Number.isFinite(n((l as any)?.multiplier, NaN)) ? n((l as any)?.multiplier, 1) : 1;

        const cost = hours * baseRate * multiplier;

        out.push({
          ...(l as any),
          employeeId,
          employeeName,
          baseRate,
          cost,
          jobCode: (l as any)?.jobCode ?? adaptedEntry.jobCode ?? detectJobCode(e),
          dateISO: (l as any)?.dateISO ?? adaptedEntry.date ?? entryDateISO(e) ?? undefined,
        });
      }
    }

    setComputedPayLinesState(out);

    const now = new Date().toISOString();
    setLastAppliedAt(now);
    try {
      localStorage.setItem(LS_LAST_APPLIED, now);
    } catch {}
  };

  // ✅ Sync mutex: prevents overlap even if callers re-render rapidly
  const syncInFlightRef = useRef(false);

  const syncNow = useCallback(
    async (opts?: { autoApplyRules?: boolean; silent?: boolean }) => {
      const autoApply = opts?.autoApplyRules !== false;

      if (syncInFlightRef.current) return { ok: false, error: "Sync already in progress." };

      syncInFlightRef.current = true;
      setSyncing(true);
      setLastSyncError(null);

      try {
        const p = activePeriod ?? (loadActivePayPeriod() as any);
        const startISO = p?.startISO ?? p?.start ?? null;
        const endISO = p?.endISO ?? p?.end ?? null;

        if (!startISO || !endISO) throw new Error("No active pay period set.");

        // --- Xero: employees (best-effort)
        let syncedXero = 0;
        try {
          const xr = await fetch("/api/xero/employees", { method: "GET", cache: "no-store" });
          const xj = await xr.json().catch(() => ({} as any));
          if (xr.ok && xj?.ok !== false) {
            const incoming = Array.isArray(xj?.employees) ? xj.employees : [];
            syncedXero = incoming.length;
            try {
              localStorage.setItem("xero_employees_v1", JSON.stringify(incoming));
              localStorage.setItem(
                "xero_employees_sync_meta_v1",
                JSON.stringify({ lastSyncAt: new Date().toISOString() })
              );
            } catch {}
          }
        } catch {
          // ignore Xero failure
        }

        // --- Fergus: time entries for active period (inclusive)
        const fr = await fetch(
          `/api/fergus/timeEntries?startISO=${encodeURIComponent(String(startISO))}&endISOInclusive=${encodeURIComponent(
            String(endISO)
          )}`,
          { cache: "no-store" }
        );
        const fj = await fr.json().catch(() => ({} as any));
        if (!fr.ok || !fj?.ok) throw new Error(String(fj?.error ?? "Failed to pull from Fergus"));

        const csvText = String(fj?.csv ?? "");
        const pulledFergus = Number(fj?.count ?? 0) || 0;

        const file = new File([csvText], `fergus_${startISO}_to_${endISO}.csv`, { type: "text/csv" });
        await importCsvFile(file);

        if (autoApply) await applyRules();

        setLastSyncAt(new Date().toISOString());
        return { ok: true, pulledFergus, syncedXero };
      } catch (e: any) {
        const msg = String(e?.message ?? "Sync failed");
        setLastSyncError(msg);
        return { ok: false, error: msg };
      } finally {
        setSyncing(false);
        syncInFlightRef.current = false;
      }
    },
    [activePeriod, importCsvFile, applyRules]
  );

  const lastNavSyncAtRef = useRef<number>(0);
  useEffect(() => {
    const onMajorNav = (e: any) => {
      const major = String(e?.detail?.major ?? "");
      const should = major === "integrations" || major === "payroll" || major === "payments";
      if (!should) return;

      const now = Date.now();
      if (now - lastNavSyncAtRef.current < 5000) return;
      lastNavSyncAtRef.current = now;

      if (syncInFlightRef.current) return;

      syncNow({ silent: true }).catch(() => {});
    };

    window.addEventListener("app-major-nav", onMajorNav as any);
    return () => window.removeEventListener("app-major-nav", onMajorNav as any);
  }, [syncNow]);

  const value: PayrollState = {
    timeEntries: rawTimeEntries,
    payLines: computedPayLines,
    hasImported: Array.isArray(rawTimeEntries) && rawTimeEntries.length > 0,

    employees,
    rawTimeEntries,
    computedPayLines,
    activePeriod,
    summary,
    lastAppliedAt,

    setEmployees,
    upsertEmployee,

    setRawTimeEntries,
    clearComputed,

    setActivePeriod,

    importCsvFile,
    clearAll,
    applyRules,

    syncing,
    lastSyncAt,
    lastSyncError,
    syncNow,
  };

  return <PayrollDataContext.Provider value={value}>{children}</PayrollDataContext.Provider>;
}

export function usePayrollData() {
  const ctx = useContext(PayrollDataContext);
  if (!ctx) throw new Error("usePayrollData must be used inside PayrollDataProvider");
  return ctx;
}
