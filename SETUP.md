# Setup (DB + Auth + New Navigation)

This ZIP contains:
- your existing Next.js app code under `src/`
- a new `prisma/schema.prisma` (multi-tenant + scheduling primitives)
- NextAuth Credentials login, DB sessions, and route protection for `/app/*`
- the new sidebar structure + Payroll moved under `/app/payroll/*`

## 1) Install deps
From your repo root (where `package.json` lives):

```bash
npm i @prisma/client prisma next-auth @auth/prisma-adapter bcryptjs
```

## 2) Env vars
Copy `.env.example` → `.env` and set:
- `DATABASE_URL` (Postgres)
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`

## 3) Prisma
```bash
npx prisma migrate dev --name init
npx prisma generate
```

## 4) Create your first user/company
You can do this with `prisma studio` for now:

```bash
npx prisma studio
```

Create:
- `Company`
- `User` with `email` and `passwordHash` (bcryptjs hash)
- `Membership` linking the user + company with `roleTier = 4`

To create a bcrypt hash quickly:

```bash
node -e "const bcrypt=require('bcryptjs'); console.log(bcrypt.hashSync('YourPasswordHere', 10));"
```

## 5) Run
```bash
npm run dev
```

Login at `/login`.

---

## Navigation changes
- `/app` redirects to `/app/home`
- Payroll pages now live under:
  - `/app/payroll/employees`
  - `/app/payroll/rules`
  - `/app/payroll/employee_rules`
  - `/app/payroll/payruns`
  - `/app/payroll/simulate`
- Legacy routes (`/app/employees`, etc.) redirect to the new paths.
- Import was renamed to Sync:
  - new: `/app/integrations/sync`
  - old: `/app/import` redirects.
