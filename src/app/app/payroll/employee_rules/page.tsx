"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../../_components/PageHeader";
import { usePayrollData } from "../../PayrollDataProvider";
import type { CompanyRuleset } from "~/payroll_calc/types";
import { useRouter } from "next/navigation";

/**
 * Employee Rules:
 * - Wage is NOT stored here.
 * - Wage always comes from Xero import store (localStorage), so it auto-updates when Xero import changes.
 * - This page only stores employee-specific overrides like advanced OT/day rules.
 */

type EmployeeRules = {
  employeeId: string;
  employeeName?: string;

  advancedEnabled: boolean;

  // Only used if advancedEnabled = true
  standardMinutesPerDay: number;
  overtime: CompanyRuleset["overtime"];

  updatedAtISO: string;
};

type XeroRateRow = {
  employeeName: string;
  baseRate: number;
};

type EmployeeDirectoryRow = {
  id: string;
  name: string;
  lastSeenISO: string;
};

const LS_RULES_BY_EMPLOYEE = "rules_by_employee_v1";
const LS_SELECTED_EMPLOYEE = "rules_selected_employee_v1";

// This is what your Import page should write to:
const LS_XERO_EMPLOYEE_RATES = "xero_employee_rates_v1";

// Optional but recommended: keep any imported employee selectable forever
const LS_EMPLOYEE_DIRECTORY = "employee_directory_v1";

