"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../../_components/PageHeader";
import { usePayrollData } from "../../PayrollDataProvider";
import type { CompanyRuleset } from "~/payroll_calc/types";
import { useRouter } from "next/navigation";

/**
 * We keep CompanyRuleset as-is (your engine expects this shape),
 * and wrap job-specific extras (lunch etc) locally.
 */
type JobRules = {
  jobCode: string;

  // 2) Standard day rate (stored as minutes to align with CompanyRuleset)
  standardMinutesPerDay: number; // default 8h = 480

  // 3) Lunch break settings
  lunch: {
    paid: boolean; // paid vs unpaid lunch
    minutes: number; // lunch duration
    workMultiplier: number; // if working through lunch, pay at x (placeholder usage in engine)
  };

  // 4) Overtime settings (mapped into CompanyRuleset.overtime)
  overtime: CompanyRuleset["overtime"];

  // 5-8 placeholders (kept here so per-job config is “complete”)
  allowances?: unknown;
  reimbursements?: unknown;
  loading?: unknown;
  leaveAccrual?: unknown;

  // bookkeeping
  updatedAtISO: string;
};

const LS_RULES_BY_JOB = "rules_by_job_v1";
const LS_SELECTED_JOB = "rules_selected_job_v1";

// ✅ Overtime multiplier menu options
const OT_MULTIPLIER_OPTIONS = [1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3] as const;

