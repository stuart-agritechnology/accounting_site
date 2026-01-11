import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{title}</h1>
        {subtitle ? <div style={{ marginTop: 6, opacity: 0.8 }}>{subtitle}</div> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
