"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../../_components/PageHeader";
import { usePayrollData } from "../../PayrollDataProvider";
import { saveActivePayPeriod } from "../../_lib/payPeriod";

type XeroEmployee = {
  employeeID: string;
  fullName: string;
  baseRate?: number | null;
  weeklyHours?: number | null;
  firstName?: string;
  lastName?: string;
  status?: string;
};

type SyncMeta = {
  lastSyncAt: string | null;
  lastSyncedIds: string[];
};

const LS_XERO_EMPLOYEES = "xero_employees_v1";
const LS_XERO_SYNC_META = "xero_employees_sync_meta_v1";

function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function pill(text: string, tone: "green" | "red" | "purple") {
  const bg =
    tone === "green"
      ? "rgba(34,197,94,0.18)"
      : tone === "red"
      ? "rgba(239,68,68,0.18)"
      : "rgba(168,85,247,0.18)";
  const border =
    tone === "green"
      ? "rgba(34,197,94,0.35)"
      : tone === "red"
      ? "rgba(239,68,68,0.35)"
      : "rgba(255,255,255,0.18)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: bg,
        border: `1px solid ${border}`,
      }}
    >
      {text}
    </span>
  );
}

// 0 = needs attention (red), 1 = OK (green/purple)
function matchPriority(row: { mgmt?: any; xero?: any; noTimesheets?: boolean }) {
  const fromMgmt = !!row.mgmt;
  const fromXero = !!row.xero;
  if (fromMgmt && fromXero) return 1; // matched
  if (fromXero && !fromMgmt && row.noTimesheets) return 1; // purple = OK
  return 0;
}

async function mergeDbSettingsIntoXeroList(current: XeroEmployee[]): Promise<XeroEmployee[]> {
  try {
    const res = await fetch("/api/payroll/employees", { method: "GET", cache: "no-store" });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok || !Array.isArray(j?.employees)) return current;

    const rows = j.employees as any[];
    const byId = new Map<string, any>();
    for (const r of rows) {
      const id = String(r?.xeroEmployeeId ?? "").trim();
      if (id) byId.set(id, r);
    }

    return current.map((x) => {
      const id = String(x.employeeID ?? "").trim();
      const r = byId.get(id);
      if (!r) return x;
      return {
        ...x,
        baseRate: typeof r?.baseRate === "number" ? r.baseRate : x.baseRate,
        weeklyHours: typeof r?.weeklyHours === "number" ? r.weeklyHours : x.weeklyHours,
        ...(typeof r?.noTimesheets === "boolean" ? { noTimesheets: r.noTimesheets } : {}),
      } as any;
    });
  } catch {
    return current;
  }
}

