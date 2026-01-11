// src/server/xero/payrollAu.ts

export type XeroEmployee = {
  EmployeeID?: string;
  FirstName?: string;
  LastName?: string;
  Status?: string;
  PayTemplate?: {
    EarningsLines?: Array<{
      EarningsRateID?: string;
      RatePerUnit?: number | string | null;
    }>;
  };
  OrdinaryEarningsRateID?: string;
};

export type XeroPayItem = {
  earningsRates?: Array<{
    earningsRateID?: string;
    name?: string;
    ratePerUnit?: number | string | null;
    earningsType?: string;
  }>;
};

export async function fetchPayrollEmployees(accessToken: string, tenantId: string) {
  const res = await fetch("https://api.xero.com/payroll.xro/1.0/Employees", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  return (json?.Employees ?? json?.employees ?? []) as XeroEmployee[];
}

export async function fetchPayrollEmployee(accessToken: string, tenantId: string, employeeId: string) {
  const res = await fetch(`https://api.xero.com/payroll.xro/1.0/Employees/${employeeId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  const employees = (json?.Employees ?? json?.employees ?? []) as XeroEmployee[];
  return employees[0] ?? null;
}

export async function fetchPayrollPayItems(accessToken: string, tenantId: string) {
  const res = await fetch("https://api.xero.com/payroll.xro/1.0/PayItems", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as XeroPayItem;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fullName(e: XeroEmployee): string {
  const fn = (e.FirstName ?? "").trim();
  const ln = (e.LastName ?? "").trim();
  const name = `${fn} ${ln}`.trim();
  return name || "Unnamed";
}

function scoreEarningsRate(name: string, earningsType?: string) {
  const n = name.toLowerCase().trim();
  const et = (earningsType ?? "").toLowerCase();

  let s = 0;

  // Strongly prefer the exact pay item most people use in AU payroll.
  if (n === "ordinary hours") s += 50;
  if (n.includes("ordinary hours")) s += 35;

  // Broader ordinary/base signals.
  if (n.includes("ordinary")) s += 10;
  if (n.includes("base")) s += 6;
  if (n.includes("normal")) s += 3;

  if (et.includes("ordinary")) s += 10;

  return s;
}

export type EmployeeBaseRate = {
  employeeId: string;
  employeeName: string;
  baseRate: number; // $/hour
  source: "employee_paytemplate" | "payitem_default";
  earningsRateId?: string;
  earningsRateName?: string;
};

export function deriveBaseRates(employees: XeroEmployee[], payItems: XeroPayItem): EmployeeBaseRate[] {
  const rates = (payItems?.earningsRates ?? []) as NonNullable<XeroPayItem["earningsRates"]>;

  const byId = new Map<string, { name: string; ratePerUnit: number | null; earningsType?: string }>();
  for (const r of rates) {
    const id = r.earningsRateID ?? (r as any).EarningsRateID;
    if (!id) continue;
    const name = (r.name ?? (r as any).Name ?? "").toString();
    const ratePerUnit = toNum(r.ratePerUnit ?? (r as any).RatePerUnit);
    const earningsType = (r.earningsType ?? (r as any).EarningsType ?? undefined)?.toString();
    byId.set(id, { name, ratePerUnit, earningsType });
  }

  const out: EmployeeBaseRate[] = [];

  for (const e of employees) {
    const employeeId = (e.EmployeeID ?? (e as any).employeeID ?? "").toString();
    if (!employeeId) continue;

    const name = fullName(e);
    const status = (e.Status ?? (e as any).status ?? "").toString().toUpperCase();
    if (status && status !== "ACTIVE") continue;

    const lines = (e.PayTemplate?.EarningsLines ?? (e as any).PayTemplate?.EarningsLines ?? []) as Array<any>;
    let best: { cand: EmployeeBaseRate; score: number } | null = null;

    for (const line of lines) {
      const id = (line.EarningsRateID ?? line.earningsRateID ?? "").toString();
      if (!id) continue;

      const def = byId.get(id);
      const rateFromLine = toNum(line.RatePerUnit ?? line.ratePerUnit);
      const rate = rateFromLine ?? def?.ratePerUnit ?? null;
      if (!rate || rate <= 0) continue;

      const rName = def?.name ?? "";
      const s = scoreEarningsRate(rName, def?.earningsType);

      const cand: EmployeeBaseRate = {
        employeeId,
        employeeName: name,
        baseRate: rate,
        source: rateFromLine != null ? "employee_paytemplate" : "payitem_default",
        earningsRateId: id,
        earningsRateName: rName || undefined,
      };

      if (!best || s > best.score) best = { cand, score: s };
    }

    // Fallback: OrdinaryEarningsRateID -> pay item default rate
    if (!best) {
      const ordinaryId = (e.OrdinaryEarningsRateID ?? (e as any).ordinaryEarningsRateID ?? "").toString();
      if (ordinaryId) {
        const def = byId.get(ordinaryId);
        const rate = def?.ratePerUnit ?? null;
        if (rate && rate > 0) {
          best = {
            cand: {
              employeeId,
              employeeName: name,
              baseRate: rate,
              source: "payitem_default",
              earningsRateId: ordinaryId,
              earningsRateName: def?.name,
            },
            score: scoreEarningsRate(def?.name ?? "", def?.earningsType),
          };
        }
      }
    }

    if (best) out.push(best.cand);
  }

  return out;
}
