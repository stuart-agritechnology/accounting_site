// src/app/api/xero/status/route.ts
import { NextResponse } from "next/server";
import { getXeroTenant, getXeroTokens } from "../../../app/_lib/xeroStore";

export const runtime = "nodejs";

export async function GET() {
  const tokens = await getXeroTokens();
  const tenant = await getXeroTenant();

  const connected = Boolean(tokens && tenant?.tenantId);

  return NextResponse.json({
    connected,
    tenant: tenant ? { tenantId: tenant.tenantId, tenantName: tenant.tenantName ?? "" } : null,
  });
}
