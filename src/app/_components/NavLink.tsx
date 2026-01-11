"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

type NavLinkProps = {
  href: string;
  children: React.ReactNode;
};

export function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        textDecoration: "none",
        border: "1px solid #2a2a2a",
        background: active ? "#2a2a2a" : "transparent",
        color: active ? "white" : "inherit",
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </Link>
  );
}
