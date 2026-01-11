"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePayrollData } from "../PayrollDataProvider";
import type { PayCycle, PayrunSettings, ActivePayPeriod } from "../_lib/payPeriod";
import {
  computePeriodFromStart,
  loadActivePayPeriod,
  loadPayrunSettings,
  saveActivePayPeriod,
  savePayrunSettings,
  suggestStartDateISO,
  toISODate,
} from "../_lib/payPeriod";

type ConnStatus = "Connected" | "Not connected";

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
  const base: CSSProperties = {
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

export default function PayrollOverviewPage() {
  const { hasImported, syncNow, syncing, lastSyncAt, lastSyncError } = usePayrollData() as any;

  const [mounted, setMounted] = useState(false);

  // connection status
  const [fergusStatus, setFergusStatus] = useState<ConnStatus>("Not connected");
  const [xeroStatus, setXeroStatus] = useState<ConnStatus>("Not connected");
  const [xeroTenantName, setXeroTenantName] = useState<string>("");
  const [loadingConns, setLoadingConns] = useState(true);

  // payrun settings + active period
  const [settings, setSettings] = useState<PayrunSettings>({
    cycle: "weekly",
    weekStartDow: 1,
    monthStartDom: 1,
  });

  const [startISO, setStartISO] = useState<string>(toISODate(new Date()));
  const [activePeriod, setActivePeriod] = useState<ActivePayPeriod | null>(null);

  // Xero suggestion
  const [xeroSuggestMsg, setXeroSuggestMsg] = useState<string>("");
  const [xeroSuggestedStartISO, setXeroSuggestedStartISO] = useState<string>("");

  // ui feedback
  const [msg, setMsg] = useState<string>("");
  const [hoverSetPeriod, setHoverSetPeriod] = useState(false);
  const [hoverSync, setHoverSync] = useState(false);

  // ✅ Auto-sync controls (OFF / 30s / 60s) — only runs on timer ticks, never on tab-change or re-render
  const LS_AUTO_SYNC_SEC = "payroll_autosync_interval_sec_v1";
  const [autoSyncIntervalSec, setAutoSyncIntervalSec] = useState<number>(0);
  const autoSyncInFlightRef = useRef(false);
  const syncNowRef = useRef<any>(syncNow);
  const activePeriodRef = useRef<ActivePayPeriod | null>(activePeriod);
  const fergusStatusRef = useRef<ConnStatus>(fergusStatus);
  const xeroStatusRef = useRef<ConnStatus>(xeroStatus);

  // keep refs fresh without re-triggering timers
  useEffect(() => {
    syncNowRef.current = syncNow;
    activePeriodRef.current = activePeriod;
    fergusStatusRef.current = fergusStatus;
    xeroStatusRef.current = xeroStatus;
  }, [syncNow, activePeriod, fergusStatus, xeroStatus]);

  useEffect(() => {
    setMounted(true);

    // restore auto-sync interval
    try {
      const raw = localStorage.getItem(LS_AUTO_SYNC_SEC);
      const v = raw ? Number(raw) : 0;
      if (Number.isFinite(v) && v > 0) setAutoSyncIntervalSec(v);
    } catch {}

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

  // load connection statuses (same as old Import page)
  useEffect(() => {
    let alive = true;
    setLoadingConns(true);

    Promise.allSettled([
      fetch("/api/fergus/status", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          setFergusStatus(Boolean(j?.connected) ? "Connected" : "Not connected");
        })
        .catch(() => {
          if (!alive) return;
          setFergusStatus("Not connected");
        }),

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
        }),
    ]).finally(() => {
      if (!alive) return;
      setLoadingConns(false);
    });

    return () => {
      alive = false;
    };
  }, []);

  const periodLabel = useMemo(() => {
    if (!activePeriod) return "—";
    return `${activePeriod.startISO} → ${activePeriod.endISO} (end inclusive)`;
  }, [activePeriod]);

  const cycleLabel = useMemo(() => {
    const m: Record<PayCycle, string> = {
      weekly: "Weekly",
      fortnightly: "Fortnightly",
      monthly: "Monthly",
    };
    return m[settings.cycle] ?? settings.cycle;
  }, [settings.cycle]);

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
    setMsg(`Active period set: ${p.startISO} → ${p.endISO}`);
  }

  function xeroSuggestUrl() {
    const qs = `cycle=${encodeURIComponent(settings.cycle)}&weekStartDow=${encodeURIComponent(String(settings.weekStartDow))}`;
    return `/api/xero/last-paid-date?${qs}`;
  }

  // If Xero connected and no period set yet, suggest start date (same behaviour as old Import page)
  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        if (!mounted) return;
        if (activePeriod) return;
        if (xeroStatus !== "Connected") return;

        const res = await fetch(xeroSuggestUrl(), { cache: "no-store" });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, activePeriod, xeroStatus, settings.cycle, settings.weekStartDow]);

  // If settings change and we haven't got an Xero suggestion, fall back to local suggested date
  useEffect(() => {
    if (!mounted) return;
    if (activePeriod) return;
    if (xeroSuggestedStartISO) return;
    setStartISO(suggestStartDateISO(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.cycle, settings.weekStartDow, settings.monthStartDom, mounted, activePeriod, xeroSuggestedStartISO]);

  async function refreshXeroSuggestedDates() {
    setMsg("");
    setXeroSuggestMsg("");
    setXeroSuggestedStartISO("");

    if (xeroStatus !== "Connected") {
      setXeroSuggestMsg("Connect Xero first.");
      return;
    }

    try {
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

  async function doSync(manual: boolean) {
    setMsg("");
    // Don’t sync until we have a period (otherwise Fergus pull has no range)
    const p = activePeriod ?? loadActivePayPeriod();
    if (!p?.startISO || !p?.endISO) {
      setMsg("Set an active pay period first.");
      return;
    }

    const r = await syncNowRef.current?.({ silent: !manual });
    if (r?.ok) {
      const parts: string[] = [];
      if (typeof r.syncedXero === "number") parts.push(`Xero: ${r.syncedXero}`);
      if (typeof r.pulledFergus === "number") parts.push(`Fergus: ${r.pulledFergus}`);
      setMsg(`${manual ? "Synced" : "Auto-synced"} (${parts.join(", ") || "ok"}).`);
    } else if (manual) {
      setMsg(r?.error ? `Sync failed: ${r.error}` : "Sync failed.");
    }
  }


  // ✅ Timer auto-sync: runs ONLY on timer ticks (never on mount/tab-change/re-render)
  useEffect(() => {
    // clear any existing timer on change
    let id: number | null = null;
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      if (!autoSyncIntervalSec || autoSyncIntervalSec <= 0) return;

      // Don't stack requests: if a previous tick is still running, skip this tick.
      if (autoSyncInFlightRef.current) return;

      // Only autosync if there is an active period and at least one system connected
      const p = activePeriodRef.current ?? loadActivePayPeriod();
      if (!p?.startISO || !p?.endISO) return;

      const f = fergusStatusRef.current;
      const x = xeroStatusRef.current;
      if (f !== "Connected" && x !== "Connected") return;

      // Ensure we always call the latest syncNow without resetting the interval.
      const fn = syncNowRef.current;
      if (!fn) return;

      autoSyncInFlightRef.current = true;
      try {
        await doSync(false);
      } finally {
        autoSyncInFlightRef.current = false;
      }
    }

    // Only start the timer if enabled
    if (autoSyncIntervalSec && autoSyncIntervalSec > 0) {
      // run one immediately, then schedule the fixed interval
      tick();
      id = window.setInterval(tick, autoSyncIntervalSec * 1000);
    }

    return () => {
      cancelled = true;
      if (id) window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSyncIntervalSec]);


  const isBusy = Boolean(syncing);

  return (
    <div style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 18 }}>Payroll Overview</div>
          <div style={{ opacity: 0.75, marginTop: 4, fontSize: 13 }}>
            Set the pay period, then sync Fergus + Xero, then review pay runs.
          </div>
        </div>


        <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
          <button
            onClick={() => doSync(true)}
            disabled={isBusy}
            style={btnStyle({ disabled: isBusy, hover: hoverSync, variant: "primary" })}
            onMouseEnter={() => setHoverSync(true)}
            onMouseLeave={() => setHoverSync(false)}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>

          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: 0.9 }}>
            <span style={{ opacity: 0.75, fontWeight: 700 }}>Auto-sync:</span>
            <select
              value={autoSyncIntervalSec}
              onChange={(e) => {
                const v = Number(e.target.value);
                setAutoSyncIntervalSec(v);
                try {
                  if (v > 0) localStorage.setItem(LS_AUTO_SYNC_SEC, String(v));
                  else localStorage.removeItem(LS_AUTO_SYNC_SEC);
                } catch {}
              }}
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                border: "1px solid #2a2a2a",
                background: "transparent",
                fontWeight: 800,
              }}
            >
              <option value={0}>Off</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
          </div>
        </div>

      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, display: "grid", gap: 6 }}>
        <div>
          Fergus: <b>{loadingConns ? "Checking…" : fergusStatus}</b> • Xero:{" "}
          <b>
            {loadingConns ? "Checking…" : xeroStatus}
            {xeroStatus === "Connected" && xeroTenantName ? ` (${xeroTenantName})` : ""}
          </b>
        </div>

        <div>
          Data: <b>{hasImported ? "✅ imported" : "⚠️ not imported yet"}</b>{" "}
          <span style={{ opacity: 0.65 }}>•</span>{" "}
          <Link href="/app/payruns" style={{ color: "inherit", textDecoration: "none", fontWeight: 800 }}>
            Go to Pay Runs →
          </Link>
        </div>

        {lastSyncAt ? <div>Last sync: {new Date(lastSyncAt).toLocaleString()}</div> : null}
        {msg ? <div>{msg}</div> : null}
        {lastSyncError ? <div style={{ color: "#ff6b6b" }}>Last sync error: {lastSyncError}</div> : null}
      </div>

      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        <Card title="1) Pay run period (restore of the old Import page)">
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
                  disabled={isBusy || xeroStatus !== "Connected"}
                  style={btnStyle({ disabled: isBusy || xeroStatus !== "Connected", hover: false, variant: "ghost" })}
                >
                  Refresh from Xero
                </button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => computeAndPersistActivePeriod(settings, startISO)}
              disabled={isBusy}
              style={btnStyle({ disabled: isBusy, hover: hoverSetPeriod, variant: "primary" })}
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

        <Card title="2) What to do next">
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 13, opacity: 0.9 }}>
            <li>Set the active pay period (above).</li>
            <li>Hit <b>Sync now</b> (pulls Fergus + updates Xero employees).</li>
            <li>
              Open <Link href="/app/payruns" style={{ color: "inherit", fontWeight: 800 }}>Pay Runs</Link> to review results.
            </li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
