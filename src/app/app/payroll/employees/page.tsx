"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../../_components/PageHeader";
import { usePayrollData } from "../../PayrollDataProvider";
import { saveActivePayPeriod } from "../../_lib/payPeriod";

type XeroEmployee = {
  employeeID: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  status?: string;
};

type SyncMeta = {
  lastSyncAt: string | null;
  lastSyncedIds: string[]; // ids that were "new" in last sync
};

const LS_XERO_EMPLOYEES = "xero_employees_v1";
const LS_XERO_SYNC_META = "xero_employees_sync_meta_v1";

function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function pill(text: string, tone: "green" | "gray" | "amber") {
  const bg =
    tone === "green"
      ? "rgba(34,197,94,0.15)"
      : tone === "amber"
      ? "rgba(245,158,11,0.15)"
      : "rgba(255,255,255,0.08)";
  const border =
    tone === "green"
      ? "rgba(34,197,94,0.35)"
      : tone === "amber"
      ? "rgba(245,158,11,0.35)"
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

// ✅ NEW: sort priority so "not synced/matched" always floats to the top
function matchPriority(row: { mgmt?: any; xero?: any }) {
  const fromMgmt = !!row.mgmt;
  const fromXero = !!row.xero;

  // 0 = needs attention (not matched)
  // 1 = matched (green)
  if (fromMgmt && fromXero) return 1;
  return 0;
}

export default function EmployeesPage() {
  const payroll = usePayrollData();
  const [xeroEmployees, setXeroEmployees] = useState<XeroEmployee[]>([]);
  const [syncMeta, setSyncMeta] = useState<SyncMeta>({ lastSyncAt: null, lastSyncedIds: [] });
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load persisted Xero state on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_XERO_EMPLOYEES);
      if (raw) setXeroEmployees(JSON.parse(raw));
    } catch {}

    try {
      const raw = localStorage.getItem(LS_XERO_SYNC_META);
      if (raw) setSyncMeta(JSON.parse(raw));
    } catch {}
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

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Xero sync failed (${res.status})`);
      }

      const incoming: XeroEmployee[] = (json.employees ?? []).map((e: any) => ({
        employeeID: String(e.employeeID ?? ""),
        fullName: String(e.fullName ?? `${e.firstName ?? ""} ${e.lastName ?? ""}`).trim(),
        firstName: e.firstName,
        lastName: e.lastName,
        status: e.status,
      }));

      const existingIds = new Set(xeroEmployees.map((e) => e.employeeID));
      const newlySyncedIds = incoming
        .filter((e) => e.employeeID && !existingIds.has(e.employeeID))
        .map((e) => e.employeeID);

      persistXero(incoming);

      if (json?.suggestedPeriod?.startISO && json?.suggestedPeriod?.endISOExclusive) {
        try {
          saveActivePayPeriod({
            startISO: String(json.suggestedPeriod.startISO),
            endISO: String(json.suggestedPeriod.endISOExclusive),
            cycle: (json.suggestedPeriod.cycle as any) || "fortnightly",
            computedAtISO: new Date().toISOString(),
          });
        } catch {
          // ignore
        }
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

  const mgmtRates = payroll.employees ?? [];

  // ✅ Management Software employees are derived from pulled time entries (Fergus)
  const mgmtEmployees = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ name: string; id?: string; baseRate?: number }> = [];

    const entries = payroll.rawTimeEntries ?? [];
    for (const te of entries) {
      const name = String((te as any)?.employeeName ?? "").trim();
      if (!name) continue;
      const key = normalizeName(name);
      if (seen.has(key)) continue;
      seen.add(key);

      // try to attach any stored baseRate (if you maintain rates separately)
      const rateRow = mgmtRates.find((e: any) => normalizeName(String(e?.name ?? "")) === key);
      out.push({
        name,
        id: rateRow?.id,
        baseRate: typeof rateRow?.baseRate === "number" ? rateRow.baseRate : undefined,
      });
    }

    // also include any manually maintained rate rows even if they have no time entries yet
    for (const e of mgmtRates) {
      const name = String((e as any)?.name ?? "").trim();
      if (!name) continue;
      const key = normalizeName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, id: (e as any)?.id, baseRate: typeof (e as any)?.baseRate === "number" ? (e as any).baseRate : undefined });
    }

    // stable sort
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [payroll.rawTimeEntries, mgmtRates]);

  const merged = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        name: string;
        mgmt?: { id?: string; baseRate?: number };
        xero?: XeroEmployee;
        newlySynced?: boolean;
      }
    >();

    for (const c of mgmtEmployees) {
      const key = normalizeName(c.name);
      map.set(key, { key, name: c.name.trim(), mgmt: { id: c.id, baseRate: (c as any).baseRate } });
    }

    for (const x of xeroEmployees) {
      const key = normalizeName(x.fullName);
      const row = map.get(key);
      if (row) row.xero = x;
      else map.set(key, { key, name: x.fullName, xero: x });
    }

    const out = Array.from(map.values());

    // ✅ NEW: compute "newlySynced" BEFORE sort (doesn't matter, but clean)
    const newly = new Set(syncMeta.lastSyncedIds);
    for (const r of out) {
      r.newlySynced = r.xero?.employeeID ? newly.has(r.xero.employeeID) : false;
    }

    // ✅ NEW SORT:
    // 1) Unmatched (CSV-only or Xero-only) always at top
    // 2) Matched (green) always below
    // 3) Then alphabetical within each group
    out.sort((a, b) => {
      const pa = matchPriority(a);
      const pb = matchPriority(b);
      if (pa !== pb) return pa - pb; // 0 first, 1 last
      return a.name.localeCompare(b.name);
    });

    return out;
  }, [mgmtEmployees, xeroEmployees, syncMeta.lastSyncedIds]);

  return (
    <div style={{ padding: 18 }}>
      <PageHeader
        title="Employees"
        subtitle="One view of Management Software + Xero employees. Sync pulls from Xero and highlights changes."
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

      {/* ✅ NEW: unmatched summary */}
      {(() => {
        const mgmtOnly = merged.filter((r) => !!r.mgmt && !r.xero);
        const xeroOnly = merged.filter((r) => !r.mgmt && !!r.xero);
        const total = mgmtOnly.length + xeroOnly.length;
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
            Needs matching: {mgmtOnly.length} management-only, {xeroOnly.length} Xero-only.
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
        {/* ✅ Added Xero ID column */}
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
          <div>Management</div>
          <div>Xero</div>
          <div>Xero Employee ID</div>
          <div>Status</div>
        </div>

        {merged.map((r) => {
          const fromMgmt = !!r.mgmt;
          const fromXero = !!r.xero;

          const status =
            fromMgmt && fromXero
              ? pill("Matched", "green")
              : fromXero
              ? pill("Xero only", "amber")
              : pill("Management only", "gray");

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
                  : !fromMgmt || !fromXero
                  ? "rgba(239,68,68,0.06)"
                  : "transparent",
                transition: "background 400ms ease",
              }}
            >
              <div style={{ fontWeight: 800 }}>{r.name}</div>

              <div style={{ opacity: 0.9 }}>
                {fromMgmt ? (
                  <span>
                    ✓{" "}
                    {typeof r.mgmt!.baseRate === "number" ? (
                      <span style={{ opacity: 0.75 }}>${r.mgmt!.baseRate}/hr</span>
                    ) : (
                      <span style={{ opacity: 0.55 }}>rate not set</span>
                    )}
                  </span>
                ) : (
                  <span style={{ opacity: 0.55 }}>—</span>
                )}
              </div>

              <div style={{ opacity: 0.9 }}>{fromXero ? <span>✓</span> : <span style={{ opacity: 0.55 }}>—</span>}</div>

              {/* ✅ NEW: Xero Employee ID */}
              <div
                style={{
                  opacity: 0.9,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                }}
              >
                {fromXero && r.xero?.employeeID ? r.xero.employeeID : <span style={{ opacity: 0.55 }}>—</span>}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-start", gap: 10, alignItems: "center" }}>
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
