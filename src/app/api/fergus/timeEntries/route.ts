// src/app/api/fergus/timeEntries/route.ts
import { NextResponse } from "next/server";
import { fergusFetch } from "~/server/fergus/client";
import { xeroFetch, normFullName } from "~/app/app/_lib/xeroApi";
import { deriveBaseRates } from "~/server/xero/payrollAu";

export const runtime = "nodejs";

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Array<Record<string, string | number>>): string {
  const headers = ["employee", "job", "day", "start", "end", "hours", "type", "baseRate"];
  const lines: string[] = [];
  lines.push(headers.join(","));
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape((r as any)[h] ?? "")).join(","));
  }
  return lines.join("\n");
}

/**
 * ✅ FIX: Fergus may return:
 * - "YYYY-MM-DD HH:MM"
 * - "YYYY-MM-DDTHH:MM:SSZ"
 * - other ISO-like strings
 */
function splitDateTime(dt: string): { day: string; time: string } {
  const s = String(dt ?? "").trim();
  if (!s) return { day: "", time: "" };

  // Case 1: "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM"
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  if (m?.[1] && m?.[2]) return { day: m[1], time: m[2] };

  // Case 2: parse as Date (ISO)
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const iso = d.toISOString(); // UTC
    return { day: iso.slice(0, 10), time: iso.slice(11, 16) };
  }

  return { day: "", time: "" };
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fergus duration fields are inconsistent across endpoints/accounts:
 * - sometimes hours
 * - sometimes minutes
 * - sometimes 0 even though start/end exist (common for leave)
 */
function normalizeDurationToHours(raw: number | null): number | null {
  if (raw === null) return null;
  if (!Number.isFinite(raw)) return null;

  // 0 or negative -> treat as missing (we'll fall back to start/end)
  if (raw <= 0) return null;

  // If it's bigger than a plausible single-entry hours value, assume it's minutes.
  // (A single time entry shouldn't be > 24h; even 16h is already huge.)
  if (raw > 24) return raw / 60;

  return raw;
}

