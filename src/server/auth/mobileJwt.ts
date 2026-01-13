import crypto from "crypto";

function b64url(input: Buffer | string) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlJson(obj: any) {
  return b64url(Buffer.from(JSON.stringify(obj)));
}

export type MobileAccessTokenPayload = {
  sub: string; // userId
  email?: string;
  iat: number;
  exp: number;
};

export function signMobileAccessToken(payload: Omit<MobileAccessTokenPayload, "iat" | "exp">, ttlSeconds = 60 * 15) {
  const secret = process.env.MOBILE_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("MISSING_JWT_SECRET");

  const now = Math.floor(Date.now() / 1000);
  const full: MobileAccessTokenPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };

  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(full)}`;
  const sig = crypto.createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${b64url(sig)}`;
}

export function verifyMobileAccessToken(token: string): MobileAccessTokenPayload {
  const secret = process.env.MOBILE_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("MISSING_JWT_SECRET");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("BAD_TOKEN");

  const [h, p, s] = parts;
  const signingInput = `${h}.${p}`;
  const expected = crypto.createHmac("sha256", secret).update(signingInput).digest();

  const sig = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4), "base64");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) throw new Error("BAD_TOKEN");

  const payloadJson = Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4), "base64").toString("utf-8");
  const payload = JSON.parse(payloadJson) as MobileAccessTokenPayload;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) throw new Error("TOKEN_EXPIRED");

  return payload;
}

export function hashRefreshToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function newRefreshToken() {
  return crypto.randomBytes(32).toString("hex");
}
