import fs from "fs";
import path from "path";

export type XeroConnection = {
  tenantId: string;
  tenantName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO
  scope: string;
};

const FILE = path.join(process.cwd(), ".xero_local.json");

export function loadXeroConnection(): XeroConnection | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw) as XeroConnection;
    if (!parsed?.tenantId || !parsed?.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveXeroConnection(conn: XeroConnection) {
  fs.writeFileSync(FILE, JSON.stringify(conn, null, 2), "utf8");
}

export function clearXeroConnection() {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch {
    // ignore
  }
}
