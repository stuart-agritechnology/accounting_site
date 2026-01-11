"use client";

import { PageHeader } from "../../_components/PageHeader";

function resetAllPayrollData() {
  const ok = window.confirm(
    "This will permanently remove ALL local payroll, employee, job, and Xero sync data for this browser.\n\nThis cannot be undone. Continue?"
  );
  if (!ok) return;

  const keys = [
    "payroll_live_state_v1",
    "xero_employees_v1",
    "xero_employees_sync_meta_v1",
  ];

  keys.forEach((k) => localStorage.removeItem(k));

  // Safety: if you ever added other versions
  Object.keys(localStorage)
    .filter((k) => k.startsWith("payroll_") || k.startsWith("xero_"))
    .forEach((k) => localStorage.removeItem(k));

  window.location.reload();
}

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Account and company configuration."
        action={
          <button
            style={{
              padding: "10px 14px",
              border: "1px solid #2a2a2a",
              borderRadius: 10,
            }}
          >
            Save
          </button>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Account */}
        <div style={{ border: "1px solid #2a2a2a", borderRadius: 14, padding: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Account</div>
          <label>Name</label>
          <input
            defaultValue="Stuart"
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #2a2a2a",
              marginTop: 6,
              marginBottom: 10,
            }}
          />
          <label>Email</label>
          <input
            defaultValue="stuart@email.com"
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #2a2a2a",
              marginTop: 6,
            }}
          />
        </div>

        {/* Company */}
        <div style={{ border: "1px solid #2a2a2a", borderRadius: 14, padding: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Company</div>
          <label>Company name</label>
          <input
            defaultValue="Demo Co"
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #2a2a2a",
              marginTop: 6,
              marginBottom: 10,
            }}
          />
          <label>Pay cycle default</label>
          <select
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #2a2a2a",
              marginTop: 6,
            }}
          >
            <option>Weekly</option>
            <option>Fortnightly</option>
            <option>Monthly</option>
          </select>
        </div>
      </div>

      {/* Danger zone */}
      <div
        style={{
          marginTop: 16,
          border: "1px solid rgba(239,68,68,0.5)",
          borderRadius: 14,
          padding: 14,
          background: "rgba(239,68,68,0.05)",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8, color: "#ef4444" }}>
          Danger zone
        </div>
        <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 12 }}>
          Reset all locally stored payroll data including employees, jobs,
          time entries, pay lines, and Xero sync metadata.
        </div>
        <button
          onClick={resetAllPayrollData}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ef4444",
            background: "rgba(239,68,68,0.15)",
            color: "#ef4444",
            fontWeight: 600,
          }}
        >
          Reset payroll data
        </button>
      </div>
    </div>
  );
}
