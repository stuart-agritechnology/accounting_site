import type { CompanyRuleset, PayLine, TimeEntry } from "./types";

function minutesBetweenISO(startISO: string, endISO: string): number {
  const a = new Date(startISO).getTime();
  const b = new Date(endISO).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const ms = Math.max(0, b - a);
  return Math.round(ms / 60000);
}

function clampInt(n: unknown, min: number, max: number): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.round(x)));
}

export function computePayLinesV1(entry: TimeEntry, ruleset: CompanyRuleset): PayLine[] {
  const rawMinutes = minutesBetweenISO(entry.startISO, entry.endISO);

  const breakMinutes = clampInt(entry.unpaidBreakMinutes ?? 0, 0, rawMinutes);
  const totalMinutes = Math.max(0, rawMinutes - breakMinutes);

  const ordinaryLimit = clampInt(ruleset.overtime.ordinaryMinutesPerDay, 0, 24 * 60);

  let remaining = totalMinutes;
  const lines: PayLine[] = [];

  // Ordinary
  const ordinaryMinutes = Math.min(remaining, ordinaryLimit);
  if (ordinaryMinutes > 0) {
    lines.push({
      category: "ordinary",
      multiplier: 1,
      minutes: ordinaryMinutes,
    });
    remaining -= ordinaryMinutes;
  }

  // Overtime tiers
  for (const tier of ruleset.overtime.tiers) {
    if (remaining <= 0) break;

    const mult = Number(tier.multiplier);
    if (!Number.isFinite(mult) || mult <= 0) continue;

    const tierLimit = tier.firstMinutes != null ? clampInt(tier.firstMinutes, 0, 24 * 60) : null;
    const minutesHere = tierLimit == null ? remaining : Math.min(remaining, tierLimit);

    if (minutesHere > 0) {
      lines.push({
        category: tier.label || "overtime",
        multiplier: mult,
        minutes: minutesHere,
      });
      remaining -= minutesHere;
    }
  }

  // If tiers didn't consume everything, default to last tier multiplier or 1.5
  if (remaining > 0) {
    const last = ruleset.overtime.tiers[ruleset.overtime.tiers.length - 1];
    const mult = Number(last?.multiplier ?? 1.5);
    lines.push({
      category: last?.label || "overtime",
      multiplier: Number.isFinite(mult) && mult > 0 ? mult : 1.5,
      minutes: remaining,
    });
  }

  return lines;
}

// ----------------------------
// Lunch handling (V2 wrapper)
// ----------------------------

export type LunchRule = {
  /** Lunch duration in minutes to apply to each time entry */
  minutes: number;
  /**
   * If true => lunch is paid separately at workMultiplier.
   * If false => lunch is unpaid (deducted) and no extra lunch line is added.
   */
  paid: boolean;
  /** Multiplier applied to paid lunch minutes (only used when paid=true) */
  workMultiplier: number;
  /** Optional category label for lunch line (defaults to "lunch") */
  category?: string;
};

export type ComputePayLinesOptions = {
  lunch?: LunchRule | null;
};

/**
 * V2: adds deterministic lunch handling on top of the existing V1 engine.
 *
 * Behaviour:
 * - Lunch minutes are always removed from the “worked minutes” used for ordinary/OT split,
 *   by adding them into unpaidBreakMinutes for the purpose of the calculation.
 * - If lunch.paid === true, we also add a separate pay line for lunch at lunch.workMultiplier.
 *
 * This prevents double-pay and keeps OT thresholds based on worked time (excluding lunch).
 */
export function computePayLinesV2(entry: TimeEntry, ruleset: CompanyRuleset, opts?: ComputePayLinesOptions): PayLine[] {
  const rawMinutes = minutesBetweenISO(entry.startISO, entry.endISO);

  const lunch = opts?.lunch ?? null;
  const lunchMinutes = lunch ? clampInt(lunch.minutes ?? 0, 0, rawMinutes) : 0;

  // We “deduct” lunch from the main calculation so it doesn't get counted in ordinary/OT.
  // For paid lunch, we’ll add a separate line after.
  const baseUnpaidBreak = clampInt(entry.unpaidBreakMinutes ?? 0, 0, rawMinutes);
  const calcBreakMinutes = clampInt(baseUnpaidBreak + lunchMinutes, 0, rawMinutes);

  const baseLines = computePayLinesV1(
    {
      ...entry,
      unpaidBreakMinutes: calcBreakMinutes,
    },
    ruleset
  );

  if (!lunch || lunchMinutes <= 0) return baseLines;

  if (!lunch.paid) {
    // Unpaid lunch = just deducted via calcBreakMinutes, no extra line
    return baseLines;
  }

  const m = Number(lunch.workMultiplier);
  const lunchMult = Number.isFinite(m) && m > 0 ? m : 1;

  // Add paid lunch as its own line
  return [
    ...baseLines,
    {
      category: lunch.category || "lunch",
      multiplier: lunchMult,
      minutes: lunchMinutes,
    },
  ];
}
