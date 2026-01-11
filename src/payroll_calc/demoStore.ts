import { demoEntry } from "./demo";
import { computePayLinesV1 } from "./engine_demo";
import type { PayLine, TimeEntry } from "./types";
import { getCurrentRuleset } from "./runtimeRules";

/* ============================
   Demo employees
============================ */

export type Employee = {
  id: string;
  name: string;
  baseRate: number; // $/hour
};

export function getDemoEmployees(): Employee[] {
  return [
    {
      id: "emp_1",
      name: "John Worde",
      baseRate: 50, // $50/hr demo rate
    },
  ];
}

/* ============================
   Demo time entries
============================ */

export function getDemoTimeEntries(): TimeEntry[] {
  return [demoEntry];
}

/* ============================
   Pay line computation
============================ */

export function getDemoPayLines(): PayLine[] {
  const employee = getDemoEmployees()[0];
  if (!employee) {
    // satisfies strict + noUncheckedIndexedAccess
    return [];
  }

  const ruleset = getCurrentRuleset();
  const rawLines = computePayLinesV1(demoEntry, ruleset);

  return rawLines.map((l) => {
    const cost = +(employee.baseRate * l.multiplier * l.hours).toFixed(2);

    return {
      ...l,
      employeeId: employee.id,
      employeeName: employee.name,
      baseRate: employee.baseRate,
      cost,
    };
  });
}

/* ============================
   Summary for dashboard
============================ */

export function getDemoSummary() {
  const lines = getDemoPayLines();

  const totals = lines.reduce(
    (acc, l) => {
      acc.totalMinutes += l.minutes;
      acc.totalCost += l.cost ?? 0;
      acc.byCategory[l.category] =
        (acc.byCategory[l.category] ?? 0) + l.minutes;
      return acc;
    },
    {
      totalMinutes: 0,
      totalCost: 0,
      byCategory: {} as Record<string, number>,
    },
  );

  return {
    totalHours: +(totals.totalMinutes / 60).toFixed(2),
    totalCost: +totals.totalCost.toFixed(2),
    byCategoryHours: Object.fromEntries(
      Object.entries(totals.byCategory).map(([k, v]) => [
        k,
        +(v / 60).toFixed(2),
      ]),
    ),
    ruleset: getCurrentRuleset(),
  };
}
