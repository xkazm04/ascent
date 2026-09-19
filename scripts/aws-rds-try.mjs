// Attempt to create a free-tier RDS PostgreSQL instance — the definitive test of whether this account
// can vend RDS (the create call is where the DSQL account-hold surfaced). Reversible: delete the
// instance to undo. Run: node --env-file=.env scripts/aws-rds-try.mjs
//
// NOTE: created in the default VPC with the default security group, so it is NOT yet reachable from
// the internet (no inbound :5432). Opening that needs EC2 perms — a follow-up, not part of this test.

import { RDSClient, DescribeDBInstancesCommand, CreateDBInstanceCommand } from "@aws-sdk/client-rds";
import { randomBytes } from "node:crypto";

const region = process.env.AWS_REGION || "us-east-1";
const rds = new RDSClient({ region });
const ID = "ascent-prod";
const first = (s) => String(s).split("\n")[0];
// URL-safe alphanumeric master password (no /,@,",space — valid for RDS and needs no URL-encoding)
const pw = randomBytes(32).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);

// 1) Confirm perms work now + that we're not duplicating.
try {
  const d = await rds.send(new DescribeDBInstancesCommand({}));
  console.log(`perms OK — ${(d.DBInstances ?? []).length} existing RDS instance(s) in ${region}`);
  const exists = (d.DBInstances ?? []).find((i) => i.DBInstanceIdentifier === ID);
  if (exists) {
    console.log(`! '${ID}' already exists — status=${exists.DBInstanceStatus}, endpoint=${exists.Endpoint?.Address ?? "(pending)"}`);
    process.exit(0);
  }
} catch (e) {
  console.log(`✗ DescribeDBInstances ${e.name}: ${first(e.message)}`);
  process.exit(1);
}

// 2) Try the create.
try {
  const r = await rds.send(new CreateDBInstanceCommand({
    DBInstanceIdentifier: ID,
    Engine: "postgres",
    DBInstanceClass: "db.t4g.micro", // free-tier eligible
    AllocatedStorage: 20,
    StorageType: "gp3",
    MasterUsername: "ascent",
    MasterUserPassword: pw,
    DBName: "ascent",
    PubliclyAccessible: true,
    BackupRetentionPeriod: 1,
    DeletionProtection: false,
    Tags: [{ Key: "Name", Value: "ascent-prod" }],
  }));
  const i = r.DBInstance ?? {};
  console.log("\n✓ CREATE ACCEPTED — this account CAN create RDS PostgreSQL.");
  console.log(`  id:     ${i.DBInstanceIdentifier}`);
  console.log(`  status: ${i.DBInstanceStatus}  engine: ${i.Engine} ${i.EngineVersion ?? ""}  class: ${i.DBInstanceClass}`);
  console.log(`  master user:     ascent`);
  console.log(`  master password: ${pw}`);
  console.log("  (save the password — it cannot be retrieved later, only reset)");
  console.log("\n  Provisioning takes ~5-10 min; the endpoint appears once status=available.");
} catch (e) {
  console.log(`\n✗ CreateDBInstance ${e.name}: ${first(e.message)}`);
  if (/AccessDenied/.test(e.name)) console.log("  → needs AmazonRDSFullAccess");
  else console.log("  → if this is a 'contact AWS Support' ValidationException, the account hold also covers RDS.");
}
