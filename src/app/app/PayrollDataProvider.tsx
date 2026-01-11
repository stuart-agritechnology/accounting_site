"use client";

import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import type { CompanyRuleset, PayLine, TimeEntry } from "~/payroll_calc/types";
import { computePayLinesV1 } from "~/payroll_calc/engine_demo";
import { getCurrentRuleset } from "~/payroll_calc/runtimeRules";
import { loadActivePayPeriod, saveActivePayPeriod } from "./_lib/payPeriod";

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
  const candidates = [
    e?.unchargedTimeType,
    e?.entryType,
    e?.leaveType,
    e?.timeType,
    e?.category,
  ]
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
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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
  return (
    e?.employeeName ??
    e?.employee ?? // ✅ Fergus CSV uses "employee"
    e?.staffName ??
    e?.staff ??
    e?.userName ??
    e?.user ??
    ""
  );
}

function detectEmployeeId(e: any): string | null {
  return (
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
  return (
    e?.jobCode ??
    e?.job ?? // ✅ Fergus CSV uses "job"
    e?.job_id ??
    e?.jobId ??
    e?.siteCode ??
    e?.site ??
    undefined
  );
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
  const iJob = idx(["job", "jobCode", "job_code", "site", "siteCode"]);
  const iDate = idx(["date", "day", "workDate"]);
  const iStart = idx(["start", "startTime", "start_time"]);
  const iEnd = idx(["end", "endTime", "end_time"]);
  const iMinutes = idx(["minutes"]);
  const iHours = idx(["hours"]);
  const iBaseRate = idx(["baseRate", "base_rate", "rate", "payRate", "pay_rate"]);
  // Fergus leave often arrives as a "type" field (e.g. Annual Leave) rather than job/category.
  // Keep it on the raw entry so our leave-detector can bypass the calc engine.
  const iEntryType = idx(["entryType", "entry_type", "type", "source", "timeType", "leaveType"]);

  const out: any[] = [];

  for (const r of rows) {
    const cols = r.split(",").map((c) => c.trim());
    if (cols.length === 0) continue;

    const employeeName = iEmployee >= 0 ? cols[iEmployee] : "";
    const jobCode = iJob >= 0 ? cols[iJob] : undefined;
    const date = iDate >= 0 ? cols[iDate] : "";

    // ✅ FIX: only define this once
    const entryTypeRaw = iEntryType >= 0 ? (cols[iEntryType] || "") : "";

    const start = iStart >= 0 ? cols[iStart] : "";
    const end = iEnd >= 0 ? cols[iEnd] : "";

    const minutes =
      iMinutes >= 0
        ? n(cols[iMinutes], 0)
        : iHours >= 0
          ? Math.round(n(cols[iHours], 0) * 60)
          : 0;

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
      jobCode,

      // Leave/time source label (e.g. Annual Leave). Used to bypass pay rules.
      entryType: entryTypeRaw || undefined,

      // Keep both: some UIs read date/day, engine reads startISO/endISO
      day: dayISO,
      date: dayISO,
      start,
      end,
      startISO,
      endISO,
      minutes,
      baseRate, // ✅ used if employee match missing
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
            }));
            setEmployeesState(normalized.filter((x) => x.name));
          }
        }
      }

      const rawRaw = localStorage.getItem(LS_RAW_TIME);
      if (rawRaw) {
        const parsed = JSON.parse(rawRaw);
        if (Array.isArray(parsed)) setRawTimeEntriesState(parsed);
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
          setRawTimeEntriesState(parsed.timeEntries);
          localStorage.setItem(LS_RAW_TIME, JSON.stringify(parsed.timeEntries));
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

  // persist (never write to xero_employees_v1 here)
  useEffect(() => {
    try {
      localStorage.setItem(LS_EMPLOYEES, JSON.stringify(employees));
    } catch {}
  }, [employees]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_RAW_TIME, JSON.stringify(rawTimeEntries));
    } catch {}
  }, [rawTimeEntries]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_COMPUTED, JSON.stringify(computedPayLines));
    } catch {}
  }, [computedPayLines]);

  useEffect(() => {
    try {
      if (activePeriod) saveActivePayPeriod(activePeriod.start, activePeriod.end);
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

    const out: ComputedPayLine[] = [];

    for (const e of filtered as any[]) {
      const leaveInfo = isFergusLeaveEntry(e);
      const rawEmpId = detectEmployeeId(e);
      const rawEmpName = detectEmployeeName(e);

      let emp: Employee | undefined;
      if (rawEmpId) emp = employeesById.get(String(rawEmpId));
      if (!emp && rawEmpName) emp = employeesByName.get(normalizeName(rawEmpName));

      // ✅ fall back to entry.baseRate (Fergus API provides it)
      const baseRate = n(emp?.baseRate, 0) || n((e as any)?.baseRate, 0);

      const employeeId = String(emp?.id ?? rawEmpId ?? normalizeName(rawEmpName) ?? "unknown");
      const employeeName = emp?.name ?? rawEmpName ?? "Unknown";

      // ============================
      // ✅ LEAVE: show it, but DO NOT run it through the calc engine
      // We keep raw duration for display + pushing to Xero later,
      // but set cost = 0 and mark it so summaries/totals can ignore it.
      // ============================
      if (leaveInfo.ok) {
        const rawLeaveDur = Number.isFinite(n((e as any)?.unchargedTimeDuration, NaN))
          ? n((e as any)?.unchargedTimeDuration, 0)
          : Number.isFinite(n((e as any)?.paidDuration, NaN))
            ? n((e as any)?.paidDuration, 0)
            : NaN;

        const leaveHours = (() => {
          // Prefer explicit duration if present and non-zero
          if (Number.isFinite(rawLeaveDur) && rawLeaveDur > 0) {
            // Some Fergus setups return minutes (e.g. 480) not hours.
            if (rawLeaveDur > 24) return rawLeaveDur / 60;
            return rawLeaveDur;
          }
          // Otherwise derive from start/end or hours
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
          // marker for UI/summary logic
          isLeave: true,
        } as any);

        continue;
      }

      // ✅ Ensure startISO/endISO exist for engine_demo
      const { startISO: startISOEntry, endISO: endISOEntry } = buildStartEndISO(e);

      const adaptedEntry: any = {
        ...e,
        employeeId,
        employeeName,
        // engine_demo uses startISO/endISO for duration; keep minutes as a fallback for other engines
        minutes: Number.isFinite(n((e as any)?.minutes, NaN)) ? n((e as any)?.minutes, 0) : entryMinutes(e),
        jobCode: detectJobCode(e),
        date: entryDateISO(e) ?? (e as any)?.date ?? (e as any)?.day,
        startISO: (e as any)?.startISO ?? (e as any)?.startIso ?? startISOEntry,
        endISO: (e as any)?.endISO ?? (e as any)?.endIso ?? endISOEntry,
      };

      // ✅ ALWAYS pass a ruleset
      const lines = computePayLinesV1(adaptedEntry, effectiveRuleset);

      for (const l of lines as any[]) {
        const minutes = n(
          (l as any)?.minutes,
          Number.isFinite(n((l as any)?.hours, NaN)) ? Math.round(n((l as any)?.hours, 0) * 60) : 0,
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

  const syncNow = useCallback(async (opts?: { autoApplyRules?: boolean; silent?: boolean }) => {
    const autoApply = opts?.autoApplyRules !== false;

    // prevent overlap (timer + manual click + any re-render loops)
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
              JSON.stringify({ lastSyncAt: new Date().toISOString() }),
            );
          } catch {}
        }
      } catch {
        // ignore Xero failure
      }

      // --- Fergus: time entries for active period (inclusive)
      const fr = await fetch(
        `/api/fergus/timeEntries?startISO=${encodeURIComponent(String(startISO))}&endISOInclusive=${encodeURIComponent(
          String(endISO),
        )}`,
        { cache: "no-store" },
      );
      const fj = await fr.json().catch(() => ({} as any));
      if (!fr.ok || !fj?.ok) throw new Error(String(fj?.error ?? "Failed to pull from Fergus"));

      const csvText = String(fj?.csv ?? "");
      const pulledFergus = Number(fj?.count ?? 0) || 0;

      // Use your existing importCsvFile() so you keep your current parsing + storage behaviour
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
  }, [activePeriod, importCsvFile, applyRules]);

  // ✅ Optional refresh on *major* navigation (sidebar pages)
  // Triggered by /app/app/layout.tsx via window event "app-major-nav".
  // This avoids the "looks disconnected until I press Sync" issue when moving between major pages.
  const lastNavSyncAtRef = useRef<number>(0);
  useEffect(() => {
    const onMajorNav = (e: any) => {
      const major = String(e?.detail?.major ?? "");
      // Only run on key pages that need fresh sync data.
      const should = major === "integrations" || major === "payroll" || major === "payments";
      if (!should) return;

      const now = Date.now();
      // Debounce: if user clicks around quickly, don't spam.
      if (now - lastNavSyncAtRef.current < 5000) return;
      lastNavSyncAtRef.current = now;

      // If a sync is running, skip; next nav or manual sync will catch up.
      if (syncInFlightRef.current) return;

      // Silent sync on navigation (best-effort)
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
