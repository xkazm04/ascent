-- PER-RUN AGENT CONFIGURATION — which model, and at what reasoning effort.
--
-- The loop's coding agent was pinned to the deployment's `CLAUDE_MODEL` (default `sonnet`), so the
-- most expensive variable in the system was the one thing an operator could not vary without a
-- redeploy — and, worse, the outcome ledger compared lifts across runs whose configuration it did not
-- record. A lift measured on sonnet at default effort and one measured on opus at high effort are
-- results from two different setups; without these columns there was no way to tell them apart.
--
-- Both are RESOLVED at arm time rather than stored raw. A NULL `model` would mean "whatever
-- CLAUDE_MODEL happened to be that day", which is precisely the fact that cannot be recovered after
-- the fact. NULL therefore means only one thing: a row written before this existed, whose
-- configuration is genuinely unknown — and the ledger renders nothing for it rather than guessing
-- "default".
--
-- `effort` is NULL whenever no level was chosen, and that is not a default: the CLI's `--effort` flag
-- is then not passed at all, so a `claude` build that has never heard of it runs the argv it always
-- did.
ALTER TABLE "LoopRun" ADD COLUMN "model" TEXT;
ALTER TABLE "LoopRun" ADD COLUMN "effort" TEXT;
ALTER TABLE "LoopDrive" ADD COLUMN "model" TEXT;
ALTER TABLE "LoopDrive" ADD COLUMN "effort" TEXT;
