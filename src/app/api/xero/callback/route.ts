// src/app/api/xero/callback/route.ts
import { NextResponse } from "next/server";
import { makeXeroClient } from "../../../app/_lib/xeroAuth";
import { saveXeroTenant, saveXeroTokens } from "../../../app/_lib/xeroStore";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const xero = makeXeroClient();
  await xero.initialize(); // ✅ required

  try {
    // exchanges ?code=... for tokenSet
    const tokenSet = await xero.apiCallback(req.url);
    await saveXeroTokens(tokenSet);
    await xero.setTokenSet(tokenSet);

    const tenants = await xero.updateTenants();
    if (tenants?.length) {
      const t0 = tenants[0];
      await saveXeroTenant(t0.tenantId, t0.tenantName ?? "");
    }

    // go back where user wanted
    const returnToCookie = req.headers.get("cookie")?.match(/xero_return_to=([^;]+)/)?.[1];
    const returnTo = returnToCookie ? decodeURIComponent(returnToCookie) : "/app/payruns";

    const res = NextResponse.redirect(new URL(returnTo, req.url));
    res.cookies.set("xero_return_to", "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  } catch (e: any) {
    const msg = e?.message ?? "Xero callback failed";
    return NextResponse.redirect(new URL(`/app/payruns?xeroError=${encodeURIComponent(msg)}`, req.url));
  }
}
