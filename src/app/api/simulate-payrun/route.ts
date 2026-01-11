import { NextResponse } from "next/server";
import { demoEntry } from "~/payroll_calc/demo";
import { computePayLinesV1 } from "~/payroll_calc/engine_demo";
import { getCurrentRuleset } from "~/payroll_calc/runtimeRules";

export async function POST() {
  const ruleset = getCurrentRuleset();

  const payLines = computePayLinesV1(demoEntry, ruleset);

  const summary = payLines.reduce(
    (acc, l) => {
      acc.totalMinutes += l.minutes;
      acc.byCategory[l.category] = (acc.byCategory[l.category] ?? 0) + l.minutes;
      return acc;
    },
    { totalMinutes: 0, byCategory: {} as Record<string, number> },
  );

  return NextResponse.json({
    demoEntry,
    ruleset,
    payLines,
    summary,
  });
}