function toOtCode(multiplier: number) {
  // Examples: 1.25 -> OT1.25, 1.5 -> OT1.5, 2 -> OT2
  const s = String(multiplier);
  return s.includes(".") ? `OT${s}` : `OT${Number(multiplier)}`;
}

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
      d.getMinutes()
    )}`;
  } catch {
    return iso;
  }
}

function defaultJobRules(jobCode: string): JobRules {
  return {
    jobCode,
    standardMinutesPerDay: 8 * 60,
    lunch: {
      paid: false,
      minutes: 30,
      workMultiplier: 2.0,
    },
    overtime: {
      ordinaryMinutesPerDay: 8 * 60,
      tiers: [
        // Stage 1: first 2 hours after standard day
        { label: toOtCode(1.5), firstMinutes: 2 * 60, multiplier: 1.5 },
        // Stage 2: the rest
        { label: toOtCode(2.0), multiplier: 2.0 },
      ],
    },
    allowances: undefined,
    reimbursements: undefined,
    loading: undefined,
    leaveAccrual: undefined,
    updatedAtISO: new Date().toISOString(),
  };
}

function loadRulesByJob(): Record<string, JobRules> {
  try {
    const raw = localStorage.getItem(LS_RULES_BY_JOB);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, JobRules>;
    if (!parsed || typeof parsed !== "object") return {};

    // Migrate older saved data:
    // If a tier label is missing / legacy (e.g. "OT1") then re-derive it from multiplier (OT1.5, OT2, etc)
    for (const [job, jr] of Object.entries(parsed)) {
      const tiers = jr?.overtime?.tiers;
      if (!Array.isArray(tiers)) continue;

      for (const t of tiers) {
        const m = Number((t as any)?.multiplier);
        if (!Number.isFinite(m) || m <= 0) continue;

        const label = String((t as any)?.label ?? "").trim();
        if (!label || !label.toUpperCase().startsWith("OT")) {
          (t as any).label = toOtCode(m);
        } else {
          if (/^OT\d+$/i.test(label)) {
            (t as any).label = toOtCode(m);
          }
        }
      }

      if (Number.isFinite(jr?.standardMinutesPerDay) && jr?.standardMinutesPerDay > 0) {
        jr.overtime.ordinaryMinutesPerDay = jr.standardMinutesPerDay;
      }

      parsed[job] = jr;
    }

    return parsed;
  } catch {
    return {};
  }
}

function saveRulesByJob(map: Record<string, JobRules>) {
  localStorage.setItem(LS_RULES_BY_JOB, JSON.stringify(map));
}

function normalizeJobCode(s: string) {
  return s.trim();
}

// --------- tiny UI helpers ----------
const cardStyle: React.CSSProperties = { border: "1px solid #2a2a2a", borderRadius: 14, padding: 14 };
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 10,
  border: "1px solid #2a2a2a",
  boxSizing: "border-box",        // ✅ critical
  minWidth: 0,                    // ✅ prevents grid overflow
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  background: "transparent",
  color: "inherit",
  appearance: "none",             // optional: makes selects consistent
};

export default function RulesPage() {
  const { hasImported, applyRules, timeEntries } = usePayrollData();

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("");

  const router = useRouter();

  // 1) Available jobs from imported data (ordered)
  const availableJobs = useMemo(() => {
    const set = new Set<string>();

    for (const t of timeEntries as any[]) {
      const jc = (t?.jobCode ?? t?.job ?? "").toString();
      if (jc.trim()) set.add(normalizeJobCode(jc));
    }

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [timeEntries]);

  // Local store: all job rules
  const [rulesByJob, setRulesByJob] = useState<Record<string, JobRules>>({});

  // Imported jobs split:
  // - needsRules: present in imported data but not yet saved locally
  // - configuredImported: present in imported data AND already has saved rules
  const needsRulesJobs = useMemo(() => {
    return availableJobs.filter((jc) => !rulesByJob[normalizeJobCode(jc)]);
  }, [availableJobs, rulesByJob]);

  const configuredImportedJobs = useMemo(() => {
    return availableJobs.filter((jc) => !!rulesByJob[normalizeJobCode(jc)]);
  }, [availableJobs, rulesByJob]);

  // Current selected job
  const [selectedJob, setSelectedJob] = useState<string>("");

  // Current editable rules for selected job
  const [jobRules, setJobRules] = useState<JobRules | null>(null);

  // Load local rules map + selected job on mount
  useEffect(() => {
    const map = loadRulesByJob();
    setRulesByJob(map);

    const remembered = localStorage.getItem(LS_SELECTED_JOB) ?? "";

    // Prefer an imported job that *needs* rules (so you land straight on what's missing)
    const firstNeedingRules = availableJobs.find((jc) => !map[normalizeJobCode(jc)]);
    const initialJob =
      normalizeJobCode(remembered) ||
      (firstNeedingRules ? normalizeJobCode(firstNeedingRules) : "") ||
      (availableJobs[0] ? normalizeJobCode(availableJobs[0]) : "") ||
      "";

    setSelectedJob(initialJob);

    if (initialJob) {
      const existing = map[initialJob];
      setJobRules(existing ?? defaultJobRules(initialJob));
    } else {
      setJobRules(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // do NOT depend on availableJobs here

  // If jobs arrive after import and no job selected yet, pick first
  useEffect(() => {
    if (selectedJob) return;
    if (!availableJobs.length) return;

    // Prefer the first imported job that doesn't have rules yet
    const firstMissing = availableJobs.find((jc) => !rulesByJob[normalizeJobCode(jc)]);
    const first = normalizeJobCode(firstMissing ?? availableJobs[0]);
    setSelectedJob(first);
    localStorage.setItem(LS_SELECTED_JOB, first);

    setJobRules((prev) => prev ?? rulesByJob[first] ?? defaultJobRules(first));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableJobs, rulesByJob, selectedJob]);

  // When selectedJob changes, load its saved rules (or defaults)
  useEffect(() => {
    if (!selectedJob) {
      setJobRules(null);
      return;
    }

    localStorage.setItem(LS_SELECTED_JOB, selectedJob);

    setJobRules(() => {
      const saved = rulesByJob[selectedJob];
      if (saved) return saved;
      return defaultJobRules(selectedJob);
    });
  }, [selectedJob, rulesByJob]);

  // Saved jobs that are NOT present in current imported data.
  // (Keep these at the bottom, unhighlighted)
  const pastJobs = useMemo(() => {
    const imported = new Set(availableJobs.map((j) => normalizeJobCode(j)));
    const keys = Object.keys(rulesByJob).filter((k) => !imported.has(normalizeJobCode(k)));
    keys.sort((a, b) => a.localeCompare(b));
    return keys;
  }, [rulesByJob, availableJobs]);

  function updateCurrent(patch: Partial<JobRules>) {
    setJobRules((r) => {
      if (!r) return r;
      return {
        ...r,
        ...patch,
        updatedAtISO: new Date().toISOString(),
      };
    });
  }

  function updateOvertime(patch: Partial<CompanyRuleset["overtime"]>) {
    setJobRules((r) => {
      if (!r) return r;
      const overtime = { ...r.overtime, ...patch };
      return { ...r, overtime, updatedAtISO: new Date().toISOString() };
    });
  }

  function updateTier(idx: number, patch: Partial<CompanyRuleset["overtime"]["tiers"][number]>) {
    setJobRules((r) => {
      if (!r) return r;
      const tiers = [...r.overtime.tiers];
      tiers[idx] = { ...tiers[idx], ...patch };
      return {
        ...r,
        overtime: { ...r.overtime, tiers },
        updatedAtISO: new Date().toISOString(),
      };
    });
  }

  function addTier() {
    setJobRules((r) => {
      if (!r) return r;
      const tiers = [
        ...r.overtime.tiers,
        { label: toOtCode(1.5), firstMinutes: 60, multiplier: 1.5 },
      ];
      return {
        ...r,
        overtime: { ...r.overtime, tiers },
        updatedAtISO: new Date().toISOString(),
      };
    });
  }

  function removeTier(idx: number) {
    setJobRules((r) => {
      if (!r) return r;
      const tiers = r.overtime.tiers.filter((_, i) => i !== idx);
      return {
        ...r,
        overtime: { ...r.overtime, tiers },
        updatedAtISO: new Date().toISOString(),
      };
    });
  }

  async function save(andApply: boolean) {
    if (!jobRules || !selectedJob) return;

    setSaving(true);
    setStatus("");

    if (jobRules.standardMinutesPerDay <= 0) {
      setSaving(false);
      setStatus("Standard day hours must be > 0.");
      return;
    }
    if (jobRules.overtime.tiers.length === 0) {
      setSaving(false);
      setStatus("Add at least one overtime stage.");
      return;
    }
    if (jobRules.overtime.tiers.some((t) => !(Number(t.multiplier) > 0))) {
      setSaving(false);
      setStatus("Each overtime stage needs a multiplier > 0.");
      return;
    }
    if (jobRules.lunch.minutes < 0) {
      setSaving(false);
      setStatus("Lunch minutes must be >= 0.");
      return;
    }
    if (!(jobRules.lunch.workMultiplier > 0)) {
      setSaving(false);
      setStatus("Lunch work multiplier must be > 0.");
      return;
    }

    try {
      const normalizedTiers = jobRules.overtime.tiers.map((t) => ({
        ...t,
        label: toOtCode(Number(t.multiplier)),
      }));

      const normalized: JobRules = {
        ...jobRules,
        jobCode: selectedJob,
        standardMinutesPerDay: jobRules.standardMinutesPerDay,
        overtime: {
          ...jobRules.overtime,
          ordinaryMinutesPerDay: jobRules.standardMinutesPerDay,
          tiers: normalizedTiers,
        },
        updatedAtISO: new Date().toISOString(),
      };

      const nextMap = { ...rulesByJob, [selectedJob]: normalized };
      setRulesByJob(nextMap);
      saveRulesByJob(nextMap);
      setJobRules(normalized);

      if (andApply) {
        if (!hasImported) {
          setStatus("Saved ✅ (import a CSV to apply)");
        } else {
          await applyRules();
          setStatus("Saved ✅ and applied ✅ (pay runs updated)");
          router.push("/app/payroll/employee_rules");
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
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <PageHeader
        title="Rules"
        subtitle="Configure pay rules per job code (saved locally)."
        action={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={() => save(false)}
              disabled={saving}
              style={{
                padding: "10px 14px",
                border: "1px solid #2a2a2a",
                borderRadius: 10,
                opacity: saving ? 0.6 : 1,
                cursor: saving ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
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
                whiteSpace: "nowrap",
              }}
              title={!hasImported ? "Will save now; import a CSV to see payruns change" : "Save and recalc pay runs"}
            >
              {saving ? "Saving..." : "SAVE & APPLY (UPDATE PAYRUNS)"}
            </button>
          </div>
        }
      />

      {status ? (
        <div style={{ marginBottom: 12, padding: 12, border: "1px solid #2a2a2a", borderRadius: 12 }}>
          {status}
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
            Last updated: <b>{jobRules?.updatedAtISO ? fmtUpdated(jobRules.updatedAtISO) : "—"}</b>
          </div>
        </div>
      ) : null}

      {/* 1) Choose job */}
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>1) Choose job</div>

        {needsRulesJobs.length ? (
          <div
            style={{
              marginBottom: 10,
              padding: 10,
              borderRadius: 12,
              border: "1px solid rgba(239,68,68,0.35)",
              background: "rgba(239,68,68,0.10)",
              fontWeight: 800,
            }}
          >
            {needsRulesJobs.length} job{needsRulesJobs.length === 1 ? "" : "s"} need rules — pick one from the top group
            (⚠) and save.
          </div>
        ) : null}

        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Current job code</div>
        <select
          value={selectedJob}
          onChange={(e) => setSelectedJob(normalizeJobCode(e.target.value))}
          style={selectStyle}
        >
          <option value="">— Select job —</option>

          {needsRulesJobs.length ? (
            <optgroup label="Needs rules (imported, not saved)">
              {needsRulesJobs.map((jc) => (
                <option key={jc} value={jc}>
                  ⚠ {jc}
                </option>
              ))}
            </optgroup>
          ) : null}

          {configuredImportedJobs.length ? (
            <optgroup label="Imported jobs (already configured)">
              {configuredImportedJobs.map((jc) => (
                <option key={jc} value={jc}>
                  {jc}
                </option>
              ))}
            </optgroup>
          ) : null}

          {pastJobs.length ? (
            <optgroup label="Past jobs (saved settings)">
              {pastJobs.map((jc) => (
                <option key={jc} value={jc}>
                  {jc}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>

        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
          Jobs come from imported time entries (job/jobCode). Jobs with no saved rules are surfaced at the top.
        </div>
      </div>

      {!jobRules ? (
        <div style={{ opacity: 0.8 }}>Select a job code to edit rules.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          {/* 2) Standard day rate */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>2) Standard day rate</div>

            <label style={{ display: "block", fontSize: 12, opacity: 0.85 }}>Standard day hours</label>
            <input
              value={(jobRules.standardMinutesPerDay / 60).toString()}
              onChange={(e) => {
                const hours = safeNumber(e.target.value, 8);
                updateCurrent({ standardMinutesPerDay: Math.round(hours * 60) });
                updateOvertime({ ordinaryMinutesPerDay: Math.round(hours * 60) });
              }}
              inputMode="decimal"
              style={{ ...inputStyle, marginTop: 6 }}
            />

            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              Overtime starts after this many hours in a day (job-specific).
            </div>
          </div>

          {/* 3) Lunch break */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>3) Lunch break</div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="checkbox"
                checked={jobRules.lunch.paid}
                onChange={(e) => updateCurrent({ lunch: { ...jobRules.lunch, paid: e.target.checked } })}
              />
              <div style={{ fontWeight: 700 }}>Paid lunch break</div>
            </div>

            {/* ✅ FIX: auto-fit so it never overlaps on narrower widths */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 10,
                marginTop: 10,
              }}
            >
              <div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>Lunch minutes</div>
                <input
                  value={String(jobRules.lunch.minutes)}
                  onChange={(e) => {
                    const mins = Math.max(0, Math.round(safeNumber(e.target.value, jobRules.lunch.minutes)));
                    updateCurrent({ lunch: { ...jobRules.lunch, minutes: mins } });
                  }}
                  inputMode="numeric"
                  style={inputStyle}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>If working through lunch (× factor)</div>
                <input
                  value={String(jobRules.lunch.workMultiplier)}
                  onChange={(e) => {
                    const mult = safeNumber(e.target.value, jobRules.lunch.workMultiplier);
                    updateCurrent({ lunch: { ...jobRules.lunch, workMultiplier: mult } });
                  }}
                  inputMode="decimal"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              Placeholder for engine: unpaid lunch could be deducted unless marked “worked”, then paid at the lunch
              multiplier.
            </div>
          </div>

          {/* 4) Overtime */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>4) Overtime</div>

            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10, lineHeight: 1.35 }}>
              Each row is an overtime <b>stage</b>. The <b>rate</b> (multiplier) you choose will generate the code we send
              to Xero later (e.g. <b>OT1.5</b>, <b>OT2</b>, <b>OT2.5</b>).
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {jobRules.overtime.tiers.map((tier, idx) => (
                <div
                  key={idx}
                  style={{
                    border: "1px solid #2a2a2a",
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  {/* ✅ FIX: header uses grid so text never overlaps Remove */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 10,
                      alignItems: "start",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900 }}>Overtime Stage {idx + 1}</div>
                      <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4, whiteSpace: "normal" }}>
                        Xero code:{" "}
                        <b style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                          {toOtCode(Number(tier.multiplier))}
                        </b>
                      </div>
                    </div>

                    <button
                      onClick={() => removeTier(idx)}
                      style={{
                        padding: "6px 10px",
                        border: "1px solid #2a2a2a",
                        borderRadius: 10,
                        opacity: 0.9,
                        cursor: "pointer",
                        height: 34,
                        alignSelf: "start",
                        whiteSpace: "nowrap",
                      }}
                      title="Remove this overtime stage"
                    >
                      Remove
                    </button>
                  </div>

                  {/* ✅ FIX: auto-fit so inputs never overlap */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                      gap: 10,
                      marginTop: 12,
                    }}
                  >
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
                        placeholder={idx === 0 ? "e.g. 2 (first 2h OT)" : "blank = rest"}
                        style={inputStyle}
                      />
                    </div>

                    <div>
                      <div style={{ fontSize: 12, opacity: 0.85 }}>Rate (× factor)</div>
                      <select
                        value={String(tier.multiplier)}
                        onChange={(e) => {
                          const mult = safeNumber(e.target.value, Number(tier.multiplier));
                          updateTier(idx, { multiplier: mult, label: toOtCode(mult) } as any);
                        }}
                        style={selectStyle}
                      >
                        {OT_MULTIPLIER_OPTIONS.map((m) => (
                          <option key={m} value={String(m)}>
                            {m}×
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                    {tier.firstMinutes != null
                      ? `This stage covers ${(tier.firstMinutes / 60).toFixed(2)} hours at ${tier.multiplier}×`
                      : `This stage covers the rest at ${tier.multiplier}×`}
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
                whiteSpace: "nowrap",
              }}
            >
              + Add overtime stage
            </button>
          </div>

          {/* 5-8 placeholders */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>5) Allowances</div>
            <div style={{ opacity: 0.85 }}>Placeholder for later (tool, travel, meals, site allowances, etc).</div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>6) Reimbursements</div>
            <div style={{ opacity: 0.85 }}>Placeholder for later (expenses reimbursed to employees).</div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>7) Loading</div>
            <div style={{ opacity: 0.85 }}>Placeholder for later (shift loadings, leave loading, etc).</div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>8) Leave accrual</div>
            <div style={{ opacity: 0.85 }}>Placeholder for later (accrual rules, balances, etc).</div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
        <div>
          <b>Note:</b> Job rules are saved locally in your browser.
        </div>
        <div>Imported payroll data should be handled via CSV import/export as you scale.</div>
      </div>
    </div>
  );
}