async function getXeroOrdinaryRateMap(): Promise<Map<string, number>> {
  try {
    const empJson = await xeroFetch("https://api.xero.com/payroll.xro/1.0/Employees");
    const rawEmployees = (empJson?.employees ?? empJson?.Employees ?? []) as any[];

    const payItemsJson = await xeroFetch("https://api.xero.com/payroll.xro/1.0/PayItems");

    const toXeroEmployeeShape = (e: any) => ({
      EmployeeID: String(e?.EmployeeID ?? e?.employeeID ?? "").trim(),
      FirstName: String(e?.FirstName ?? e?.firstName ?? "").trim(),
      LastName: String(e?.LastName ?? e?.lastName ?? "").trim(),
      Status: String(e?.Status ?? e?.status ?? "").trim(),
      PayTemplate: e?.PayTemplate ?? e?.payTemplate ?? undefined,
      OrdinaryEarningsRateID: String(e?.OrdinaryEarningsRateID ?? e?.ordinaryEarningsRateID ?? "").trim(),
    });

    let baseRates = deriveBaseRates(
      rawEmployees.map(toXeroEmployeeShape),
      {
        earningsRates: payItemsJson?.earningsRates ?? payItemsJson?.EarningsRates ?? [],
      } as any,
    );

    // If we got almost nothing, hydrate per-employee to access PayTemplate.
    if (baseRates.length < Math.min(3, rawEmployees.length)) {
      const simpleList = rawEmployees
        .map((e: any) => String(e?.EmployeeID ?? e?.employeeID ?? "").trim())
        .filter(Boolean);

      const detailed: any[] = [];
      const concurrency = 5;
      let i = 0;

      async function worker() {
        while (i < simpleList.length) {
          const idx = i++;
          const id = simpleList[idx];
          try {
            const j = await xeroFetch(`https://api.xero.com/payroll.xro/1.0/Employees/${encodeURIComponent(id)}`);
            const arr = (j?.Employees ?? j?.employees ?? []) as any[];
            if (arr[0]) detailed.push(arr[0]);
          } catch {
            // ignore
          }
        }
      }

      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      if (detailed.length) {
        baseRates = deriveBaseRates(
          detailed.map(toXeroEmployeeShape),
          {
            earningsRates: payItemsJson?.earningsRates ?? payItemsJson?.EarningsRates ?? [],
          } as any,
        );
      }
    }

    const map = new Map<string, number>();
    for (const br of baseRates) {
      const k = normFullName(br.employeeName);
      if (!k) continue;
      if (!map.has(k)) map.set(k, br.baseRate);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const startISO = String(url.searchParams.get("startISO") ?? "").trim();
  const endISOInclusive = String(url.searchParams.get("endISOInclusive") ?? "").trim();

  // Small meta/debug helper so the UI (and you) can see what range was requested.
  const meta: any = {
    startISO,
    endISOInclusive,
    fergus: {
      filterDateFrom: startISO,
      filterDateTo: endISOInclusive,
      pagesFetched: 0,
      recordsFetched: 0,
    },
  };

  if (!startISO || !endISOInclusive) {
    return NextResponse.json(
      { ok: false, error: "Missing startISO or endISOInclusive query parameters." },
      { status: 400 },
    );
  }

  // Fergus filters are inclusive.
  const filterDateFrom = startISO;
  const filterDateTo = endISOInclusive;

  const xeroRatesByName = await getXeroOrdinaryRateMap();

  const all: any[] = [];
  let nextUrl: string | null = null;

  const first: any = await fergusFetch(
    `/timeEntries?pageSize=100&sortOrder=asc&sortField=timeEntryDate&filterDateFrom=${encodeURIComponent(
      filterDateFrom,
    )}&filterDateTo=${encodeURIComponent(filterDateTo)}`,
  );

  // Debug/meta
  meta.fergus.pagesFetched += 1;
  meta.fergus.recordsFetched += Array.isArray(first?.data ?? first?.Data) ? (first?.data ?? first?.Data).length : 0;
  meta.fergus.firstPageNextUrl = first?.paging?.links?.next ?? first?.Paging?.Links?.Next ?? null;

  all.push(...(first?.data ?? first?.Data ?? []));
  nextUrl = first?.paging?.links?.next ?? first?.Paging?.Links?.Next ?? null;

  let guard = 0;
  while (nextUrl && guard < 50) {
    guard++;
    const page: any = await fergusFetch(nextUrl);
    meta.fergus.pagesFetched += 1;
    meta.fergus.recordsFetched += Array.isArray(page?.data ?? page?.Data) ? (page?.data ?? page?.Data).length : 0;
    all.push(...(page?.data ?? page?.Data ?? []));
    nextUrl = page?.paging?.links?.next ?? page?.Paging?.Links?.Next ?? null;
  }

  meta.fergus.guardPagesLimitHit = Boolean(nextUrl && guard >= 50);

  const rows = all
    .map((t: any) => {
      const user = String(t?.user ?? t?.User ?? "").trim();

      // Fergus fields vary: try start/end time, else use entry date as the "day"
      const start = splitDateTime(String(t?.startTime ?? t?.StartTime ?? ""));
      const end = splitDateTime(String(t?.endTime ?? t?.EndTime ?? ""));

      // ✅ extra fallback: use timeEntryDate if split failed
      const teDay = String(t?.timeEntryDate ?? t?.TimeEntryDate ?? "").trim();
      const day = start.day || (teDay.match(/^\d{4}-\d{2}-\d{2}$/) ? teDay : "");

      // Leave: Fergus uses `unchargedTimeType` (e.g. "Annual Leave") for leave entries
      const type = String(
        t?.unchargedTimeType ??
          t?.UnchargedTimeType ??
          t?.timeType ??
          t?.TimeType ??
          t?.entryType ??
          t?.EntryType ??
          ""
      ).trim();

      // Duration: Fergus may provide hours/duration fields, especially for leave where start/end can be blank.
      const durationHoursRaw =
        toNum((t as any)?.paidDuration ?? (t as any)?.PaidDuration) ??
        toNum((t as any)?.unchargedTimeDuration ?? (t as any)?.UnchargedTimeDuration) ??
        toNum((t as any)?.duration ?? (t as any)?.Duration) ??
        toNum((t as any)?.hours ?? (t as any)?.Hours) ??
        null;

      const durationHours = normalizeDurationToHours(durationHoursRaw);

      // If no explicit duration, fall back to start/end time difference (same day/overnight supported).
      const hours = (() => {
        // Prefer explicit duration when it's non-zero & sane.
        // If Fergus returns 0 (common for leave), fall back to start/end.
        if (durationHours != null) return durationHours;
        if (!day || !start.time || !end.time) return null;
        const ds = new Date(`${day}T${start.time}:00`);
        let de = new Date(`${day}T${end.time}:00`);
        if (!Number.isNaN(ds.getTime()) && !Number.isNaN(de.getTime()) && de.getTime() < ds.getTime()) {
          de = new Date(de.getTime() + 24 * 60 * 60 * 1000);
        }
        const ms = de.getTime() - ds.getTime();
        if (!Number.isFinite(ms) || ms <= 0) return null;
        return ms / (1000 * 60 * 60);
      })();

      const jobNo = t?.jobNo ?? t?.JobNo ?? null;
      const jobPhaseTitle = String(t?.jobPhaseTitle ?? t?.JobPhaseTitle ?? "").trim();
      const jobPhaseDetails = String(t?.jobPhaseDetails ?? t?.JobPhaseDetails ?? "").trim();

      const jobBits = [
        jobNo != null && jobNo !== "" ? `JOB-${jobNo}` : "",
        jobPhaseTitle,
        jobPhaseDetails,
      ]
        .map((x) => String(x || "").trim())
        .filter(Boolean);

      const k = normFullName(user);
      const xeroRate = xeroRatesByName.get(k) ?? null;

      const fergusRate = toNum(t?.payRate ?? t?.PayRate);

      const baseRate = xeroRate ?? fergusRate ?? 0;

      return {
        employee: user,
        job: jobBits.join(" ").trim(),
        day,
        start: start.time || "", // may be empty if Fergus doesn't return times
        end: end.time || "",
        hours: hours != null ? Number(hours).toFixed(4) : "",
        type: type || "",
        baseRate: Number(baseRate).toFixed(2),
      };
    })
    // ✅ only require employee + day; allow start/end blank (some systems don’t provide it)
    .filter((r) => r.employee && r.day);

  const csv = toCsv(rows);

  return NextResponse.json({ ok: true, count: rows.length, csv, meta });
}
