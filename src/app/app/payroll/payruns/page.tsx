"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePayrollData } from "../../PayrollDataProvider";
import { loadActivePayPeriod } from "../../_lib/payPeriod";

/**
 * ✅ NEW: Employees page reads this key
 */
const LS_XERO_LAST_PUSH = "xero_last_push_report_v1";

/**
 * ✅ Employees list cache (synced from Xero)
 * This is what we use to display base rates in Payruns.
 */
const LS_XERO_EMPLOYEES = "xero_employees_v1";

/**
 * ✅ NEW: Store the last push report + notify Employees page to refresh.
 * (Employees page listens for "xero-push-updated")
 */
function storeLastXeroPushReport(report: any) {
  try {
    localStorage.setItem(LS_XERO_LAST_PUSH, JSON.stringify(report ?? null));
    window.dispatchEvent(new Event("xero-push-updated"));
  } catch (e) {
    console.error("Failed to store Xero push report", e);
  }
}

function n(v: unknown, fallback = 0): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function money(v: unknown): string {
  const x = Number(v);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  });
}

function hoursFromLine(l: any): number {
  const minutes = n(l?.minutes, 0);
  const hours = Number.isFinite(n(l?.hours, NaN)) ? n(l?.hours, 0) : minutes / 60;
  return Number.isFinite(hours) ? hours : 0;
}

function normName(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * ✅ Robust date getter for pay lines.
 * Provider stores dates as `dateISO` (YYYY-MM-DD), but older lines may have `date` / `day` / `startISO`.
 */
function lineDateKey(l: any): string {
  const raw =
    l?.dateISO ??
    l?.date ??
    l?.day ??
    l?.timeEntryDate ??
    l?.startISO ??
    l?.startTime ??
    l?.start ??
    null;

  if (!raw) return "";

  const s = String(raw).trim();
  if (!s) return "";

  // ISO-like: "2026-01-15T..." or "2026-01-15"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // Fergus: "2026-01-15 06:55"
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s)) return s.slice(0, 10);

  const t = new Date(s).getTime();
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);

  return "";
}

function displayDateFromKey(key: string): string {
  if (!key) return "—";
  const t = new Date(`${key}T00:00:00`).getTime();
  if (!Number.isFinite(t)) return key;
  return new Date(t).toLocaleDateString("en-AU", { year: "numeric", month: "2-digit", day: "2-digit" });
}

type EmpAgg = {
  employeeId: string;
  employeeName: string;
  totalMinutes: number;
  totalHours: number;
  totalCost: number;
  lines: any[];
};

