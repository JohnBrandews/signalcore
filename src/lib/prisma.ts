import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { signalCorePrisma?: PrismaClient };

export const prisma =
  globalForPrisma.signalCorePrisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.signalCorePrisma = prisma;
