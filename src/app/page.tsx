import Link from "next/link";

export default function LandingPage() {
  return (
    <main style={{ minHeight: "100vh", padding: 24 }}>
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontWeight: 800 }}>Payroll Engine</div>

        {/* This can later switch to /app if logged in */}
        <Link href="/login" style={{ textDecoration: "none" }}>
          Log in
        </Link>
      </div>

      {/* Hero */}
      <div style={{ marginTop: 64, maxWidth: 760 }}>
        <h1 style={{ fontSize: 44, margin: 0 }}>
          Timesheets → Rules → Payroll Export
        </h1>

        <p style={{ opacity: 0.85, fontSize: 18, marginTop: 16 }}>
          Enter time once, configure award-style rules per company,
          and produce clean payroll outputs ready for Xero.
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <Link
            href="/login"
            style={{
              padding: "10px 14px",
              border: "1px solid #2a2a2a",
              borderRadius: 10,
              textDecoration: "none",
            }}
          >
            Log in
          </Link>

          <a
            style={{
              padding: "10px 14px",
              border: "1px solid #2a2a2a",
              borderRadius: 10,
              opacity: 0.7,
              cursor: "not-allowed",
            }}
            title="Coming soon"
          >
            Request access
          </a>
        </div>

        {/* Feature bullets */}
        <div style={{ marginTop: 40, display: "grid", gap: 12 }}>
          <div>✔ Configurable overtime tiers (daily / weekly)</div>
          <div>✔ Per-employee base rates & cost calculation</div>
          <div>✔ Allowances, penalties & loadings (roadmap)</div>
          <div>✔ Export-ready payroll data (Xero AU)</div>
        </div>
      </div>
    </main>
  );
}
