import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

export async function requireUser(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const userId = token?.sub ? String(token.sub) : null;
  if (!userId) throw new Error("UNAUTHENTICATED");
  return { userId, email: token?.email ? String(token.email) : "" };
}
