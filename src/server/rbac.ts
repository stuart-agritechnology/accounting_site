import { db } from "~/server/db";

export type RoleTier = 1 | 2 | 3 | 4;

/**
 * Reads the caller's role for a company.
 * - If a user belongs to multiple companies, the UI can select the "active" company
 *   and pass it (header/cookie/query param). For now, we default to the first membership.
 */
export async function getUserRoleTier(userId: string, companyId?: string): Promise<{ companyId: string; roleTier: RoleTier } | null> {
  const membership = await db.membership.findFirst({
    where: {
      userId,
      ...(companyId ? { companyId } : {}),
    },
    select: { companyId: true, roleTier: true },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) return null;
  return { companyId: membership.companyId, roleTier: membership.roleTier as RoleTier };
}

export function requireTier(roleTier: RoleTier, minTier: RoleTier): boolean {
  return roleTier >= minTier;
}