function safeNumber(v: string, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function fmtUpdated(iso: string) {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
      d.getMinutes(),
    )}`;
  } catch {
    return iso;
  }
}

function normalizeName(s: string) {
  return s.trim().toLowerCase();
}

function loadJsonMap<T extends object>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {} as T;
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === "object" ? parsed : ({} as T);
  } catch {
    return {} as T;
  }
}

function saveJsonMap(key: string, value: object) {
  localStorage.setItem(key, JSON.stringify(value));
}

function defaultEmployeeRules(employeeId: string, employeeName?: string): EmployeeRules {
  const ordinary = 8 * 60;
  return {
    employeeId,
    employeeName,
    advancedEnabled: false,
    standardMinutesPerDay: ordinary,
    overtime: {
      ordinaryMinutesPerDay: ordinary,
      tiers: [
        { label: "OT1", firstMinutes: 2 * 60, multiplier: 1.5 },
        { label: "OT2", multiplier: 2.0 },
      ],
    },
    updatedAtISO: new Date().toISOString(),
  };
}

export default function EmployeeRulesPage() {
  const { hasImported, applyRules, employees } = usePayrollData() as any;
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("");

  const [xeroRates, setXeroRates] = useState<Record<string, XeroRateRow>>({});
  const [employeeDirectory, setEmployeeDirectory] = useState<Record<string, EmployeeDirectoryRow>>({});
  const [rulesByEmployee, setRulesByEmployee] = useState<Record<string, EmployeeRules>>({});

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [employeeRules, setEmployeeRules] = useState<EmployeeRules | null>(null);

  // Current import employees from provider
  const importedEmployees = useMemo(() => {
    const list = Array.isArray(employees) ? employees : [];
    return list
      .map((e: any) => ({
        id: String(e.id),
        name: String(e.name ?? e.id),
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [employees]);

  // Initial load
  useEffect(() => {
    setXeroRates(loadJsonMap<Record<string, XeroRateRow>>(LS_XERO_EMPLOYEE_RATES));
    setEmployeeDirectory(loadJsonMap<Record<string, EmployeeDirectoryRow>>(LS_EMPLOYEE_DIRECTORY));
    setRulesByEmployee(loadJsonMap<Record<string, EmployeeRules>>(LS_RULES_BY_EMPLOYEE));

    const remembered = localStorage.getItem(LS_SELECTED_EMPLOYEE) ?? "";
    setSelectedEmployeeId(remembered);
  }, []);

  // Auto-refresh xero rates if Import page updates localStorage
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_XERO_EMPLOYEE_RATES) {
        setXeroRates(loadJsonMap<Record<string, XeroRateRow>>(LS_XERO_EMPLOYEE_RATES));
      }
    };
    window.addEventListener("storage", onStorage);

    // Same-tab updates won't fire "storage" event reliably,
    // so we also listen for a custom event (trigger it in Import page after writing).
    const onXeroRatesUpdated = () => {
      setXeroRates(loadJsonMap<Record<string, XeroRateRow>>(LS_XERO_EMPLOYEE_RATES));
    };
    window.addEventListener("xero_rates_updated", onXeroRatesUpdated as any);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("xero_rates_updated", onXeroRatesUpdated as any);
    };
  }, []);

  // Remember every imported employee (directory)
  useEffect(() => {
    if (!importedEmployees.length) return;

    setEmployeeDirectory((prev) => {
      const next = { ...prev };
      const nowISO = new Date().toISOString();

      for (const e of importedEmployees) {
        next[e.id] = { id: e.id, name: e.name, lastSeenISO: nowISO };
      }

      saveJsonMap(LS_EMPLOYEE_DIRECTORY, next);
      return next;
    });
  }, [importedEmployees]);

  const knownEmployees = useMemo(() => {
    const rows = Object.values(employeeDirectory);
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [employeeDirectory]);

  // If none selected, pick first
  useEffect(() => {
    if (selectedEmployeeId) return;

    const first = importedEmployees[0]?.id || knownEmployees[0]?.id || "";
    if (!first) return;

    setSelectedEmployeeId(first);
    localStorage.setItem(LS_SELECTED_EMPLOYEE, first);
  }, [selectedEmployeeId, importedEmployees, knownEmployees]);

  // When selection changes, load saved rules/defaults
  useEffect(() => {
    if (!selectedEmployeeId) {
      setEmployeeRules(null);
      return;
    }

    localStorage.setItem(LS_SELECTED_EMPLOYEE, selectedEmployeeId);

    const saved = rulesByEmployee[selectedEmployeeId];
    if (saved) {
      setEmployeeRules(saved);
      return;
    }

    const nameFromDirectory = employeeDirectory[selectedEmployeeId]?.name;
    setEmployeeRules(defaultEmployeeRules(selectedEmployeeId, nameFromDirectory));
  }, [selectedEmployeeId, rulesByEmployee, employeeDirectory]);

  const selectedEmployeeName = useMemo(() => {
    return employeeDirectory[selectedEmployeeId]?.name ?? employeeRules?.employeeName ?? selectedEmployeeId;
  }, [employeeDirectory, selectedEmployeeId, employeeRules?.employeeName]);

  const xeroBaseRate = useMemo(() => {
    const name = selectedEmployeeName || "";
    if (!name) return null;
    const row = xeroRates[normalizeName(name)];
    return row ? Number(row.baseRate) : null;
  }, [xeroRates, selectedEmployeeName]);

  function updateCurrent(patch: Partial<EmployeeRules>) {
    setEmployeeRules((r) => {
      if (!r) return r;
      return { ...r, ...patch, updatedAtISO: new Date().toISOString() };
    });
  }

  function updateOvertime(patch: Partial<CompanyRuleset["overtime"]>) {
    setEmployeeRules((r) => {
      if (!r) return r;
      const overtime = { ...r.overtime, ...patch };
      return { ...r, overtime, updatedAtISO: new Date().toISOString() };
    });
  }

  function updateTier(idx: number, patch: Partial<CompanyRuleset["overtime"]["tiers"][number]>) {
    setEmployeeRules((r) => {
      if (!r) return r;
      const tiers = [...r.overtime.tiers];
      tiers[idx] = { ...tiers[idx], ...patch };
      return { ...r, overtime: { ...r.overtime, tiers }, updatedAtISO: new Date().toISOString() };
    });
  }

  function addTier() {
    setEmployeeRules((r) => {
      if (!r) return r;
      const tiers = [
        ...r.overtime.tiers,
        { label: `OT${r.overtime.tiers.length + 1}`, firstMinutes: 60, multiplier: 1.5 },
      ];
      return { ...r, overtime: { ...r.overtime, tiers }, updatedAtISO: new Date().toISOString() };
    });
  }

  function removeTier(idx: number) {
    setEmployeeRules((r) => {
      if (!r) return r;
      const tiers = r.overtime.tiers.filter((_, i) => i !== idx);
      return { ...r, overtime: { ...r.overtime, tiers }, updatedAtISO: new Date().toISOString() };
    });
  }

  async function save(andApply: boolean) {
    if (!employeeRules || !selectedEmployeeId) return;

    setSaving(true);
    setStatus("");

    if (employeeRules.advancedEnabled) {
      if (employeeRules.standardMinutesPerDay <= 0) {
        setSaving(false);
        setStatus("Standard day hours must be > 0.");
        return;
      }
      if (employeeRules.overtime.tiers.length === 0) {
        setSaving(false);
        setStatus("Add at least one overtime entry.");
        return;
      }
      if (employeeRules.overtime.tiers.some((t) => !t.label?.trim() || !(t.multiplier > 0))) {
        setSaving(false);
        setStatus("Each overtime entry needs a label and multiplier > 0.");
        return;
      }
    }

    try {
      const normalized: EmployeeRules = {
        ...employeeRules,
        employeeId: selectedEmployeeId,
        employeeName: selectedEmployeeName,
        overtime: employeeRules.advancedEnabled
          ? { ...employeeRules.overtime, ordinaryMinutesPerDay: employeeRules.standardMinutesPerDay }
          : employeeRules.overtime,
        updatedAtISO: new Date().toISOString(),
      };

      const nextMap = { ...rulesByEmployee, [selectedEmployeeId]: normalized };
      setRulesByEmployee(nextMap);
      saveJsonMap(LS_RULES_BY_EMPLOYEE, nextMap);
      setEmployeeRules(normalized);

      if (andApply) {
        if (!hasImported) {
          setStatus("Saved ✅ (import a timesheet CSV to apply)");
        } else {
          await applyRules();
          setStatus("Saved ✅ and applied ✅ (pay runs updated)");

          // ✅ ONLY CHANGE: after Save & Apply, go to payruns page
          router.push("/app/payroll/payruns");
        }
      } else {
        setStatus("Saved ✅");
      }
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Employee Rules"
        subtitle="Employee wage is always pulled from Xero import (auto-updates). This page only stores employee overrides."
        action={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => save(false)}
              disabled={saving}
              style={{
                padding: "10px 14px",
                border: "1px solid #2a2a2a",
                borderRadius: 10,
                opacity: saving ? 0.6 : 1,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>

            <button
              onClick={() => save(true)}
              disabled={saving}
              style={{
                padding: "10px 14px",
                border: "1px solid #2a2a2a",
                borderRadius: 10,
                background: "black",
                color: "white",
                fontWeight: 800,
                opacity: saving ? 0.6 : 1,
                cursor: saving ? "not-allowed" : "pointer",
              }}
              title={!hasImported ? "Will save now; import a timesheet CSV to apply" : "Save and recalc pay runs"}
            >
              {saving ? "Saving..." : "SAVE & APPLY (UPDATE PAYRUNS)"}
            </button>
          </div>
        }
      />

      {status ? (
        <div style={{ marginBottom: 12, padding: 12, border: "1px solid #2a2a2a", borderRadius: 12 }}>{status}</div>
      ) : null}

      {/* 1) Choose employee */}
      <div style={{ border: "1px solid #2a2a2a", borderRadius: 14, padding: 14, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>1) Choose employee</div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Employee</div>
          <select
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(String(e.target.value))}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #2a2a2a",
              background: "transparent",
              color: "inherit",
            }}
          >
            <option value="">— Select employee —</option>

            {importedEmployees.length ? (
              <optgroup label="Employees in current import">
                {importedEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({emp.id})
                  </option>
                ))}
              </optgroup>
            ) : null}

            {knownEmployees.length ? (
              <optgroup label="All known employees (saved from past imports)">
                {knownEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({emp.id})
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>
      </div>

      {!employeeRules ? (
        <div style={{ opacity: 0.8 }}>Select an employee to edit rules.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          {/* Wage is read-only */}
          <div style={{ border: "1px solid #2a2a2a", borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>2) Wage (from Xero import)</div>

            <div style={{ fontSize: 12, opacity: 0.85 }}>
              Employee: <b>{selectedEmployeeName}</b>
            </div>

            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
              Current base rate: <b>{xeroBaseRate != null ? `$${xeroBaseRate.toFixed(2)}/hr` : "— not imported yet"}</b>
            </div>

            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              This value updates automatically whenever you re-import employee base rates (or later sync via API).
            </div>
          </div>

          {/* Advanced toggle */}
          <div style={{ border: "1px solid #2a2a2a", borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>3) Advanced employee overrides</div>

            <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={employeeRules.advancedEnabled}
                onChange={(e) => updateCurrent({ advancedEnabled: e.target.checked })}
              />
              <div style={{ fontWeight: 700 }}>Enable advanced overrides (employee wins over job code)</div>
            </label>

            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              Only use this when you need employee-specific overtime/standard-day logic.
            </div>
          </div>

          {employeeRules.advancedEnabled ? (
            <>
              {/* Standard day */}
              <div style={{ border: "1px solid #2a2a2a", borderRadius: 14, padding: 14 }}>
                <div style={{ fontWeight: 800, marginBottom: 10 }}>4) Standard day (employee override)</div>

                <label style={{ display: "block", fontSize: 12, opacity: 0.85 }}>Standard day hours</label>
                <input
                  value={(employeeRules.standardMinutesPerDay / 60).toString()}
                  onChange={(e) => {
                    const hours = safeNumber(e.target.value, 8);
                    const mins = Math.round(hours * 60);
                    updateCurrent({ standardMinutesPerDay: mins });
                    updateOvertime({ ordinaryMinutesPerDay: mins });
                  }}
                  inputMode="decimal"
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #2a2a2a",
                    marginTop: 6,
                  }}
                />
              </div>

              {/* Overtime */}
              <div style={{ border: "1px solid #2a2a2a", borderRadius: 14, padding: 14 }}>
                <div style={{ fontWeight: 800, marginBottom: 10 }}>5) Overtime (employee override)</div>

                <div style={{ display: "grid", gap: 10 }}>
                  {employeeRules.overtime.tiers.map((tier, idx) => (
                    <div key={idx} style={{ border: "1px solid #2a2a2a", borderRadius: 12, padding: 12 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div style={{ fontWeight: 800, minWidth: 80 }}>OT {idx + 1}</div>

                        <button
                          onClick={() => removeTier(idx)}
                          style={{
                            marginLeft: "auto",
                            padding: "6px 10px",
                            border: "1px solid #2a2a2a",
                            borderRadius: 10,
                            opacity: 0.85,
                            cursor: "pointer",
                          }}
                        >
                          Remove
                        </button>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 10, marginTop: 10 }}>
                        <div>
                          <div style={{ fontSize: 12, opacity: 0.85 }}>Label</div>
                          <input
                            value={tier.label}
                            onChange={(e) => updateTier(idx, { label: e.target.value })}
                            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #2a2a2a" }}
                          />
                        </div>

                        <div>
                          <div style={{ fontSize: 12, opacity: 0.85 }}>Duration (hours) (optional)</div>
                          <input
                            value={tier.firstMinutes != null ? String(tier.firstMinutes / 60) : ""}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === "") return updateTier(idx, { firstMinutes: undefined });
                              const hours = safeNumber(raw, 0);
                              updateTier(idx, { firstMinutes: Math.round(hours * 60) });
                            }}
                            inputMode="decimal"
                            placeholder={idx === 0 ? "e.g. 2" : "blank = rest"}
                            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #2a2a2a" }}
                          />
                        </div>

                        <div>
                          <div style={{ fontSize: 12, opacity: 0.85 }}>Rate (× factor)</div>
                          <input
                            value={String(tier.multiplier)}
                            onChange={(e) => updateTier(idx, { multiplier: safeNumber(e.target.value, tier.multiplier) })}
                            inputMode="decimal"
                            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #2a2a2a" }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={addTier}
                  style={{
                    marginTop: 12,
                    padding: "8px 10px",
                    border: "1px solid #2a2a2a",
                    borderRadius: 10,
                    cursor: "pointer",
                  }}
                >
                  + Add overtime entry
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
        <div>
          <b>Note:</b> Wage comes from <code>{LS_XERO_EMPLOYEE_RATES}</code> and updates automatically.
        </div>
      </div>
    </div>
  );
}
