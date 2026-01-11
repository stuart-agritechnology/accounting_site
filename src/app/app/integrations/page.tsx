"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../../_components/PageHeader";

type ConnStatus = "Connected" | "Not connected";

const LS_XERO_EMPLOYEES = "xero_employees_v1";
const LS_XERO_SYNC_META = "xero_employees_sync_meta_v1";

// ✅ Auto-sync interval for Integrations status checks
// 0 = Off, 30 = every 30s, 60 = every 60s
const LS_INTEGRATIONS_AUTO_SYNC_SEC = "integrations_auto_sync_sec_v1";

// ✅ Remember Xero config inputs locally (prefill modal)
const LS_XERO_CFG = "xero_oauth_config_v1";
type XeroCfgLocal = { clientId: string; clientSecret: string; redirectUri: string };

function loadXeroCfgLocal(): XeroCfgLocal {
  try {
    const raw = localStorage.getItem(LS_XERO_CFG);
    if (!raw) return { clientId: "", clientSecret: "", redirectUri: "" };
    const j = JSON.parse(raw);
    return {
      clientId: String(j?.clientId ?? ""),
      clientSecret: String(j?.clientSecret ?? ""),
      redirectUri: String(j?.redirectUri ?? ""),
    };
  } catch {
    return { clientId: "", clientSecret: "", redirectUri: "" };
  }
}

function saveXeroCfgLocal(cfg: XeroCfgLocal) {
  try {
    localStorage.setItem(LS_XERO_CFG, JSON.stringify(cfg));
  } catch {}
}

/**
 * ✅ Simple, readable buttons
 * - primary: solid neutral
 * - secondary: white button w/ black text
 */
type BtnTone = "primary" | "secondary";

function btnStyle(disabled: boolean, tone: BtnTone = "secondary"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    userSelect: "none",
    transition: "transform 120ms ease, background 120ms ease, opacity 120ms ease",
    border: "1px solid #2a2a2a",
    boxShadow: "none",
  };

  if (tone === "primary") {
    return {
      ...base,
      background: "#232323",
      color: "#fff",
    };
  }

  return {
    ...base,
    background: "#ffffff",
    color: "#000000",
    border: "1px solid #bdbdbd",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #2a2a2a",
    background: "rgba(255,255,255,0.04)",
    color: "white",
    outline: "none",
  };
}

function formatDT(ts: number | null) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

