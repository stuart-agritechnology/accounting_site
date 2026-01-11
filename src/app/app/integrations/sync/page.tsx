// src/app/app/import/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePayrollData } from "../../PayrollDataProvider";
import type { PayCycle, PayrunSettings, ActivePayPeriod } from "../../_lib/payPeriod";
import {
  computePeriodFromStart,
  loadActivePayPeriod,
  loadPayrunSettings,
  saveActivePayPeriod,
  savePayrunSettings,
  suggestStartDateISO,
  toISODate,
} from "../../_lib/payPeriod";

type ConnStatus = "Connected" | "Not connected";

const LS_XERO_EMPLOYEES = "xero_employees_v1";
const LS_XERO_SYNC_META = "xero_employees_sync_meta_v1";

const WEEKDAYS: { label: string; value: number }[] = [
  { label: "Sunday", value: 0 },
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
];

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid #2a2a2a",
        borderRadius: 16,
        padding: 14,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>{props.title}</div>
      {props.children}
    </div>
  );
}

function labelStyle() {
  return { fontSize: 12, opacity: 0.75, marginBottom: 6 } as const;
}

function btnStyle(opts: { disabled: boolean; hover: boolean; variant: "primary" | "ghost" }) {
  const base: React.CSSProperties = {
    padding: "9px 12px",
    borderRadius: 12,
    fontWeight: 900,
    border: "1px solid #2a2a2a",
    cursor: opts.disabled ? "not-allowed" : "pointer",
    opacity: opts.disabled ? 0.55 : 1,
    userSelect: "none",
    transition: "transform 120ms ease, background 120ms ease, box-shadow 120ms ease, opacity 120ms ease",
    transform: !opts.disabled && opts.hover ? "translateY(-1px)" : "translateY(0px)",
  };

  if (opts.variant === "primary") {
    return {
      ...base,
      background: opts.disabled ? "#0b0b0b" : opts.hover ? "#0f0f0f" : "#111",
      color: "#fff",
      WebkitTextFillColor: "#fff",
      boxShadow: !opts.disabled && opts.hover ? "0 8px 24px rgba(0,0,0,0.22)" : "0 2px 10px rgba(0,0,0,0.14)",
    };
  }

  return {
    ...base,
    background: "transparent",
    color: "#111",
    WebkitTextFillColor: "#111",
  };
}

