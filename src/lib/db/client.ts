// Lazy PrismaClient singleton. Persistence is OPTIONAL: the MVP runs with no database.
// The client is only constructed when DATABASE_URL is set and a query is actually made,
// so importing this module never crashes a keyless/DB-less deployment.
//
// Aurora DSQL note: DSQL speaks the Postgres protocol. For local dev, point
// DATABASE_URL at the docker-compose Postgres. For DSQL in production, the password is
// a short-lived IAM auth token — generate it and inject it into the connection string
// (or, on Prisma 7+, use the @prisma/adapter-pg driver adapter to mint tokens per
// connection). See docs/ARCHITECTURE.md.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __ascentPrisma?: PrismaClient };

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPrisma(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — persistence is disabled.");
  }
  if (!globalForPrisma.__ascentPrisma) {
    globalForPrisma.__ascentPrisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }
  return globalForPrisma.__ascentPrisma;
}
