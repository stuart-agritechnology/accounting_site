import type { CompanyRuleset, TimeEntry } from "./types";

export const demoEntry: TimeEntry = {
  employeeName: "John Worde",
  jobCode: "JB-1001",
  startISO: "2026-01-06T06:00:00.000Z", // Tuesday
  endISO: "2026-01-06T18:00:00.000Z",
  unpaidBreakMinutes: 30,
};

export const demoRuleset: CompanyRuleset = {
  overtime: {
    ordinaryMinutesPerDay: 8 * 60,
    tiers: [
      { firstMinutes: 2 * 60, multiplier: 1.5, label: "OT1.5" },
      { multiplier: 2.0, label: "OT2.0" },
    ],
  },
};
