export type TimeEntry = {
  employeeName: string;
  jobCode: string;
  startISO: string;
  endISO: string;
  unpaidBreakMinutes: number;
};

export type CompanyRuleset = {
  overtime: {
    ordinaryMinutesPerDay: number;
    tiers: Array<{
      firstMinutes?: number;
      multiplier: number;
      label: string;
    }>;
  };
};

export type PayLine = {
  // existing fields you already had
  employeeName: string;
  jobCode: string;
  date: string;        // or Date string
  category: string;
  minutes: number;
  hours: number;
  multiplier: number;

  // NEW (for costing + exports)
  employeeId?: string;
  baseRate?: number;   // $/hour
  cost?: number;       // $
};
