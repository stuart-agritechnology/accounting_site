"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const PAYROLL_NAV = [
  { href: "/app/payroll", label: "Overview" },
  { href: "/app/payroll/employees", label: "Employees" },
  { href: "/app/payroll/rules", label: "Rules" },
  { href: "/app/payroll/employee_rules", label: "Employee Rules" },
  { href: "/app/payroll/payruns", label: "Pay Runs" },
  { href: "/app/payroll/simulate", label: "Simulate" },
];

function isActive(pathname: string, href: string) {
  if (href === "/app/payroll") return pathname === "/app/payroll";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function PayrollLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/app/payroll";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Payroll</h1>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
          Review timesheets, apply rules, approve, and sync to Xero.
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {PAYROLL_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid #2a2a2a",
                background: active ? "rgba(0,0,0,0.06)" : "transparent",
                textDecoration: "none",
                color: "inherit",
                fontWeight: active ? 800 : 600,
                fontSize: 13,
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <div>{children}</div>
    </div>
  );
}