export default function PayrunsPage() {
  const { payLines, summary, lastAppliedAt, hasImported } = usePayrollData();
  const totalHours = n(summary.totalMinutes) / 60;

  // which employee row is expanded
  const [openEmpKey, setOpenEmpKey] = useState<string | null>(null);

  // ============================
  // Xero employee rate map (from Employees page cache)
  // ============================
  const [xeroRateByName, setXeroRateByName] = useState<Map<string, number>>(new Map());

  function loadXeroEmployeeRatesFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LS_XERO_EMPLOYEES);
      if (!raw) {
        setXeroRateByName(new Map());
        return;
      }
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) {
        setXeroRateByName(new Map());
        return;
      }

      const m = new Map<string, number>();
      for (const e of arr as any[]) {
        const fullName = String(e?.fullName ?? e?.FullName ?? e?.name ?? e?.Name ?? "").trim();
        const baseRate = Number(e?.baseRate ?? e?.BaseRate ?? e?.ratePerUnit ?? e?.RatePerUnit);

        if (!fullName) continue;
        if (!Number.isFinite(baseRate) || baseRate <= 0) continue;

        const k = normName(fullName);
        if (!m.has(k)) m.set(k, baseRate);
      }

      setXeroRateByName(m);
    } catch (e) {
      console.error("Failed to load Xero employees from localStorage", e);
      setXeroRateByName(new Map());
    }
  }

  // ============================
  // Xero status + push state
  // ============================
  const [xeroConnected, setXeroConnected] = useState<boolean>(false);
  const [xeroTenantName, setXeroTenantName] = useState<string>("");
  const [xeroPushBusy, setXeroPushBusy] = useState<boolean>(false);
  const [xeroPushMsg, setXeroPushMsg] = useState<string>("");

  // ✅ hover state for the Xero button (since inline styles can't do :hover)
  const [xeroBtnHover, setXeroBtnHover] = useState(false);

  useEffect(() => {
    let alive = true;

    // Load Xero connection status
    fetch("/api/xero/status")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setXeroConnected(Boolean(j?.connected));
        setXeroTenantName(String(j?.tenant?.tenantName ?? ""));
      })
      .catch(() => {
        if (!alive) return;
        setXeroConnected(false);
      });

    // Load employee rates from Employees cache on mount
    loadXeroEmployeeRatesFromLocalStorage();

    // Keep in sync if other pages update localStorage
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === LS_XERO_EMPLOYEES) {
        loadXeroEmployeeRatesFromLocalStorage();
      }
    };
    window.addEventListener("storage", onStorage);

    // Optional: you can dispatch this event anywhere after syncing employees
    const onEmployeesUpdated = () => loadXeroEmployeeRatesFromLocalStorage();
    window.addEventListener("xero-employees-updated", onEmployeesUpdated as any);

    return () => {
      alive = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("xero-employees-updated", onEmployeesUpdated as any);
    };
  }, []);

  // ============================
  // Better error formatting helpers (ADDED)
  // ============================
  function pretty(v: any): string {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  function buildXeroFailureMessage(args: {
    endpoint: string;
    status: number;
    contentType: string;
    payload: any;
    rawText: string;
  }): string {
    const { endpoint, status, contentType, payload, rawText } = args;

    // Try to extract the most useful error text from typical Xero / server payloads
    const serverErr =
      payload?.error ??
      payload?.message ??
      payload?.detail ??
      payload?.Detail ??
      payload?.response?.body?.Detail ??
      payload?.response?.body?.detail ??
      payload?.response?.body?.message ??
      rawText ??
      `Xero push failed (${status})`;

    const serverErrStr = typeof serverErr === "string" ? serverErr : pretty(serverErr);

    // Warnings (your API already returns these)
    const warns = payload?.warnings ?? {};
    const missE = (warns?.missingEmployees ?? []) as string[];
    const missC = (warns?.missingCategories ?? []) as Array<any>;

    const warnParts: string[] = [];
    if (missE.length) warnParts.push(`Missing employees: ${missE.join(", ")}`);
    if (missC.length) {
      const uniq = Array.from(new Set(missC.map((x: any) => `${x.employeeName}:${x.category}`)));
      warnParts.push(`Unmapped categories: ${uniq.join(", ")}`);
    }

    // Per-employee errors (your API returns errors[])
    const errs = (payload?.errors ?? []) as Array<{ employeeName: string; error: string }>;
    const errText =
      errs.length > 0
        ? `Per-employee errors: ${errs
            .slice(0, 8)
            .map((e) => `${e.employeeName} (${String(e.error).slice(0, 180)})`)
            .join(", ")}${errs.length > 8 ? " …" : ""}`
        : "";

    // Hints
    const m = serverErrStr.toLowerCase();
    let fix = "";
    if (status === 401 || status === 403 || m.includes("unauthor") || m.includes("forbidden") || m.includes("scope")) {
      fix = "Fix: Reconnect Xero and ensure scopes include payroll.settings + payroll.timesheets.";
    } else if (contentType.includes("text/html") || m.includes("<html")) {
      fix = "Fix: The API returned HTML (likely auth redirect). Check getAuthedXeroClient() and cookies/session.";
    } else if (status === 400 && (m.includes("paylines had no usable rows") || m.includes("no paylines") || m.includes("missing period"))) {
      fix = "Fix: Click 'Compute' first, and ensure pay lines have employeeName + date + category + hours (>0).";
    } else if (status === 400 && (m.includes("enddate") || m.includes("startdate") || m.includes("date"))) {
      fix = "Fix: Check your pay period start/end. This app uses an INCLUSIVE end date (same as Xero timesheets).";
    } else if (m.includes("earnings") && m.includes("rate")) {
      fix = "Fix: Ensure an Earnings Rate exists in Xero Payroll (e.g. Ordinary Hours) and your API selects it.";
    } else if (m.includes("employee") && (m.includes("not found") || m.includes("invalid"))) {
      fix = "Fix: Employee name matching failed. Make sure Xero employee First+Last matches your employeeName.";
    }

    const compactServer = serverErrStr.replace(/\s+/g, " ").trim().slice(0, 420);
    const details: string[] = [];
    details.push(`❌ Xero push failed (HTTP ${status})`);
    details.push(`Endpoint: ${endpoint}`);
    if (contentType) details.push(`Content-Type: ${contentType}`);
    details.push(`Server: ${compactServer}`);
    if (warnParts.length) details.push(warnParts.join(" | "));
    if (errText) details.push(errText);
    if (fix) details.push(fix);

    return details.filter(Boolean).join("  •  ");
  }

  async function pushTimesheetsToXero() {
    setXeroPushMsg("");

    const period = loadActivePayPeriod();
    if (!period) {
      const msg = "No active pay period selected. Go to Import and set the pay period.";
      setXeroPushMsg(msg);

      // ✅ store failure report too (so Employees page shows something)
      storeLastXeroPushReport({
        ok: false,
        error: msg,
        pushedAtISO: new Date().toISOString(),
      });

      return;
    }

    if (!payLines?.length) {
      const msg = "No pay lines to push.";
      setXeroPushMsg(msg);

      // ✅ store failure report too (so Employees page shows something)
      storeLastXeroPushReport({
        ok: false,
        error: msg,
        pushedAtISO: new Date().toISOString(),
      });

      return;
    }

    setXeroPushBusy(true);
    try {
      const endpoint = "/api/xero/push-timesheets";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          periodStartISO: period.startISO,
          periodEndISOInclusive: period.endISO,
          payLines,
        }),
      });

      // ✅ robust body parsing (handles HTML redirects / non-JSON)
      const ct = res.headers.get("content-type") || "";
      let payload: any = null;
      let rawText = "";

      if (ct.includes("application/json")) {
        payload = await res.json().catch(() => null);
      } else {
        rawText = await res.text().catch(() => "");
      }

      (window as any).__lastXeroPush = payload;

      console.log("XERO PUSH payload:", payload);

      // ✅ ALWAYS store the report (success or fail) so Employees page updates
      storeLastXeroPushReport({
        ...(payload ?? {}),
        ok: !!payload?.ok && res.ok,
        httpStatus: res.status,
        pushedAtISO: new Date().toISOString(),
        meta: payload?.meta ?? null,
        warnings: payload?.warnings ?? null,
        results: payload?.results ?? null,
        errors: payload?.errors ?? null,
      });

      // ✅ MUCH clearer failure message
      if (!res.ok || !payload?.ok) {
        setXeroPushMsg(
          buildXeroFailureMessage({
            endpoint,
            status: res.status,
            contentType: ct,
            payload,
            rawText,
          }),
        );
        return;
      }

      const warns = payload?.warnings;
      const missE = (warns?.missingEmployees ?? []) as string[];
      const missC = (warns?.missingCategories ?? []) as Array<any>;

      const parts: string[] = [];

      // ✅ SAFELY read server counts
      const createdTimesheets = Number(payload?.created ?? 0) || 0;
      const createdLeave = Number(payload?.leave?.created ?? 0) || 0;

      const skippedMatch = Number(payload?.skipped?.match ?? 0) || 0;
      const skippedDiff = Number(payload?.skipped?.diff ?? 0) || 0;

      // ---- Timesheets summary ----
      if (createdTimesheets === 0 && (skippedMatch > 0 || skippedDiff > 0)) {
        parts.push(
          `Created 0 timesheets. Already existed in Xero: ${skippedMatch} matching, ${skippedDiff} different (not overwritten).`,
        );
      } else {
        parts.push(
          `Created ${createdTimesheets} timesheet${createdTimesheets === 1 ? "" : "s"} in Xero.`,
        );

        if (skippedMatch || skippedDiff) {
          parts.push(
            `Skipped: ${skippedMatch} already matched, ${skippedDiff} existed but different (not overwritten).`,
          );
        }
      }

      // ---- Leave summary ----
      parts.push(
        `Created ${createdLeave} leave request${createdLeave === 1 ? "" : "s"} in Xero.`,
      );

      if (missE.length) parts.push(`Missing employees (not found in Xero): ${missE.join(", ")}`);

      if (missC.length) {
        const uniq = Array.from(new Set(missC.map((x: any) => `${x.employeeName}:${x.category}`)));
        parts.push(`Unmapped categories (no matching Earnings Rate): ${uniq.join(", ")}`);
      }

      // server-side per-employee errors if any
      const errs = (payload?.errors ?? []) as Array<{ employeeName: string; error: string }>;
      if (errs.length) {
        parts.push(
          "Errors:\n" + errs.map((e) => `- ${e.employeeName}: ${String(e.error || "").slice(0, 300)}`).join("\n"),
        );
      }

      // If nothing was created, show a quick status summary from results[]
      if (createdTimesheets === 0) {
        const results = (payload?.results ?? []) as Array<any>;
        const counts = results.reduce(
          (acc: Record<string, number>, r: any) => {
            const k = String(r?.status ?? "").trim() || "UNKNOWN";
            acc[k] = (acc[k] ?? 0) + 1;
            return acc;
          },
          {},
        );
        const summary = Object.entries(counts)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ");
        if (summary) parts.push(`Result summary: ${summary}`);

        // ✅ If we got ERROR results but no top-level `errors[]`, show the per-employee notes.
        const errNotes = results
          .filter((r: any) => String(r?.status ?? "").toUpperCase() === "ERROR")
          .map((r: any) => {
            const name = String(r?.employeeName ?? "—");
            const note = String(r?.note ?? "").trim();
            return note ? `- ${name}: ${note}` : `- ${name}: ERROR`;
          });
        if (errNotes.length) parts.push("Errors:\n" + errNotes.join("\n"));
      }

      setXeroPushMsg(parts.join("  "));
    } catch (e: any) {
      const msg = e?.message ?? "Xero push failed (network)";
      setXeroPushMsg(msg);

      // ✅ store failure report too
      storeLastXeroPushReport({
        ok: false,
        error: msg,
        pushedAtISO: new Date().toISOString(),
      });
    } finally {
      setXeroPushBusy(false);
    }
  }

  const perEmployee = useMemo<EmpAgg[]>(() => {
    const map = new Map<string, EmpAgg>();

    for (const l of payLines as any[]) {
      const employeeName = String(l.employeeName ?? "—");
      const employeeId = String(l.employeeId ?? employeeName);
      const key = employeeId || employeeName;

      const cur =
        map.get(key) ??
        ({
          employeeId,
          employeeName,
          totalMinutes: 0,
          totalHours: 0,
          totalCost: 0,
          lines: [],
        } as EmpAgg);

      const minutes = n(l.minutes, 0);
      const hours = hoursFromLine(l);
      const cost = n(l.cost, 0);

      // ✅ Leave lines are displayed, but do NOT contribute to totals
      if (!l?.isLeave) {
        cur.totalMinutes += minutes;
        cur.totalHours += hours;
        cur.totalCost += cost;
      }
      cur.lines.push(l);

      map.set(key, cur);
    }

    const arr = Array.from(map.values());

    // sort: biggest cost first, then name
    arr.sort((a, b) => {
      const dc = b.totalCost - a.totalCost;
      if (Math.abs(dc) > 1e-9) return dc;
      return a.employeeName.localeCompare(b.employeeName);
    });

    // stable sort inside each employee: date then category then jobCode
    for (const e of arr) {
      e.lines.sort((a: any, b: any) => {
        const da = lineDateKey(a);
        const db = lineDateKey(b);
        if (da !== db) return da.localeCompare(db);

        const ca = String(a.category ?? "");
        const cb = String(b.category ?? "");
        if (ca !== cb) return ca.localeCompare(cb);

        return String(a.jobCode ?? "").localeCompare(String(b.jobCode ?? ""));
      });
    }

    return arr;
  }, [payLines]);

  const xeroBtnDisabled = !xeroConnected || xeroPushBusy;

  // ✅ Button styles with hover + disabled
  const xeroBtnStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: xeroBtnDisabled ? "1px solid #2a2a2a" : "1px solid #3a3a3a",
    background: xeroBtnDisabled ? "#0b0b0b" : xeroBtnHover ? "#1a1a1a" : "#111",
    cursor: xeroBtnDisabled ? "not-allowed" : "pointer",
    fontWeight: 800,
    color: "#fff",
    WebkitTextFillColor: "#fff",
    opacity: xeroBtnDisabled ? 0.55 : 1,
    boxShadow: xeroBtnDisabled
      ? "none"
      : xeroBtnHover
        ? "0 6px 18px rgba(0,0,0,0.25)"
        : "0 2px 10px rgba(0,0,0,0.18)",
    transform: xeroBtnDisabled ? "none" : xeroBtnHover ? "translateY(-1px)" : "translateY(0)",
    transition:
      "transform 120ms ease, box-shadow 120ms ease, background 120ms ease, opacity 120ms ease, border-color 120ms ease",
    userSelect: "none",
  };

  return (
    <div style={{ maxWidth: 1000 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>Pay run</h1>

      {!hasImported ? (
        <div style={{ marginTop: 12, opacity: 0.8 }}>
          Import a CSV first, then hit <b>APPLY RULES</b>.
        </div>
      ) : null}

      {lastAppliedAt ? (
        <div style={{ marginTop: 10, opacity: 0.8, fontSize: 12 }}>
          Last applied: <b>{new Date(lastAppliedAt).toLocaleString()}</b>
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ border: "1px solid #2a2a2a", borderRadius: 14, padding: 12, minWidth: 220 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Total hours</div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>
            {Number.isFinite(totalHours) ? totalHours.toFixed(2) : "—"}
          </div>
        </div>

        <div style={{ border: "1px solid #2a2a2a", borderRadius: 14, padding: 12, minWidth: 260 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Total payrun cost</div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>{money(summary.totalCost)}</div>
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
            Note: cost is computed at “Apply Rules” time. Updating base rate here changes display only.
          </div>
        </div>

        {/* XERO EXPORT CARD */}
        <div style={{ border: "1px solid #2a2a2a", borderRadius: 14, padding: 12, minWidth: 320 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Xero export (push)</div>

          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
            {xeroConnected ? (
              <>
                Connected
                {xeroTenantName ? (
                  <>
                    {" "}
                    to <b>{xeroTenantName}</b>
                  </>
                ) : null}
              </>
            ) : (
              <>
                Not connected (go to <b>Integrations</b> to connect)
              </>
            )}
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={pushTimesheetsToXero}
              disabled={xeroBtnDisabled}
              style={xeroBtnStyle}
              onMouseEnter={() => setXeroBtnHover(true)}
              onMouseLeave={() => setXeroBtnHover(false)}
              onMouseDown={() => !xeroBtnDisabled && setXeroBtnHover(true)}
              onMouseUp={() => !xeroBtnDisabled && setXeroBtnHover(false)}
            >
              {xeroPushBusy ? "Sending…" : "Send timesheets to Xero"}
            </button>

            {xeroPushMsg ? (
              <div style={{ fontSize: 12, opacity: 0.85, whiteSpace: "pre-wrap" }}>{xeroPushMsg}</div>
            ) : null}
          </div>
        </div>
      </div>

      {/* PER EMPLOYEE SUMMARY (click to expand) */}
      <div
        style={{
          marginTop: 12,
          border: "1px solid #2a2a2a",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 0.7fr 0.9fr 0.9fr",
            padding: 12,
            fontWeight: 700,
            borderBottom: "1px solid #2a2a2a",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div>Employee</div>
          <div>Total hours</div>
          <div>Total minutes</div>
          <div>Total pay</div>
        </div>

        {perEmployee.length === 0 ? (
          <div style={{ padding: 14, opacity: 0.8 }}>No pay lines yet. Import a CSV, then Apply Rules.</div>
        ) : null}

        {perEmployee.map((emp) => {
          const key = emp.employeeId || emp.employeeName;
          const isOpen = openEmpKey === key;

          return (
            <div key={key} style={{ borderBottom: "1px solid #2a2a2a" }}>
              {/* summary row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 0.7fr 0.9fr 0.9fr",
                  padding: 12,
                  alignItems: "center",
                }}
              >
                <button
                  onClick={() => setOpenEmpKey((cur) => (cur === key ? null : key))}
                  style={{
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    padding: 0,
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                  title="Click to expand breakdown"
                >
                  {isOpen ? "▾ " : "▸ "}
                  {emp.employeeName}
                </button>

                <div>{emp.totalHours.toFixed(2)}</div>
                <div>{Math.round(emp.totalMinutes)}</div>
                <div style={{ fontWeight: 900 }}>{money(emp.totalCost)}</div>
              </div>

              {/* breakdown */}
              {isOpen ? (
                <div style={{ padding: 12, paddingTop: 0 }}>
                  <div
                    style={{
                      border: "1px solid #2a2a2a",
                      borderRadius: 12,
                      overflow: "hidden",
                      marginTop: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "0.9fr 0.9fr 1.1fr 0.8fr 0.8fr 0.7fr 0.9fr",
                        padding: 10,
                        fontWeight: 700,
                        borderBottom: "1px solid #2a2a2a",
                        background: "rgba(255,255,255,0.02)",
                        fontSize: 12,
                      }}
                    >
                      <div>Date</div>
                      <div>Job</div>
                      <div>Category</div>
                      <div>Hours</div>
                      <div>Base rate</div>
                      <div>Mult</div>
                      <div>Cost</div>
                    </div>

                    {emp.lines.map((l: any, i: number) => {
                      const hours = hoursFromLine(l);

                      // ✅ Prefer Xero base rate from Employees cache
                      const xeroRate = xeroRateByName.get(normName(emp.employeeName)) ?? null;
                      const fallbackLineRate = l.baseRate != null ? n(l.baseRate) : null;
                      const chosenRate = xeroRate ?? (fallbackLineRate != null ? fallbackLineRate : null);

                      const baseRate =
                        chosenRate != null && Number.isFinite(chosenRate) && chosenRate > 0
                          ? `$${chosenRate.toFixed(2)}${xeroRate != null ? " (Xero)" : ""}`
                          : "—";

                      const mult = Number.isFinite(n(l.multiplier, NaN)) ? `${n(l.multiplier, 1).toFixed(2)}×` : "—";

                      return (
                        <div
                          key={`${key}-${lineDateKey(l) || "date"}-${l.jobCode ?? "job"}-${l.category ?? "cat"}-${i}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "0.9fr 0.9fr 1.1fr 0.8fr 0.8fr 0.7fr 0.9fr",
                            padding: 10,
                            borderBottom: "1px solid #2a2a2a",
                            fontSize: 12,
                            // Faint yellow highlight for leave rows (shown but excluded from calcs)
                            background: l?.isLeave ? "rgba(255, 235, 59, 0.14)" : "transparent",
                          }}
                        >
                          <div>{displayDateFromKey(lineDateKey(l))}</div>
                          <div>{l.jobCode ?? "—"}</div>
                          <div>{l.category ?? "—"}</div>
                          <div>{hours.toFixed(2)}</div>
                          <div>{baseRate}</div>
                          <div>{mult}</div>
                          <div style={{ fontWeight: 800 }}>{money(l.cost)}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                    Tip: Base rate is shown from Xero Employees when available. If you want totals/costs to update, re-run{" "}
                    <b>Apply Rules</b> after syncing employees.
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
