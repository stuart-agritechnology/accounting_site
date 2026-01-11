import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db as prisma } from "./db";

/**
 * NextAuth config for Credentials login.
 * - Uses Prisma adapter so sessions/accounts are stored in Postgres.
 * - Uses bcryptjs against User.passwordHash.
 */
export const authOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" as const },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials: any) {
        const email = credentials?.email?.toLowerCase?.().trim?.();
        const password = credentials?.password;

        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    async session({ session, user }: any) {
      // Ensure session.user.id is available
      if (session?.user && user?.id) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
} satisfies Parameters<typeof NextAuth>[0];

// ✅ This is what route.ts expects:
export const { handlers, auth } = NextAuth(authOptions);
