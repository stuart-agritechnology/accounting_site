"use client";

import { useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const sp = useSearchParams();
  const callbackUrl = useMemo(() => sp?.get("from") ?? "/app/home", [sp]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit() {
    setBusy(true);
    setErr(null);
    const res = await signIn("credentials", {
      redirect: true,
      callbackUrl,
      email,
      password,
    });
    // With redirect=true, NextAuth will navigate on success.
    // If something blocks redirect, surface the error.
    if ((res as any)?.error) setErr((res as any).error);
    setBusy(false);
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: 400, border: "1px solid #2a2a2a", borderRadius: 14, padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 14, fontSize: 24, fontWeight: 800 }}>Log in</h1>

        <label style={{ display: "block", fontSize: 13, opacity: 0.8 }}>Email</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #2a2a2a", marginBottom: 12 }}
        />

        <label style={{ display: "block", fontSize: 13, opacity: 0.8 }}>Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          type="password"
          style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #2a2a2a", marginBottom: 12 }}
        />

        {err ? (
          <div style={{ marginBottom: 12, fontSize: 12, color: "#b00020" }}>
            {err === "CredentialsSignin" ? "Invalid email/password." : err}
          </div>
        ) : null}

        <button
          onClick={onSubmit}
          disabled={busy}
          style={{
            display: "block",
            width: "100%",
            textAlign: "center",
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #2a2a2a",
            background: "black",
            color: "white",
            fontWeight: 800,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Logging in…" : "Log in"}
        </button>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
          Uses NextAuth Credentials provider (email/password) with DB sessions.
        </div>
      </div>
    </main>
  );
}