export default function ImportPage() {
  const router = useRouter();

  // ✅ Now we’ll call applyRules automatically after pulls
  const { importCsvFile, applyRules, clearAll, hasImported, timeEntries, lastAppliedAt } = usePayrollData();

  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [settings, setSettings] = useState<PayrunSettings>({
    cycle: "weekly",
    weekStartDow: 1,
    monthStartDom: 1,
  });

  const [startISO, setStartISO] = useState<string>(toISODate(new Date()));
  const [activePeriod, setActivePeriod] = useState<ActivePayPeriod | null>(null);

  // Fergus connection state
  const [fergusStatus, setFergusStatus] = useState<ConnStatus>("Not connected");
  const [loadingFergus, setLoadingFergus] = useState<boolean>(true);
  const [pullBusy, setPullBusy] = useState(false);
  const [pullMsg, setPullMsg] = useState<string>("");

  // Xero connection + sync state
  const [xeroStatus, setXeroStatus] = useState<ConnStatus>("Not connected");
  const [xeroTenantName, setXeroTenantName] = useState<string>("");
  const [loadingXero, setLoadingXero] = useState<boolean>(true);

  // Suggested start date from Xero
  const [xeroSuggestedStartISO, setXeroSuggestedStartISO] = useState<string>("");
  const [xeroSuggestMsg, setXeroSuggestMsg] = useState<string>("");

  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>("");

  // New: “auto compute” message
  const [autoComputeMsg, setAutoComputeMsg] = useState<string>("");

  // hover states
  const [hoverSetPeriod, setHoverSetPeriod] = useState(false);
  const [hoverPullFergus, setHoverPullFergus] = useState(false);
  const [hoverSyncXero, setHoverSyncXero] = useState(false);
  const [hoverApply, setHoverApply] = useState(false);
  const [hoverClear, setHoverClear] = useState(false);

  useEffect(() => {
    setMounted(true);

    const s = loadPayrunSettings();
    if (s) setSettings(s);

    const p = loadActivePayPeriod();
    if (p) {
      setActivePeriod(p);
      setStartISO(p.startISO);
    } else if (s) {
      setStartISO(suggestStartDateISO(s));
    } else {
      setStartISO(toISODate(new Date()));
    }
  }, []);

  // ✅ helper: build query to select the correct Xero payrun calendar
  function xeroSuggestUrl() {
    // cycle + weekStartDow let the API choose the right PayrollCalendar when multiple exist
    const qs = `cycle=${encodeURIComponent(settings.cycle)}&weekStartDow=${encodeURIComponent(String(settings.weekStartDow))}`;
    return `/api/xero/last-paid-date?${qs}`;
  }

// If Xero connected and no period set yet, suggest start date
useEffect(() => {
  let alive = true;

  async function run() {
    try {
      if (!mounted) return;
      if (activePeriod) return;
      if (xeroStatus !== "Connected") return;

      const qs = `cycle=${encodeURIComponent(settings.cycle)}&weekStartDow=${encodeURIComponent(String(settings.weekStartDow))}`;
      const res = await fetch(`/api/xero/last-paid-date?${qs}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok || !j?.ok) return;

      const nextStart = String(j?.nextPeriodStartISO ?? "").trim();
      const nextPayDay = String(j?.nextPayDayISO ?? "").trim();

      if (nextStart && /^\d{4}-\d{2}-\d{2}$/.test(nextStart)) {
        setXeroSuggestedStartISO(nextStart);
        setStartISO(nextStart);
      }

      if (nextStart || nextPayDay) {
        setXeroSuggestMsg(
          `From Xero payrun calendar: period start ${nextStart || "—"}${nextPayDay ? ` • next pay day ${nextPayDay}` : ""}.`,
        );
      }
    } catch {
      // ignore
    }
  }

  run();
  return () => {
    alive = false;
  };
}, [
  mounted,
  activePeriod,
  xeroStatus,
  settings.cycle,
  settings.weekStartDow,
]);

  useEffect(() => {
    if (!mounted) return;
    if (activePeriod) return;
    if (xeroSuggestedStartISO) return;
    setStartISO(suggestStartDateISO(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.cycle, settings.weekStartDow, settings.monthStartDom, mounted, activePeriod, xeroSuggestedStartISO]);

  // Load connection statuses
  useEffect(() => {
    let alive = true;

    setLoadingFergus(true);
    fetch("/api/fergus/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setFergusStatus(Boolean(j?.connected) ? "Connected" : "Not connected");
      })
      .catch(() => {
        if (!alive) return;
        setFergusStatus("Not connected");
      })
      .finally(() => {
        if (!alive) return;
        setLoadingFergus(false);
      });

    setLoadingXero(true);
    fetch("/api/xero/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const connected = Boolean(j?.connected);
        setXeroStatus(connected ? "Connected" : "Not connected");
        setXeroTenantName(String(j?.tenant?.tenantName ?? ""));
      })
      .catch(() => {
        if (!alive) return;
        setXeroStatus("Not connected");
        setXeroTenantName("");
      })
      .finally(() => {
        if (!alive) return;
        setLoadingXero(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const periodLabel = useMemo(() => {
    if (!activePeriod) return "—";
    return `${activePeriod.startISO} → ${activePeriod.endISO} (end inclusive)`;
  }, [activePeriod]);

  function computeAndPersistActivePeriod(nextSettings: PayrunSettings, start: string) {
    const { start: d0, endInclusive } = computePeriodFromStart(start, nextSettings.cycle);

    const p: ActivePayPeriod = {
      startISO: toISODate(d0),
      endISO: toISODate(endInclusive), // inclusive
      cycle: nextSettings.cycle,
      computedAtISO: new Date().toISOString(),
    };

    savePayrunSettings(nextSettings);
    saveActivePayPeriod(p);
    window.dispatchEvent(new Event("pay_period_updated"));

    setSettings(nextSettings);
    setActivePeriod(p);
    setStartISO(p.startISO);
  }

  /**
   * ✅ NEW: one place to recompute after a sync/pull
   */
  async function autoApplyRulesAndStay(msg: string) {
    setAutoComputeMsg(msg);
    try {
      await applyRules(); // uses runtime rules + employee rules automatically
      setAutoComputeMsg((m) => (m ? `${m} ✅ computed.` : "✅ computed."));
    } catch (e: any) {
      setAutoComputeMsg("");
      throw e;
    }
  }

  /**
   * ✅ Fergus pull → import → auto compute
   */
  const pullFromFergus = async () => {
    setPullMsg("");
    setAutoComputeMsg("");
    setError(null);
    setPullBusy(true);
    try {
      const p =
        activePeriod ??
        (() => {
          computeAndPersistActivePeriod(settings, startISO);
          return loadActivePayPeriod();
        })();

      if (!p) throw new Error("No active pay period set.");

      const res = await fetch(
        `/api/fergus/timeEntries?startISO=${encodeURIComponent(p.startISO)}&endISOInclusive=${encodeURIComponent(p.endISO)}`,
        { cache: "no-store" },
      );
      const j = await res.json().catch(() => ({}));

      if (!res.ok || !j?.ok) {
        throw new Error(String(j?.error ?? "Failed to pull from Fergus"));
      }

      const csvText = String(j?.csv ?? "");
      const file = new File([csvText], `fergus_time_entries_${p.startISO}_to_${p.endISO}_inclusive.csv`, { type: "text/csv" });
      await importCsvFile(file);

      const nCount = Number(j?.count ?? 0);
      setPullMsg(`Pulled ${nCount} time entries from Fergus.`);

      // ✅ Auto compute immediately after pulling (if there’s data)
      if (nCount > 0) {
        await autoApplyRulesAndStay("Pulled from Fergus.");
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to pull from Fergus");
    } finally {
      setPullBusy(false);
    }
  };

  /**
   * ✅ Xero sync → store employees → auto compute
   */
  async function syncEmployees() {
    setSyncMsg("");
    setAutoComputeMsg("");
    setError(null);

    if (xeroStatus !== "Connected") {
      setSyncMsg("Connect Xero first.");
      return;
    }

    setSyncBusy(true);
    try {
      const res = await fetch("/api/xero/employees", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      let json: any = null;
      try {
        json = await res.json();
      } catch {
        // ignore
      }

      if (!res.ok || json?.ok === false) {
        const err = json?.error ?? `Sync failed (${res.status})`;
        setSyncMsg(String(err));
        return;
      }

      const incoming = Array.isArray(json?.employees) ? json.employees : [];

      // Optional: auto-apply suggested pay period from Xero
      try {
        const suggestedStart = String(json?.suggestedStartISO ?? "");
        if (suggestedStart) {
          computeAndPersistActivePeriod(settings, suggestedStart);
        }
      } catch {
        // ignore
      }

      try {
        localStorage.setItem(LS_XERO_EMPLOYEES, JSON.stringify(incoming));
        localStorage.setItem(
          LS_XERO_SYNC_META,
          JSON.stringify({
            lastSyncAt: new Date().toISOString(),
            lastSyncedIds: incoming.map((e: any) => String(e?.employeeID ?? "")).filter(Boolean),
          }),
        );
        // same-tab notify
        window.dispatchEvent(new Event("xero-employees-updated"));
      } catch {
        // ignore
      }

      setSyncMsg(`Synced ${incoming.length} employees from Xero.`);

      // ✅ Auto compute after syncing employees (because rates/matching may change)
      if (incoming.length > 0 && hasImported) {
        await autoApplyRulesAndStay("Synced Xero employees.");
      }
    } catch (e: any) {
      setSyncMsg(e?.message ?? "Sync failed.");
    } finally {
      setSyncBusy(false);
    }
  }

  /**
   * ✅ Manual button: refresh suggested dates from Xero payrun calendar
   */
  async function refreshXeroSuggestedDates() {
    setError(null);
    setXeroSuggestMsg("");
    setXeroSuggestedStartISO("");

    if (xeroStatus !== "Connected") {
      setXeroSuggestMsg("Connect Xero first.");
      return;
    }

    try {
      // ✅ FIX: pass settings so backend chooses the correct payrun calendar
      const res = await fetch(xeroSuggestUrl(), { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? "Failed to load payroll calendar"));

      const nextStart = String(j?.nextPeriodStartISO ?? "").trim();
      const nextPayDay = String(j?.nextPayDayISO ?? "").trim();

      if (nextStart && /^\d{4}-\d{2}-\d{2}$/.test(nextStart)) {
        setXeroSuggestedStartISO(nextStart);
        setStartISO(nextStart);
      }

      if (nextStart || nextPayDay) {
        setXeroSuggestMsg(
          `From Xero payrun calendar: period start ${nextStart || "—"}${nextPayDay ? ` • next pay day ${nextPayDay}` : ""}.`,
        );
      } else {
        setXeroSuggestMsg("Xero didn’t return a next period start.");
      }
    } catch (e: any) {
      setXeroSuggestMsg(e?.message ?? "Failed to load from Xero.");
    }
  }

  const busy = pullBusy || syncBusy;

  async function onApplyRules() {
    setError(null);
    setAutoComputeMsg("");
    try {
      await applyRules();
      router.push("/app/payroll/payruns");
    } catch (e: any) {
      setError(e?.message ?? "Failed to compute pay lines");
    }
  }

  async function onClear() {
    setError(null);
    setPullMsg("");
    setSyncMsg("");
    setAutoComputeMsg("");
    try {
      clearAll();
    } catch (e: any) {
      setError(e?.message ?? "Failed to clear");
    }
  }

  const cycleLabel = useMemo(() => {
    const m: Record<PayCycle, string> = {
      weekly: "Weekly",
      fortnightly: "Fortnightly",
      monthly: "Monthly",
    };
    return m[settings.cycle] ?? settings.cycle;
  }, [settings.cycle]);

  return (
    <div style={{ padding: 18 }}>
      <div style={{ fontWeight: 900, fontSize: 18 }}>Import</div>
      <div style={{ opacity: 0.75, marginTop: 4, fontSize: 13 }}>
        Set your pay run period, then pull timesheets. (Fergus → rules → pay run)
      </div>

      {error ? (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #b00020", borderRadius: 14, color: "#b00020" }}>
          {error}
        </div>
      ) : null}

      {autoComputeMsg ? (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #2a2a2a", borderRadius: 14, opacity: 0.9 }}>
          {autoComputeMsg}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        <Card title="1) Pay run period">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <div>
              <div style={labelStyle()}>Cycle</div>
              <select
                value={settings.cycle}
                onChange={(e) => {
                  const next = { ...settings, cycle: e.target.value as PayCycle };
                  setSettings(next);
                  savePayrunSettings(next);
                }}
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid #2a2a2a",
                  background: "transparent",
                }}
              >
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="monthly">Monthly</option>
              </select>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>{cycleLabel}</div>
            </div>

            {settings.cycle !== "monthly" ? (
              <div>
                <div style={labelStyle()}>Week starts on</div>
                <select
                  value={settings.weekStartDow}
                  onChange={(e) => {
                    const next = { ...settings, weekStartDow: Number(e.target.value) };
                    setSettings(next);
                    savePayrunSettings(next);
                  }}
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #2a2a2a",
                    background: "transparent",
                  }}
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <div style={labelStyle()}>Month start day (1–31)</div>
                <input
                  value={String(settings.monthStartDom)}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(31, Math.round(Number(e.target.value)) || 1));
                    const next = { ...settings, monthStartDom: v };
                    setSettings(next);
                    savePayrunSettings(next);
                  }}
                  inputMode="numeric"
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #2a2a2a",
                    background: "transparent",
                  }}
                />
              </div>
            )}

            <div>
              <div style={labelStyle()}>Period start date</div>
              <input
                type="date"
                value={startISO}
                onChange={(e) => setStartISO(e.target.value)}
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid #2a2a2a",
                  background: "transparent",
                }}
              />

              {xeroSuggestMsg ? <div style={{ fontSize: 12, opacity: 0.72, marginTop: 6 }}>{xeroSuggestMsg}</div> : null}

              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={refreshXeroSuggestedDates}
                  disabled={busy || xeroStatus !== "Connected"}
                  style={btnStyle({ disabled: busy || xeroStatus !== "Connected", hover: false, variant: "ghost" })}
                >
                  Refresh from Xero
                </button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => computeAndPersistActivePeriod(settings, startISO)}
              disabled={busy}
              style={btnStyle({ disabled: busy, hover: hoverSetPeriod, variant: "primary" })}
              onMouseEnter={() => setHoverSetPeriod(true)}
              onMouseLeave={() => setHoverSetPeriod(false)}
            >
              Set active period
            </button>

            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Active period: <b>{periodLabel}</b>
            </div>
          </div>
        </Card>

        <Card title="2) Pull from Fergus (auto-compute)">
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10, lineHeight: 1.35 }}>
            This pulls Fergus <b>time entries</b> and converts them into your internal CSV format, then auto-runs{" "}
            <b>Rules + Employee Rules</b>.
          </div>

          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>
            Fergus status: <b>{loadingFergus ? "Checking…" : fergusStatus}</b>.
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={pullFromFergus}
              disabled={busy || fergusStatus !== "Connected" || loadingFergus}
              style={btnStyle({
                disabled: busy || fergusStatus !== "Connected" || loadingFergus,
                hover: hoverPullFergus,
                variant: "primary",
              })}
              onMouseEnter={() => setHoverPullFergus(true)}
              onMouseLeave={() => setHoverPullFergus(false)}
            >
              {pullBusy ? "Pulling…" : "Pull from Fergus"}
            </button>

            <div style={{ fontSize: 13, opacity: 0.85 }}>
              {pullMsg ? pullMsg : hasImported ? (
                <>
                  Imported <b>{timeEntries.length}</b> time entries
                </>
              ) : (
                <>Not imported yet</>
              )}
            </div>
          </div>
        </Card>

        <Card title="3) Xero employees (auto-compute)">
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
            {loadingXero
              ? "Checking Xero connection…"
              : xeroStatus === "Connected"
                ? `Xero connected${xeroTenantName ? ` to ${xeroTenantName}` : ""}. Syncing employees will auto-recompute pay lines.`
                : "Xero not connected."}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={syncEmployees}
              disabled={xeroStatus !== "Connected" || busy || loadingXero}
              style={btnStyle({
                disabled: xeroStatus !== "Connected" || busy || loadingXero,
                hover: hoverSyncXero,
                variant: "primary",
              })}
              onMouseEnter={() => setHoverSyncXero(true)}
              onMouseLeave={() => setHoverSyncXero(false)}
            >
              {syncBusy ? "Syncing…" : "Sync Xero employees"}
            </button>

            {xeroStatus !== "Connected" ? (
              <a
                href={`/api/xero/connect?returnTo=${encodeURIComponent("/app/integrations/sync")}`}
                style={{ fontSize: 13, opacity: 0.9, textDecoration: "none" }}
              >
                <span style={{ fontWeight: 800 }}>Connect Xero</span>
              </a>
            ) : null}

            {syncMsg ? <div style={{ fontSize: 12, opacity: 0.85 }}>{syncMsg}</div> : null}
          </div>
        </Card>

        <Card title="4) Compute (manual)">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={onApplyRules}
              disabled={busy || !hasImported}
              style={btnStyle({ disabled: busy || !hasImported, hover: hoverApply, variant: "primary" })}
              onMouseEnter={() => setHoverApply(true)}
              onMouseLeave={() => setHoverApply(false)}
              title={!hasImported ? "Pull timesheets first" : undefined}
            >
              Compute pay lines
            </button>

            <button
              onClick={onClear}
              disabled={busy}
              style={btnStyle({ disabled: busy, hover: hoverClear, variant: "ghost" })}
              onMouseEnter={() => setHoverClear(true)}
              onMouseLeave={() => setHoverClear(false)}
            >
              Clear
            </button>

            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Last applied: <b>{lastAppliedAt ? new Date(lastAppliedAt).toLocaleString() : "—"}</b>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
