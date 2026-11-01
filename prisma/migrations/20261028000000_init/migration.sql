-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT NOT NULL,
    "indicator" TEXT NOT NULL,
    "releasedAt" DATETIME NOT NULL,
    "actual" REAL,
    "forecast" REAL,
    "previous" REAL,
    "unit" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "policySignal" TEXT,
    "expectedPolicySignal" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PriceBar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "close" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReleaseReaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "releaseId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "measure" TEXT NOT NULL,
    "change" REAL NOT NULL,
    "priorDate" DATETIME NOT NULL,
    "releaseDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReleaseReaction_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BiasSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "asOf" DATETIME NOT NULL,
    "instrument" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "direction" TEXT NOT NULL,
    "strength" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    "drivers" JSONB NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Release_externalId_key" ON "Release"("externalId");

-- CreateIndex
CREATE INDEX "Release_indicator_releasedAt_idx" ON "Release"("indicator", "releasedAt");

-- CreateIndex
CREATE INDEX "PriceBar_symbol_date_idx" ON "PriceBar"("symbol", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBar_symbol_date_key" ON "PriceBar"("symbol", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseReaction_releaseId_symbol_key" ON "ReleaseReaction"("releaseId", "symbol");

-- CreateIndex
CREATE INDEX "BiasSnapshot_instrument_origin_asOf_idx" ON "BiasSnapshot"("instrument", "origin", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "BiasSnapshot_asOf_instrument_rulesVersion_origin_key" ON "BiasSnapshot"("asOf", "instrument", "rulesVersion", "origin");

