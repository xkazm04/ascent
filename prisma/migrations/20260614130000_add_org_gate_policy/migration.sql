-- AlterTable: per-org CI maturity-gate policy (GatePolicy JSON; null = archetype default).
ALTER TABLE "Organization" ADD COLUMN     "gatePolicy" JSONB;
