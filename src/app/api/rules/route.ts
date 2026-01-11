import { NextResponse } from "next/server";
import type { CompanyRuleset } from "~/payroll_calc/types";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const RULES_FILE = path.join(DATA_DIR, "rules.json");


const DEFAULT_RULESET: CompanyRuleset = {
  overtime: {
    ordinaryMinutesPerDay: 8 * 60,
    tiers: [
      { label: "OT1.5", firstMinutes: 2 * 60, multiplier: 1.5 },
      { label: "OT2.0", multiplier: 2.0 },
    ],
  },
};

// Read from disk if present (fallback to default)
function readRuleset(): CompanyRuleset {
  try {
    if (!fs.existsSync(RULES_FILE)) return DEFAULT_RULESET;
    const raw = fs.readFileSync(RULES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.overtime?.ordinaryMinutesPerDay && Array.isArray(parsed?.overtime?.tiers)) {
      return parsed as CompanyRuleset;
    }
    return DEFAULT_RULESET;
  } catch {
    return DEFAULT_RULESET;
  }
}

// Write to disk
function writeRuleset(ruleset: CompanyRuleset) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RULES_FILE, JSON.stringify(ruleset, null, 2), "utf8");
}

export async function GET() {
  const ruleset = readRuleset();
  return NextResponse.json({ ruleset }, { status: 200 });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { ruleset?: CompanyRuleset };
    if (!body?.ruleset) return NextResponse.json({ error: "Missing ruleset" }, { status: 400 });

    // Very light validation
    const r = body.ruleset;
    if (!r.overtime || typeof r.overtime.ordinaryMinutesPerDay !== "number" || !Array.isArray(r.overtime.tiers)) {
      return NextResponse.json({ error: "Invalid ruleset shape" }, { status: 400 });
    }

    writeRuleset(r);
    return NextResponse.json({ ruleset: r }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
}
