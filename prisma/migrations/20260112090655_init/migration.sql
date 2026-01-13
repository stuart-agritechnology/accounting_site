-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TimesheetSubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SYNCED');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'FERGUS',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Sydney',
    "notes" TEXT,
    "minutes" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'APP',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "status" "TimesheetSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimesheetSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "minutesPerDay" INTEGER,
    "notes" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'REQUESTED',
    "externalId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'APP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileRefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileTimeEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Sydney',
    "minutes" INTEGER NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileTimesheetSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileTimesheetSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileLeaveRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "minutesPerDay" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileLeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Post" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollJobRule" (
    "id" TEXT NOT NULL,
    "jobCode" TEXT NOT NULL,
    "rulesJson" JSONB NOT NULL,
    "updatedAtISO" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollJobRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollTimeEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT,
    "employeeName" TEXT NOT NULL,
    "jobCode" TEXT NOT NULL,
    "startISO" TIMESTAMP(3) NOT NULL,
    "endISO" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "notes" TEXT,
    "rawJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayrun" (
    "id" TEXT NOT NULL,
    "startISO" TIMESTAMP(3) NOT NULL,
    "endISOExclusive" TIMESTAMP(3) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputsJson" JSONB NOT NULL,
    "outputsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPayrun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollAuditEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestJson" JSONB NOT NULL,
    "responseJson" JSONB NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "payrunId" TEXT,

    CONSTRAINT "PayrollAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollEmployee" (
    "id" TEXT NOT NULL,
    "xeroEmployeeId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "baseRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "noTimesheets" BOOLEAN NOT NULL DEFAULT false,
    "weeklyHours" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_externalId_key" ON "Job"("externalId");

-- CreateIndex
CREATE INDEX "Job_code_idx" ON "Job"("code");

-- CreateIndex
CREATE INDEX "Job_active_idx" ON "Job"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Job_source_code_key" ON "Job"("source", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_externalId_key" ON "TimeEntry"("externalId");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_idx" ON "TimeEntry"("userId");

-- CreateIndex
CREATE INDEX "TimeEntry_jobId_idx" ON "TimeEntry"("jobId");

-- CreateIndex
CREATE INDEX "TimeEntry_startAt_idx" ON "TimeEntry"("startAt");

-- CreateIndex
CREATE INDEX "TimesheetSubmission_userId_idx" ON "TimesheetSubmission"("userId");

-- CreateIndex
CREATE INDEX "TimesheetSubmission_fromDate_toDate_idx" ON "TimesheetSubmission"("fromDate", "toDate");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetSubmission_userId_fromDate_toDate_key" ON "TimesheetSubmission"("userId", "fromDate", "toDate");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveRequest_externalId_key" ON "LeaveRequest"("externalId");

-- CreateIndex
CREATE INDEX "LeaveRequest_userId_idx" ON "LeaveRequest"("userId");

-- CreateIndex
CREATE INDEX "LeaveRequest_startDate_endDate_idx" ON "LeaveRequest"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MobileRefreshToken_tokenHash_key" ON "MobileRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MobileRefreshToken_userId_idx" ON "MobileRefreshToken"("userId");

-- CreateIndex
CREATE INDEX "MobileRefreshToken_expiresAt_idx" ON "MobileRefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "MobileTimeEntry_userId_idx" ON "MobileTimeEntry"("userId");

-- CreateIndex
CREATE INDEX "MobileTimeEntry_userId_startAt_idx" ON "MobileTimeEntry"("userId", "startAt");

-- CreateIndex
CREATE INDEX "MobileTimeEntry_jobId_idx" ON "MobileTimeEntry"("jobId");

-- CreateIndex
CREATE INDEX "MobileTimesheetSubmission_userId_idx" ON "MobileTimesheetSubmission"("userId");

-- CreateIndex
CREATE INDEX "MobileTimesheetSubmission_periodStart_idx" ON "MobileTimesheetSubmission"("periodStart");

-- CreateIndex
CREATE INDEX "MobileTimesheetSubmission_status_idx" ON "MobileTimesheetSubmission"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MobileTimesheetSubmission_userId_periodStart_periodEnd_key" ON "MobileTimesheetSubmission"("userId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "MobileLeaveRequest_userId_idx" ON "MobileLeaveRequest"("userId");

-- CreateIndex
CREATE INDEX "MobileLeaveRequest_startDate_idx" ON "MobileLeaveRequest"("startDate");

-- CreateIndex
CREATE INDEX "MobileLeaveRequest_status_idx" ON "MobileLeaveRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollJobRule_jobCode_key" ON "PayrollJobRule"("jobCode");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollTimeEntry_externalId_key" ON "PayrollTimeEntry"("externalId");

-- CreateIndex
CREATE INDEX "PayrollTimeEntry_jobCode_idx" ON "PayrollTimeEntry"("jobCode");

-- CreateIndex
CREATE INDEX "PayrollTimeEntry_employeeName_idx" ON "PayrollTimeEntry"("employeeName");

-- CreateIndex
CREATE INDEX "PayrollTimeEntry_startISO_idx" ON "PayrollTimeEntry"("startISO");

-- CreateIndex
CREATE INDEX "PayrollTimeEntry_userId_idx" ON "PayrollTimeEntry"("userId");

-- CreateIndex
CREATE INDEX "PayrollTimeEntry_userId_startISO_idx" ON "PayrollTimeEntry"("userId", "startISO");

-- CreateIndex
CREATE INDEX "PayrollPayrun_startISO_endISOExclusive_idx" ON "PayrollPayrun"("startISO", "endISOExclusive");

-- CreateIndex
CREATE INDEX "PayrollAuditEvent_type_idx" ON "PayrollAuditEvent"("type");

-- CreateIndex
CREATE INDEX "PayrollAuditEvent_createdAt_idx" ON "PayrollAuditEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEmployee_xeroEmployeeId_key" ON "PayrollEmployee"("xeroEmployeeId");

-- CreateIndex
CREATE INDEX "PayrollEmployee_fullName_idx" ON "PayrollEmployee"("fullName");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetSubmission" ADD CONSTRAINT "TimesheetSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileRefreshToken" ADD CONSTRAINT "MobileRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileTimeEntry" ADD CONSTRAINT "MobileTimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileTimeEntry" ADD CONSTRAINT "MobileTimeEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileTimesheetSubmission" ADD CONSTRAINT "MobileTimesheetSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileLeaveRequest" ADD CONSTRAINT "MobileLeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollTimeEntry" ADD CONSTRAINT "PayrollTimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAuditEvent" ADD CONSTRAINT "PayrollAuditEvent_payrunId_fkey" FOREIGN KEY ("payrunId") REFERENCES "PayrollPayrun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
