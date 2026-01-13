import type { NextRequest } from "next/server";
import { verifyMobileAccessToken } from "./mobileJwt";

export async function requireMobileUser(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error("UNAUTHENTICATED");

  const token = m[1]!;
  const payload = verifyMobileAccessToken(token);
  return { userId: String(payload.sub), email: payload.email ? String(payload.email) : "" };
}
