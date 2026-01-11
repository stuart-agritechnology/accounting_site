// src/app/api/xero/connect/route.ts
import { NextResponse } from "next/server";
import { makeXeroClient } from "../../../app/_lib/xeroAuth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const xero = makeXeroClient();
  await xero.initialize(); // ✅ required

  // optional: where to go after callback
  const url = new URL(req.url);
  const returnTo = url.searchParams.get("returnTo") || "/app/payruns";

  const consentUrl = await xero.buildConsentUrl();

  // carry returnTo through using a cookie
  const res = NextResponse.redirect(consentUrl);
  res.cookies.set("xero_return_to", returnTo, { httpOnly: true, path: "/" });
  return res;
}
