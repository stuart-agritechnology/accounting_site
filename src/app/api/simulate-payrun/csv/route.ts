import { NextResponse } from "next/server";
import { demoEntry } from "~/payroll_calc/demo";
import { computePayLinesV1 } from "~/payroll_calc/engine_demo";
import { getCurrentRuleset } from "~/payroll_calc/runtimeRules";

function toCsv(rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) =>
    `"${String(v ?? "").replaceAll('"', '""')}"`;

  return [
    headers.join(","),
    ...rows.map((r) =>
      headers.map((h) => escape(r[h])).join(","),
    ),
  ].join("\n");
}

export async function POST() {
  const ruleset = getCurrentRuleset();

  const payLines = computePayLinesV1(demoEntry, ruleset);

  const rows = payLines.map((l) => ({
    employee: l.employeeName,
    date: l.date,
    jobCode: l.jobCode,
    category: l.category,
    hours: l.hours.toFixed(2),
    multiplier: l.multiplier.toFixed(2),
  }));

  const csv = toCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payrun_simulation.csv"`,
    },
  });
}