function IntegrationCard({
  name,
  direction,
  status,
  primaryLabel,
  primaryHref,
  primaryOnClick,
  secondaryLabel,
  secondaryDisabled,
  secondaryOnClick,
  hint,
}: {
  name: string;
  direction: string;
  status: ConnStatus | string;
  primaryLabel: string;
  primaryHref?: string;
  primaryOnClick?: () => void;
  secondaryLabel: string;
  secondaryDisabled?: boolean;
  secondaryOnClick?: () => void;
  hint: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #242424",
        borderRadius: 16,
        padding: 16,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>{name}</div>
          <div style={{ opacity: 0.7, marginTop: 2 }}>{direction}</div>

          <div style={{ marginTop: 10, fontWeight: 800 }}>
            Status:{" "}
            <span style={{ opacity: 0.95 }}>
              {status === "Connected" ? "✅ Connected" : "⚠️ Not connected"}
            </span>
          </div>

          <div style={{ opacity: 0.85, marginTop: 10, lineHeight: 1.35, wordBreak: "break-word" }}>
            {hint}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
          {primaryHref ? (
            <a href={primaryHref} style={{ ...btnStyle(false, "primary"), textDecoration: "none", color: "inherit" }}>
              {primaryLabel}
            </a>
          ) : (
            <button style={btnStyle(false, "primary")} onClick={primaryOnClick}>
              {primaryLabel}
            </button>
          )}

          <button
            style={btnStyle(Boolean(secondaryDisabled), "secondary")}
            disabled={Boolean(secondaryDisabled)}
            onClick={secondaryDisabled ? undefined : secondaryOnClick}
            title={secondaryDisabled ? "Only available when connected" : undefined}
          >
            {secondaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalShell({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 760,
          maxWidth: "100%",
          border: "1px solid #2a2a2a",
          borderRadius: 16,
          background: "#161616",
          padding: 16,
          boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
          color: "white",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 18 }}>{title}</div>
        <div style={{ opacity: 0.78, marginTop: 6, lineHeight: 1.35 }}>{subtitle}</div>
        <div style={{ marginTop: 14 }}>{children}</div>
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  // Fergus
  const [fergusStatus, setFergusStatus] = useState<ConnStatus>("Not connected");
  const [loadingFergus, setLoadingFergus] = useState<boolean>(true);
  const [fergusCompanyId, setFergusCompanyId] = useState<number | null>(null);
  const [showFergusModal, setShowFergusModal] = useState<boolean>(false);
  const [fergusToken, setFergusToken] = useState<string>("");
  const [fergusCompanyInput, setFergusCompanyInput] = useState<string>("");
  const [fergusError, setFergusError] = useState<string>("");

  // Xero
  const [xeroStatus, setXeroStatus] = useState<ConnStatus>("Not connected");
  const [xeroTenantName, setXeroTenantName] = useState<string>("");
  const [loadingXero, setLoadingXero] = useState<boolean>(true);

  const [showXeroModal, setShowXeroModal] = useState<boolean>(false);
  const [xeroClientId, setXeroClientId] = useState<string>("");
  const [xeroClientSecret, setXeroClientSecret] = useState<string>("");
  const [xeroRedirectUri, setXeroRedirectUri] = useState<string>("");
  const [xeroConfigHint, setXeroConfigHint] = useState<string>("");
  const [xeroError, setXeroError] = useState<string>("");

  // Sync UI + per-endpoint timestamps
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastFergusSyncAt, setLastFergusSyncAt] = useState<number | null>(null);
  const [lastXeroStatusSyncAt, setLastXeroStatusSyncAt] = useState<number | null>(null);
  const [lastXeroConfigSyncAt, setLastXeroConfigSyncAt] = useState<number | null>(null);

  // Auto-sync interval (seconds). 0 = Off
  const [autoSyncSec, setAutoSyncSec] = useState<number>(30);

  // Hard guards so polling can NEVER “chain spam”
  const syncingRef = useRef(false);
  const cancelPollRef = useRef(false);
  const pollTimeoutRef = useRef<number | null>(null);

  async function refreshFergusStatus() {
    setLoadingFergus(true);
    try {
      const j = await fetch("/api/fergus/status", { cache: "no-store" }).then((r) => r.json());
      const connected = Boolean(j?.connected);
      setFergusStatus(connected ? "Connected" : "Not connected");
      const cid = Number(j?.companyId);
      setFergusCompanyId(Number.isFinite(cid) && cid > 0 ? cid : null);
    } catch {
      setFergusStatus("Not connected");
      setFergusCompanyId(null);
    } finally {
      setLoadingFergus(false);
      setLastFergusSyncAt(Date.now()); // last attempt time
    }
  }

  async function refreshXeroStatus() {
    setLoadingXero(true);
    try {
      const j = await fetch("/api/xero/status", { cache: "no-store" }).then((r) => r.json());
      const connected = Boolean(j?.connected);
      setXeroStatus(connected ? "Connected" : "Not connected");
      setXeroTenantName(j?.tenant?.tenantName ?? "");
    } catch {
      setXeroStatus("Not connected");
      setXeroTenantName("");
    } finally {
      setLoadingXero(false);
      setLastXeroStatusSyncAt(Date.now()); // last attempt time
    }
  }

  async function refreshXeroConfig() {
    try {
      const j = await fetch("/api/xero/config", { cache: "no-store" }).then((r) => r.json());
      setXeroConfigHint(j?.configured ? "Configured" : "Not configured");

      const local = loadXeroCfgLocal();
      const fallbackRedirect = String(j?.redirectUri ?? "");
      const merged: XeroCfgLocal = {
        clientId: local.clientId || "",
        clientSecret: local.clientSecret || "",
        redirectUri: local.redirectUri || fallbackRedirect || "",
      };
      setXeroClientId(merged.clientId);
      setXeroClientSecret(merged.clientSecret);
      setXeroRedirectUri(merged.redirectUri);
    } catch {
      setXeroConfigHint("Not configured");
      try {
        const local = loadXeroCfgLocal();
        setXeroClientId(local.clientId);
        setXeroClientSecret(local.clientSecret);
        setXeroRedirectUri(local.redirectUri);
      } catch {
        setXeroClientId("");
        setXeroClientSecret("");
        setXeroRedirectUri("");
      }
    } finally {
      setLastXeroConfigSyncAt(Date.now()); // last attempt time
    }
  }

  async function syncAll() {
    // ✅ Never overlap. If a poll fires while user clicks, it won't re-run.
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);

    try {
      await Promise.all([refreshFergusStatus(), refreshXeroStatus(), refreshXeroConfig()]);
      setLastSyncAt(Date.now());
    } finally {
      setSyncing(false);
      syncingRef.current = false;
    }
  }

  // ✅ Load interval setting + do a single refresh when entering Integrations
  // (This prevents the "looks disconnected until I click Sync" feeling)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_INTEGRATIONS_AUTO_SYNC_SEC);
      const v = Number(raw);
      if (v === 0 || v === 30 || v === 60) setAutoSyncSec(v);
    } catch {}

    // Major page entry: refresh statuses once.
    // NOTE: This is *not* tied to internal tab changes; it only happens when this page mounts.
    syncAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Auto-sync: Off / 30s / 60s. Never overlaps, never chains immediately after finishing.
  useEffect(() => {
    cancelPollRef.current = false;

    // Clear any existing timeout when changing interval
    if (pollTimeoutRef.current) window.clearTimeout(pollTimeoutRef.current);
    pollTimeoutRef.current = null;

    if (!autoSyncSec || autoSyncSec <= 0) {
      return () => {
        cancelPollRef.current = true;
        if (pollTimeoutRef.current) window.clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      };
    }

    const scheduleNext = () => {
      pollTimeoutRef.current = window.setTimeout(async () => {
        if (cancelPollRef.current) return;
        await syncAll();
        if (!cancelPollRef.current) scheduleNext();
      }, autoSyncSec * 1000);
    };

    scheduleNext();

    return () => {
      cancelPollRef.current = true;
      if (pollTimeoutRef.current) window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSyncSec]);

  const fergusConnected = fergusStatus === "Connected";
  const fergusHint = useMemo(() => {
    if (loadingFergus) return "Checking connection…";
    if (fergusConnected) {
      return fergusCompanyId ? `Connected. Company ID: ${fergusCompanyId}.` : "Connected.";
    }
    return "Connect with a Fergus Personal Access Token to pull time entries.";
  }, [loadingFergus, fergusConnected, fergusCompanyId]);

  const xeroHint = useMemo(() => {
    if (loadingXero) return "Checking connection…";
    if (xeroStatus === "Connected") {
      return xeroTenantName ? `Connected to ${xeroTenantName}.` : "Connected.";
    }
    return `Xero is OAuth-only. Config: ${xeroConfigHint || "Unknown"}.`;
  }, [loadingXero, xeroStatus, xeroTenantName, xeroConfigHint]);

  async function disconnectFergus() {
    await fetch("/api/fergus/disconnect", { method: "POST" }).catch(() => {});
    await syncAll();
  }

  async function disconnectXero() {
    await fetch("/api/xero/disconnect", { method: "POST" }).catch(() => {});
    setXeroStatus("Not connected");
    setXeroTenantName("");

    // ✅ keep local config so modal still prefills after disconnect
    try {
      localStorage.removeItem(LS_XERO_EMPLOYEES);
      localStorage.removeItem(LS_XERO_SYNC_META);
    } catch {}

    await syncAll();
  }

  async function saveXeroOnly() {
    setXeroError("");

    // ✅ persist locally immediately
    saveXeroCfgLocal({
      clientId: xeroClientId,
      clientSecret: xeroClientSecret,
      redirectUri: xeroRedirectUri,
    });

    try {
      const res = await fetch("/api/xero/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: xeroClientId,
          clientSecret: xeroClientSecret,
          redirectUri: xeroRedirectUri,
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to save Xero config");

      setShowXeroModal(false);
      await syncAll();
    } catch (e: any) {
      setXeroError(e?.message ?? "Failed to save Xero config");
    }
  }

  async function saveXeroAndConnect() {
    setXeroError("");

    saveXeroCfgLocal({
      clientId: xeroClientId,
      clientSecret: xeroClientSecret,
      redirectUri: xeroRedirectUri,
    });

    try {
      const res = await fetch("/api/xero/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: xeroClientId,
          clientSecret: xeroClientSecret,
          redirectUri: xeroRedirectUri,
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to save Xero config");

      setShowXeroModal(false);

      // return to Integrations
      window.location.href = `/api/xero/connect?returnTo=${encodeURIComponent("/app/integrations")}`;
    } catch (e: any) {
      setXeroError(e?.message ?? "Failed to save Xero config");
    }
  }

  return (
    <div>
      <PageHeader title="Integrations" subtitle="Connect apps to import/export time & payroll." />

      {/* ✅ Manual sync + per-endpoint timestamps */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 14,
          margin: "10px 0 14px",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div style={{ opacity: 0.8, fontSize: 13, lineHeight: 1.45 }}>
          <div>
            <b>Overall last sync:</b> {formatDT(lastSyncAt)}
          </div>
          <div>
            <b>Fergus last sync:</b> {formatDT(lastFergusSyncAt)}
          </div>
          <div>
            <b>Xero status last sync:</b> {formatDT(lastXeroStatusSyncAt)}
          </div>
          <div>
            <b>Xero config last sync:</b> {formatDT(lastXeroConfigSyncAt)}
          </div>
          <div style={{ marginTop: 4, opacity: 0.75 }}>
            Auto-sync: {autoSyncSec > 0 ? `every ${autoSyncSec} seconds` : "Off"} (updates on major page navigation).
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <button style={btnStyle(syncing, "secondary")} disabled={syncing} onClick={syncAll}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, opacity: 0.75 }}>Auto-sync</span>
            <select
              value={String(autoSyncSec)}
              onChange={(e) => {
                const v = Number(e.target.value);
                const next = v === 30 || v === 60 ? v : 0;
                setAutoSyncSec(next);
                try {
                  localStorage.setItem(LS_INTEGRATIONS_AUTO_SYNC_SEC, String(next));
                } catch {}
              }}
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid #bdbdbd",
                background: "#fff",
                color: "#000",
                fontWeight: 800,
              }}
              aria-label="Auto-sync interval"
              title="Auto-sync interval"
            >
              <option value="0">Off</option>
              <option value="30">30s</option>
              <option value="60">60s</option>
            </select>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
          gap: 14,
          alignItems: "start",
        }}
      >
        <IntegrationCard
          name="Fergus"
          direction="Import"
          status={fergusStatus}
          primaryLabel={fergusConnected ? "Reconnect" : "Connect"}
          primaryOnClick={() => {
            setFergusError("");
            setShowFergusModal(true);
          }}
          secondaryLabel={fergusConnected ? "Disconnect" : "Configure"}
          secondaryDisabled={!fergusConnected}
          secondaryOnClick={disconnectFergus}
          hint={fergusHint}
        />

        <IntegrationCard
          name="Simpro"
          direction="Import"
          status="Not connected"
          primaryLabel="Connect"
          secondaryLabel="Configure"
          secondaryDisabled={true}
          hint="Later: OAuth / API key."
        />

        <IntegrationCard
          name="Xero"
          direction="Export"
          status={xeroStatus}
          primaryLabel={xeroStatus === "Connected" ? "Reconnect" : "Connect"}
          primaryOnClick={() => {
            setXeroError("");
            try {
              const local = loadXeroCfgLocal();
              if (local.clientId || local.clientSecret || local.redirectUri) {
                setXeroClientId(local.clientId);
                setXeroClientSecret(local.clientSecret);
                setXeroRedirectUri(local.redirectUri);
              }
            } catch {}
            setShowXeroModal(true);
          }}
          secondaryLabel={xeroStatus === "Connected" ? "Disconnect" : "Configure"}
          secondaryDisabled={xeroStatus !== "Connected"}
          secondaryOnClick={disconnectXero}
          hint={xeroHint}
        />
      </div>

      {/* Fergus Modal */}
      {showFergusModal ? (
        <ModalShell
          title="Connect Fergus"
          subtitle="Paste your Fergus Personal Access Token (PAT). Optional companyId."
          onClose={() => setShowFergusModal(false)}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Token</div>
              <input
                value={fergusToken}
                onChange={(e) => setFergusToken(e.target.value)}
                placeholder="e.g. fergus_pat_xxx"
                style={inputStyle()}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Company ID (optional)</div>
              <input
                value={fergusCompanyInput}
                onChange={(e) => setFergusCompanyInput(e.target.value)}
                placeholder="e.g. 1234"
                style={inputStyle()}
              />
            </label>

            {fergusError ? <div style={{ color: "#ff6b6b", fontWeight: 900 }}>{fergusError}</div> : null}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button style={btnStyle(false, "secondary")} onClick={() => setShowFergusModal(false)}>
              Cancel
            </button>

            <button
              style={btnStyle(false, "primary")}
              onClick={async () => {
                setFergusError("");
                try {
                  const res = await fetch("/api/fergus/connect", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      token: fergusToken,
                      companyId: fergusCompanyInput,
                    }),
                  });
                  const j = await res.json().catch(() => ({}));
                  if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to connect");
                  setShowFergusModal(false);
                  await syncAll();
                } catch (e: any) {
                  setFergusError(e?.message ?? "Failed to connect");
                }
              }}
            >
              Save
            </button>
          </div>
        </ModalShell>
      ) : null}

      {/* Xero Modal */}
      {showXeroModal ? (
        <ModalShell
          title="Connect Xero (OAuth)"
          subtitle="Xero uses OAuth (no username/password). Enter your Xero App Client ID/Secret and redirect URI."
          onClose={() => setShowXeroModal(false)}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800 }}>Client ID</div>
                <input
                  value={xeroClientId}
                  onChange={(e) => {
                    setXeroClientId(e.target.value);
                    saveXeroCfgLocal({
                      clientId: e.target.value,
                      clientSecret: xeroClientSecret,
                      redirectUri: xeroRedirectUri,
                    });
                  }}
                  placeholder="Your Xero App Client ID"
                  style={inputStyle()}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800 }}>Redirect URI</div>
                <input
                  value={xeroRedirectUri}
                  onChange={(e) => {
                    setXeroRedirectUri(e.target.value);
                    saveXeroCfgLocal({
                      clientId: xeroClientId,
                      clientSecret: xeroClientSecret,
                      redirectUri: e.target.value,
                    });
                  }}
                  placeholder="e.g. http://localhost:3000/api/xero/callback"
                  style={inputStyle()}
                />
              </label>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Client Secret</div>
              <input
                value={xeroClientSecret}
                onChange={(e) => {
                  setXeroClientSecret(e.target.value);
                  saveXeroCfgLocal({
                    clientId: xeroClientId,
                    clientSecret: e.target.value,
                    redirectUri: xeroRedirectUri,
                  });
                }}
                placeholder="Your Xero App Client Secret"
                type="password"
                style={inputStyle()}
              />
            </label>

            {xeroError ? <div style={{ color: "#ff6b6b", fontWeight: 900 }}>{xeroError}</div> : null}

            <div style={{ opacity: 0.78, fontSize: 13, lineHeight: 1.35 }}>
              Stored locally for prefill (dev convenience). Server tokens/config still reset on server restart.
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button style={btnStyle(false, "secondary")} onClick={() => setShowXeroModal(false)}>
              Cancel
            </button>

            <button style={btnStyle(false, "secondary")} onClick={saveXeroOnly}>
              Save
            </button>

            <button style={btnStyle(false, "primary")} onClick={saveXeroAndConnect}>
              Save &amp; Connect
            </button>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
