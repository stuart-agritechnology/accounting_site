"use client";

import { usePayrollData } from "../PayrollDataProvider";

export default function HomePage() {
  const { summary, hasImported, lastAppliedAt, applyRules } = usePayrollData();

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Home</h1>

      <div style={{ border: "1px solid #2a2a2a", borderRadius: 12, padding: 16 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <b>Lines</b>: {summary.lineCount}
          </div>
          <div>
            <b>Total minutes</b>: {summary.totalMinutes}
          </div>
          <div>
            <b>Total cost</b>: ${summary.totalCost.toFixed(2)}
          </div>

          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
            {lastAppliedAt ? `Last applied: ${new Date(lastAppliedAt).toLocaleString()}` : "Rules not applied yet."}
          </div>

          <button
            onClick={() => applyRules()}
            disabled={!hasImported}
            style={{
              marginTop: 10,
              padding: "14px 12px",
              borderRadius: 12,
              border: "1px solid #2a2a2a",
              background: hasImported ? "black" : "#222",
              color: "white",
              fontWeight: 800,
              cursor: hasImported ? "pointer" : "not-allowed",
            }}
          >
            APPLY RULES
          </button>
        </div>
      </div>
    </div>
  );
}
