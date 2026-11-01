-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BiasSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "asOf" DATETIME NOT NULL,
    "instrument" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "direction" TEXT NOT NULL,
    "strength" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    "drivers" TEXT NOT NULL,
    "releaseIds" TEXT NOT NULL DEFAULT '[]',
    "rulesVersion" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_BiasSnapshot" ("asOf", "computedAt", "confidence", "direction", "drivers", "id", "instrument", "origin", "rulesVersion", "score", "strength") SELECT "asOf", "computedAt", "confidence", "direction", "drivers", "id", "instrument", "origin", "rulesVersion", "score", "strength" FROM "BiasSnapshot";
DROP TABLE "BiasSnapshot";
ALTER TABLE "new_BiasSnapshot" RENAME TO "BiasSnapshot";
CREATE INDEX "BiasSnapshot_instrument_origin_asOf_idx" ON "BiasSnapshot"("instrument", "origin", "asOf");
CREATE UNIQUE INDEX "BiasSnapshot_asOf_instrument_rulesVersion_origin_key" ON "BiasSnapshot"("asOf", "instrument", "rulesVersion", "origin");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
