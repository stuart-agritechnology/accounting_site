import { NextResponse } from "next/server";
import { fergusFetch } from "~/server/fergus/client";

/**
 * Debug endpoint: returns the RAW Fergus response for the given date range.
 *
 * Usage:
 *   /api/fergus/timeEntries/raw?startISO=YYYY-MM-DD&endISOInclusive=YYYY-MM-DD
 *
 * If startISO/endISOInclusive are omitted, it fetches the most recent entries
 * (Fergus default ordering) with no date filter so you can confirm connectivity/data.
 */
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const startISO = u.searchParams.get("startISO")?.trim() || "";
    const endISOInclusive = u.searchParams.get("endISOInclusive")?.trim() || "";
    const pageSize = Math.max(1, Math.min(250, Number(u.searchParams.get("pageSize") || 50) || 50));

    const params: Record<string, string | number> = {
      pageSize,
      sortField: "timeEntryDate",
      sortAscending: 1,
    };

    // Fergus date filters are inclusive of the day.
    // The UI uses endISOInclusive, so pass as filterDateTo.
    if (startISO) params.filterDateFrom = startISO;
    if (endISOInclusive) params.filterDateTo = endISOInclusive;

    const qs = new URLSearchParams(params as any).toString();
    const path = `/timeEntries?${qs}`;

    const first = await fergusFetch(path);

    // Return a trimmed sample so we don't spam the browser.
    const data = Array.isArray(first?.data) ? first.data : [];

    return NextResponse.json(
      {
        ok: true,
        requestPath: path,
        receivedCount: data.length,
        sample: data.slice(0, 3),
        raw: first,
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Failed to fetch raw Fergus time entries",
      },
      { status: 500 },
    );
  }
}
