import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "~/server/db";

const handler = NextAuth({
  debug: true,

  adapter: PrismaAdapter(db),

  // ✅ FIX: Credentials sign-in requires JWT strategy in your setup
  session: { strategy: "jwt" },

  // ✅ FIX: ensure JWT uses your secret (prevents strategy/secret issues)
  jwt: {
    secret: process.env.NEXTAUTH_SECRET,
  },

  pages: { signIn: "/login" },

  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toLowerCase?.().trim?.();
        const password = credentials?.password;

        if (!email || !password) return null;

        const user = await db.user.findUnique({ where: { email } });
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
    // ✅ With JWT strategy, `user` is only available on initial sign-in.
    // This keeps `session.user.id` populated from the token on subsequent requests.
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token?.sub) {
        (session.user as any).id = token.sub;
      }
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
});

export { handler as GET, handler as POST };
