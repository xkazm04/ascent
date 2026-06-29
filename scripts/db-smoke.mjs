// Quick DB connectivity + schema smoke test against whatever DATABASE_URL points at.
//   node --env-file=.env scripts/db-smoke.mjs
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
try {
  const [{ db, host }] = await p.$queryRaw`select current_database() as db, inet_server_addr()::text as host`;
  const tables = await p.$queryRaw`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name`;
  console.log("✓ connected — database:", db, "host:", host);
  console.log(`✓ public tables: ${tables.length}`);
  console.log("  " + tables.map((t) => t.table_name).join(", "));
} catch (e) {
  console.log("✗", e.name + ":", String(e.message).split("\n")[0]);
  process.exitCode = 1;
} finally {
  await p.$disconnect();
}
