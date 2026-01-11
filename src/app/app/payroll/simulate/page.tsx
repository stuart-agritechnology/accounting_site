"use client";

import { useState } from "react";

export default function SimulatePage() {
  const [result, setResult] = useState<any>(null);
  const [csvUrl, setCsvUrl] = useState<string | null>(null);

  async function run() {
    setResult(null);
    setCsvUrl(null);

    const r = await fetch("/api/simulate-payrun", { method: "POST" });
    const data = await r.json();
    setResult(data);

    const csvRes = await fetch("/api/simulate-payrun/csv", { method: "POST" });
    const blob = await csvRes.blob();
    setCsvUrl(URL.createObjectURL(blob));
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>Simulate Pay Run</h1>
      <p style={{ opacity: 0.8 }}>
        Demo: John Worde — Tue 06:00 → 18:00 (30 min break)
      </p>

      <button
        onClick={run}
        style={{ padding: "10px 14px", border: "1px solid #2a2a2a", borderRadius: 10 }}
      >
        Run simulation
      </button>

      {result ? (
        <div style={{ marginTop: 16, border: "1px solid #2a2a2a", borderRadius: 14, padding: 14 }}>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : null}

      {csvUrl ? (
        <div style={{ marginTop: 12 }}>
          <a
            href={csvUrl}
            download="payrun_simulation.csv"
            style={{ padding: "10px 14px", border: "1px solid #2a2a2a", borderRadius: 10, display: "inline-block", textDecoration: "none" }}
          >
            Download CSV
          </a>
        </div>
      ) : null}
    </div>
  );
}
