// src/app/app/_lib/payPeriod.ts

export type PayCycle = "weekly" | "fortnightly" | "monthly";

export type PayrunSettings = {
  cycle: PayCycle;
  // weekly/fortnightly: weekday 0..6 (Sun..Sat)
  weekStartDow: number;
  // monthly: day-of-month 1..31
  monthStartDom: number;
};

export type ActivePayPeriod = {
  startISO: string; // YYYY-MM-DD
  endISO: string; // YYYY-MM-DD (inclusive)
  cycle: PayCycle;
  computedAtISO: string;
};

export const LS_PAYRUN_SETTINGS = "payrun_settings_v1";
export const LS_ACTIVE_PAY_PERIOD = "payrun_active_period_v1";
export const LS_LAST_PAY_PERIOD = "payrun_last_period_v1"; // for future Xero sync

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromISODate(s: string): Date {
  // parse YYYY-MM-DD in local time
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid ISO date: "${s}"`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

export function addMonths(d: Date, months: number): Date {
  const x = new Date(d.getTime());
  x.setMonth(x.getMonth() + months);
  return x;
}

export function clampInt(n: number, min: number, max: number) {
  const x = Math.round(n);
  return Math.max(min, Math.min(max, x));
}

export function loadPayrunSettings(): PayrunSettings | null {
  try {
    const raw = localStorage.getItem(LS_PAYRUN_SETTINGS);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PayrunSettings>;
    if (!p || typeof p !== "object") return null;

    const cycle = (p.cycle ?? "") as PayCycle;
    if (cycle !== "weekly" && cycle !== "fortnightly" && cycle !== "monthly") return null;

    return {
      cycle,
      weekStartDow: clampInt(Number(p.weekStartDow ?? 1), 0, 6),
      monthStartDom: clampInt(Number(p.monthStartDom ?? 1), 1, 31),
    };
  } catch {
    return null;
  }
}

export function savePayrunSettings(s: PayrunSettings) {
  localStorage.setItem(LS_PAYRUN_SETTINGS, JSON.stringify(s));
}

export function loadActivePayPeriod(): ActivePayPeriod | null {
  try {
    const raw = localStorage.getItem(LS_ACTIVE_PAY_PERIOD);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ActivePayPeriod>;
    if (!p || typeof p !== "object") return null;
    if (!p.startISO || !p.endISO) return null;
    const cycle = (p.cycle ?? "") as PayCycle;
    if (cycle !== "weekly" && cycle !== "fortnightly" && cycle !== "monthly") return null;

    // validate date formats
    fromISODate(p.startISO);
    fromISODate(p.endISO);

    return {
      startISO: p.startISO,
      endISO: p.endISO,
      cycle,
      computedAtISO: String(p.computedAtISO ?? new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

export function saveActivePayPeriod(p: ActivePayPeriod) {
  localStorage.setItem(LS_ACTIVE_PAY_PERIOD, JSON.stringify(p));
}

export function saveLastPayPeriod(p: ActivePayPeriod) {
  localStorage.setItem(LS_LAST_PAY_PERIOD, JSON.stringify(p));
}

export function loadLastPayPeriod(): ActivePayPeriod | null {
  try {
    const raw = localStorage.getItem(LS_LAST_PAY_PERIOD);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ActivePayPeriod>;
    if (!p || typeof p !== "object") return null;
    if (!p.startISO || !p.endISO) return null;
    const cycle = (p.cycle ?? "") as PayCycle;
    if (cycle !== "weekly" && cycle !== "fortnightly" && cycle !== "monthly") return null;

    fromISODate(p.startISO);
    fromISODate(p.endISO);

    return {
      startISO: p.startISO,
      endISO: p.endISO,
      cycle,
      computedAtISO: String(p.computedAtISO ?? new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

/**
 * Given a chosen period start date (YYYY-MM-DD) and settings,
 * compute the end date (inclusive).
 */
export function computePeriodFromStart(startISO: string, cycle: PayCycle): { start: Date; endInclusive: Date } {
  const start = fromISODate(startISO);
  let endExclusive: Date;

  if (cycle === "weekly") endExclusive = addDays(start, 7);
  else if (cycle === "fortnightly") endExclusive = addDays(start, 14);
  else endExclusive = addMonths(start, 1);

  // Convert to inclusive end-date (Xero Payroll AU timesheets are inclusive)
  const endInclusive = addDays(endExclusive, -1);
  return { start, endInclusive };
}

/**
 * Suggest a reasonable "current period start" from settings + today.
 * - weekly/fortnightly: find the latest weekday <= today that matches weekStartDow
 * - monthly: use monthStartDom in this month; if in future, go back 1 month
 */
export function suggestStartDateISO(settings: PayrunSettings, today = new Date()): string {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);

  if (settings.cycle === "monthly") {
    const dom = clampInt(settings.monthStartDom, 1, 31);

    // candidate in current month
    let cand = new Date(t.getFullYear(), t.getMonth(), dom, 0, 0, 0, 0);

    // if dom overflowed into next month (e.g. 31 in Feb), JS auto-rolls; fix by clamping to last day
    if (cand.getMonth() !== t.getMonth()) {
      // last day of current month
      cand = new Date(t.getFullYear(), t.getMonth() + 1, 0, 0, 0, 0, 0);
    }

    // if candidate is after today, go to previous month
    if (cand.getTime() > t.getTime()) {
      let prev = new Date(t.getFullYear(), t.getMonth() - 1, dom, 0, 0, 0, 0);
      if (prev.getMonth() !== ((t.getMonth() - 1 + 12) % 12)) {
        prev = new Date(t.getFullYear(), t.getMonth(), 0, 0, 0, 0, 0); // last day prev month
      }
      cand = prev;
    }

    return toISODate(cand);
  }

  // weekly/fortnightly
  const wanted = clampInt(settings.weekStartDow, 0, 6);
  const todayDow = t.getDay(); // 0..6
  const deltaBack = (todayDow - wanted + 7) % 7;
  const cand = addDays(t, -deltaBack);
  return toISODate(cand);
}

export function isISODateWithinPeriod(dayISO: string, period: ActivePayPeriod): boolean {
  const d = fromISODate(dayISO).getTime();
  const start = fromISODate(period.startISO).getTime();
  const end = fromISODate(period.endISO).getTime(); // inclusive
  return d >= start && d <= end;
}
