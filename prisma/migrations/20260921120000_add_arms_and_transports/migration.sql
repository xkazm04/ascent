-- ARMS: a lane is armed with a TRANSPORT and a model, not a model alone (spark local-model-lanes,
-- 2026-09-21).
--
-- The loop could express "sonnet at high effort" and nothing else, because every model it could name
-- was a Claude alias resolved by one CLI. The moment a lane can spawn something that is not `claude`,
-- a model name on its own means nothing — and the configuration this whole feature exists to measure
-- ("Claude plans, a local model executes") cannot be written down at all. An ARM is that shape: one
-- transport + one model to execute, optionally a DIFFERENT transport + model to plan.
--
-- EVERY COLUMN BELOW IS NULLABLE. Nothing is backfilled and nothing is defaulted, so every row that
-- already exists keeps its exact current meaning: a `single` run still reads its model off `model`, an
-- `ab` run still reads its two arms off `modelsJson`, and a lane with no `transport` is UNKNOWN rather
-- than assumed to have been `claude`. `modelPolicy` gains the value 'compare' and `phase` the value
-- 'void'; both columns are already TEXT, so neither is a DDL change.
--
-- JSON IS TEXT. There is no jsonb on DSQL, and both JSON columns here are read through a parser that
-- degrades a malformed column to "not recorded" rather than crashing a reader.

-- The run's arms, its arm policy, and the transport probe taken when it was armed.
ALTER TABLE "LoopRun" ADD COLUMN "armsJson" TEXT;
ALTER TABLE "LoopRun" ADD COLUMN "armPolicy" TEXT;
ALTER TABLE "LoopRun" ADD COLUMN "probeJson" TEXT;

-- What the lane actually ran: the executing transport, the arm it is a sample of, the model that
-- planned it, and — when the integrity guard voided it — why.
ALTER TABLE "LoopRunLane" ADD COLUMN "transport" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN "armId" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN "planModel" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN "voidReason" TEXT;
