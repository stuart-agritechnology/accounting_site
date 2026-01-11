"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { PayrollDataProvider } from "./PayrollDataProvider";

const NAV = [
  { href: "/app/home", label: "Home" },
  { href: "/app/customers", label: "Customers" },
  { href: "/app/sites", label: "Sites" },
  { href: "/app/payments", label: "Payments" },
  { href: "/app/payroll", label: "Payroll" },
  { href: "/app/calendar", label: "Calendar" },
  { href: "/app/map", label: "Map" },
  { href: "/app/projects", label: "Projects" },
  { href: "/app/integrations", label: "Integrations" },
  { href: "/app/tasks", label: "Tasks" },
  { href: "/app/settings", label: "Settings" },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/app/home") return pathname === "/app" || pathname === "/app/home";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/app";

  const lastMajorRef = useRef<string>("");

  useEffect(() => {
    const parts = String(pathname || "/app").split("/").filter(Boolean);
    // /app/<major>/...  => parts = ["app", "<major>", ...]
    const major = parts[1] || "home";
    if (major && major !== lastMajorRef.current) {
      lastMajorRef.current = major;
      try {
        window.dispatchEvent(
          new CustomEvent("app-major-nav", {
            detail: { major, pathname },
          })
        );
      } catch {
        // ignore
      }
    }
  }, [pathname]);

  return (
    <PayrollDataProvider>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          minHeight: "100vh",
          background: "white",
          color: "black",
        }}
      >
        {/* Sidebar */}
        <aside
          style={{
            borderRight: "1px solid #2a2a2a",
            padding: 16,
            position: "sticky",
            top: 0,
            height: "100vh",
            overflow: "auto",
            background: "white",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 14 }}>Accounting Site</div>

          <nav style={{ display: "grid", gap: 8 }}>
            {NAV.map((item) => {
              const active = isActivePath(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: active ? "1px solid #000" : "1px solid #2a2a2a",
                    textDecoration: "none",
                    color: "inherit",
                    background: active ? "rgba(0,0,0,0.06)" : "transparent",
                    fontWeight: active ? 800 : 600,
                    transition: "background 120ms ease, border-color 120ms ease",
                  }}
                >
                  {/* left marker */}
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 18,
                      borderRadius: 999,
                      background: active ? "black" : "transparent",
                      flex: "0 0 auto",
                    }}
                  />
                  <span style={{ lineHeight: 1.1 }}>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: "1px solid #2a2a2a",
              fontSize: 12,
              opacity: 0.9,
            }}
          >
            <div>
              <b>Company</b>: Demo Co
            </div>
            <div>
              <b>User</b>: Stuart
            </div>

            <div style={{ marginTop: 10 }}>
              <Link href="/login" style={{ textDecoration: "none", color: "inherit" }}>
                Log out
              </Link>
            </div>
          </div>
        </aside>

        {/* Main */}
        <div style={{ display: "grid", gridTemplateRows: "auto 1fr", minWidth: 0 }}>
          {/* Top strip */}
          <header
            style={{
              borderBottom: "1px solid #2a2a2a",
              padding: "12px 16px",
              fontSize: 12,
              opacity: 0.8,
              background: "white",
              position: "sticky",
              top: 0,
              zIndex: 10,
            }}
          >
            Workforce → Scheduling → Timesheets → Payroll
          </header>

          <main style={{ padding: 16, minWidth: 0 }}>{children}</main>
        </div>
      </div>
    </PayrollDataProvider>
  );
}