export default function EmployeesPage() {
  const payroll = usePayrollData();
  const [xeroEmployees, setXeroEmployees] = useState<XeroEmployee[]>([]);
  const [syncMeta, setSyncMeta] = useState<SyncMeta>({ lastSyncAt: null, lastSyncedIds: [] });
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem(LS_XERO_EMPLOYEES);
        if (raw) {
          const parsed = JSON.parse(raw);
          const merged = await mergeDbSettingsIntoXeroList(Array.isArray(parsed) ? parsed : []);
          setXeroEmployees(merged);
          try {
            localStorage.setItem(LS_XERO_EMPLOYEES, JSON.stringify(merged));
          } catch {}
        }
      } catch {}

      try {
        const raw = localStorage.getItem(LS_XERO_SYNC_META);
        if (raw) setSyncMeta(JSON.parse(raw));
      } catch {}
    })();
  }, []);

  function persistXero(next: XeroEmployee[]) {
    setXeroEmployees(next);
    try {
      localStorage.setItem(LS_XERO_EMPLOYEES, JSON.stringify(next));
    } catch {}
  }

  function persistSyncMeta(next: SyncMeta) {
    setSyncMeta(next);
    try {
      localStorage.setItem(LS_XERO_SYNC_META, JSON.stringify(next));
    } catch {}
  }

  async function syncFromXero() {
    setSyncing(true);
    setErr(null);

    try {
      const res = await fetch("/api/xero/employees", { method: "GET", cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Xero sync failed (${res.status})`);

      const incoming: XeroEmployee[] = (json.employees ?? []).map((e: any) => ({
        employeeID: String(e.employeeID ?? ""),
        fullName: String(e.fullName ?? `${e.firstName ?? ""} ${e.lastName ?? ""}`).trim(),
        firstName: e.firstName,
        lastName: e.lastName,
        status: e.status,
        baseRate: typeof e.baseRate === "number" ? e.baseRate : null,
        weeklyHours: typeof e.weeklyHours === "number" ? e.weeklyHours : null,
        noTimesheets: typeof e.noTimesheets === "boolean" ? e.noTimesheets : false,
      }));

      const existingIds = new Set(xeroEmployees.map((e) => e.employeeID));
      const newlySyncedIds = incoming
        .filter((e) => e.employeeID && !existingIds.has(e.employeeID))
        .map((e) => e.employeeID);

      const mergedIncoming = await mergeDbSettingsIntoXeroList(incoming as any);
      persistXero(mergedIncoming);

      if (json?.suggestedPeriod?.startISO && json?.suggestedPeriod?.endISOExclusive) {
        try {
          saveActivePayPeriod({
            startISO: String(json.suggestedPeriod.startISO),
            endISO: String(json.suggestedPeriod.endISOExclusive),
            // If Xero doesn't return a cycle, default to weekly to avoid doubling salaried weeklyHours.
            cycle: (json.suggestedPeriod.cycle as any) || "weekly",
            computedAtISO: new Date().toISOString(),
          });
        } catch {}
      }

      persistSyncMeta({ lastSyncAt: new Date().toISOString(), lastSyncedIds: newlySyncedIds });
      window.setTimeout(() => {
        persistSyncMeta((prev) => ({ ...prev, lastSyncedIds: [] }));
      }, 10000);
    } catch (e: any) {
      setErr(e?.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  // NOTE: payroll.employees is your DB/overrides list.
  // Matching MUST be Fergus-vs-Xero, so we only use payroll.employees for overrides like noTimesheets.
  const dbEmployees = payroll.employees ?? [];

  // ✅ Fergus presence = appears in rawTimeEntries (NOT the DB list)
  const fergusEmployees = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ name: string }> = [];

    const entries = payroll.rawTimeEntries ?? [];
    for (const te of entries) {
      const name = String((te as any)?.employeeName ?? "").trim();
      if (!name) continue;
      const key = normalizeName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name });
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [payroll.rawTimeEntries]);

  const merged = useMemo(() => {
    const map = new Map<
      string,
      { key: string; name: string; mgmt?: { name: string }; xero?: XeroEmployee; newlySynced?: boolean; noTimesheets?: boolean }
    >();

    for (const m of fergusEmployees) {
      const key = normalizeName(m.name);
      map.set(key, { key, name: m.name.trim(), mgmt: { name: m.name.trim() } });
    }

    for (const x of xeroEmployees) {
      const key = normalizeName(x.fullName);
      const row = map.get(key);
      if (row) row.xero = x;
      else map.set(key, { key, name: x.fullName, xero: x });
    }

    const out = Array.from(map.values());

    // Apply noTimesheets override from DB keyed by xeroEmployeeId
    const byXeroId = new Map<string, any>();
    for (const e of dbEmployees as any[]) {
      const xid = String((e as any)?.xeroEmployeeId ?? "").trim();
      if (xid) byXeroId.set(xid, e);
    }

    const newly = new Set(syncMeta.lastSyncedIds);
    for (const r of out) {
      r.newlySynced = r.xero?.employeeID ? newly.has(r.xero.employeeID) : false;
      const xid = r.xero?.employeeID ? String(r.xero.employeeID) : "";
      const hit = xid ? byXeroId.get(xid) : null;
      r.noTimesheets = Boolean(hit?.noTimesheets);
    }

    out.sort((a, b) => {
      const pa = matchPriority(a);
      const pb = matchPriority(b);
      if (pa !== pb) return pa - pb; // attention first
      return a.name.localeCompare(b.name);
    });

    return out;
  }, [fergusEmployees, xeroEmployees, dbEmployees, syncMeta.lastSyncedIds]);

  return (
    <div style={{ padding: 18 }}>
      <PageHeader
        title="Employees"
        subtitle="Green = Fergus + Xero match. Red = mismatch. Purple = Xero only (no timesheets)."
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {syncMeta.lastSyncAt ? (
              <div style={{ opacity: 0.8, fontSize: 12 }}>
                Last sync: {new Date(syncMeta.lastSyncAt).toLocaleString("en-AU")}
              </div>
            ) : (
              <div style={{ opacity: 0.8, fontSize: 12 }}>Not synced yet</div>
            )}
            <button
              onClick={syncFromXero}
              disabled={syncing}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: syncing ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)",
                fontWeight: 800,
              }}
            >
              {syncing ? "Syncing…" : "Sync from Xero"}
            </button>
          </div>
        }
      />

      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(239,68,68,0.35)",
            background: "rgba(239,68,68,0.12)",
            fontWeight: 700,
          }}
        >
          {err}
        </div>
      ) : null}

      {(() => {
        const fergusOnly = merged.filter((r) => !!r.mgmt && !r.xero);
        const xeroOnly = merged.filter((r) => !r.mgmt && !!r.xero && !r.noTimesheets);
        const total = fergusOnly.length + xeroOnly.length;
        if (!total) return null;
        return (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(239,68,68,0.35)",
              background: "rgba(239,68,68,0.12)",
              fontWeight: 800,
            }}
          >
            Needs matching: {fergusOnly.length} Fergus-only, {xeroOnly.length} Xero-only.
          </div>
        );
      })()}

      <div
        style={{
          marginTop: 14,
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1.4fr 1fr",
            padding: 12,
            fontWeight: 900,
            opacity: 0.85,
          }}
        >
          <div>Name</div>
          <div>Fergus</div>
          <div>Xero</div>
          <div>Xero Employee ID</div>
          <div>Status</div>
        </div>

        {merged.map((r) => {
          const fromFergus = !!r.mgmt;
          const fromXero = !!r.xero;
          const isNoTimesheets = Boolean((r as any).noTimesheets);

          const status =
            fromFergus && fromXero
              ? pill("Matched", "green")
              : fromXero && !fromFergus && isNoTimesheets
              ? pill("No timesheets", "purple")
              : fromXero
              ? pill("Xero only", "red")
              : pill("Fergus only", "red");

          return (
            <div
              key={r.key}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1.4fr 1fr",
                padding: 12,
                borderTop: "1px solid rgba(255,255,255,0.08)",
                background: r.newlySynced
                  ? "rgba(34,197,94,0.08)"
                  : fromXero && !fromFergus && isNoTimesheets
                  ? "rgba(168,85,247,0.06)"
                  : !fromFergus || !fromXero
                  ? "rgba(239,68,68,0.06)"
                  : "transparent",
                transition: "background 400ms ease",
              }}
            >
              <div style={{ fontWeight: 800 }}>{r.name}</div>

              <div style={{ opacity: 0.9 }}>{fromFergus ? <span>✓</span> : <span style={{ opacity: 0.55 }}>—</span>}</div>

              <div style={{ opacity: 0.9 }}>
                {fromXero ? (
                  <span>
                    ✓{" "}
                    {typeof r.xero?.baseRate === "number" ? (
                      <span style={{ opacity: 0.75 }}>${r.xero.baseRate}/hr</span>
                    ) : (
                      <span style={{ opacity: 0.55 }}>rate not set</span>
                    )}
                  </span>
                ) : (
                  <span style={{ opacity: 0.55 }}>—</span>
                )}
              </div>

              <div style={{ opacity: 0.9, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                {fromXero && r.xero?.employeeID ? r.xero.employeeID : <span style={{ opacity: 0.55 }}>—</span>}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-start", gap: 10, alignItems: "center" }}>
                {fromXero ? (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 6, opacity: 0.95 }}>
                    <input
                      type="checkbox"
                      checked={Boolean((r as any).noTimesheets)}
                      onChange={(ev) => {
                        if (!r.xero?.employeeID) return;
                        const xid = String(r.xero.employeeID);

                        const existing =
                          (payroll.employees ?? []).find((e: any) => String(e?.xeroEmployeeId ?? e?.id ?? "") === xid) ?? null;

                        payroll.upsertEmployee({
                          id: existing?.id ?? xid,
                          name: existing?.name ?? r.name,
                          baseRate:
                            typeof existing?.baseRate === "number"
                              ? existing.baseRate
                              : typeof r.xero?.baseRate === "number"
                              ? (r.xero.baseRate as any)
                              : null,
                          xeroEmployeeId: xid,
                          status: r.xero?.status,
                          noTimesheets: ev.target.checked,
                          weeklyHours:
                            typeof (existing as any)?.weeklyHours === "number"
                              ? (existing as any).weeklyHours
                              : typeof r.xero?.weeklyHours === "number"
                              ? r.xero.weeklyHours
                              : null,
                        } as any);
                      }}
                    />
                    <span style={{ fontSize: 12, fontWeight: 800 }}>
                      Auto (no timesheets){typeof r.xero?.weeklyHours === "number" ? ` • ${r.xero.weeklyHours}h/wk` : ""}
                    </span>
                  </label>
                ) : null}

                {status}
                {r.newlySynced ? pill("New", "green") : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
