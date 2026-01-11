import type { PayLine } from "./types";
import type { Employee } from "./demoStore";

export function applyCosting(
  payLines: PayLine[],
  employee: Employee,
): PayLine[] {
  return payLines.map((l) => {
    const rateApplied = employee.baseRate * l.multiplier;
    const cost = +(rateApplied * l.hours).toFixed(2);

    return {
      ...l,
      baseRate: employee.baseRate,
      rateApplied,
      cost,
    };
  });
}

export function sumCost(payLines: PayLine[]) {
  return payLines.reduce((acc, l) => acc + (l.cost ?? 0), 0);
}
