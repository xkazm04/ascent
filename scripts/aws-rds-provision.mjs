// End-to-end, idempotent provisioning of the production RDS PostgreSQL instance (ENCRYPTED) + a
// dedicated public security group. Long-running (RDS delete/create waits) — intended to run in the
// background:  node --env-file=.env scripts/aws-rds-provision.mjs
//
// Steps: (1) if an UNENCRYPTED ascent-prod exists, delete it; (2) ensure SG ascent-rds (5432 open);
// (3) create the ENCRYPTED instance in that SG, publicly accessible; (4) wait until available; (5)
// write the connection details to <tmp>/ascent-rds-connection.json and print a DONE summary.
//
// It does NOT touch .env or the app — wiring happens after, under review.

import {
  RDSClient, DescribeDBInstancesCommand, CreateDBInstanceCommand, DeleteDBInstanceCommand,
} from "@aws-sdk/client-rds";
import {
  EC2Client, DescribeVpcsCommand, DescribeSecurityGroupsCommand, CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
} from "@aws-sdk/client-ec2";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const region = process.env.AWS_REGION || "us-east-1";
const ID = "ascent-prod";
const SG_NAME = "ascent-rds";
const OUT = join(tmpdir(), "ascent-rds-connection.json");
const rds = new RDSClient({ region });
const ec2 = new EC2Client({ region });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(stamp(), ...a);

async function getInstance() {
  try {
    const d = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: ID }));
    return d.DBInstances?.[0] ?? null;
  } catch (e) {
    if (e.name === "DBInstanceNotFoundFault") return null;
    throw e;
  }
}

async function waitInstance(pred, label, maxMs = 20 * 60_000) {
  const t0 = Date.now();
  for (;;) {
    const inst = await getInstance();
    log(`  ${label}: status=${inst?.DBInstanceStatus ?? "(none)"}`);
    if (pred(inst)) return inst;
    if (Date.now() - t0 > maxMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(20_000);
  }
}

async function ensureSecurityGroup() {
  const vpcs = await ec2.send(new DescribeVpcsCommand({ Filters: [{ Name: "isDefault", Values: ["true"] }] }));
  const vpcId = vpcs.Vpcs?.[0]?.VpcId;
  if (!vpcId) throw new Error("no default VPC found — would need explicit subnet/VPC setup");
  const found = await ec2.send(new DescribeSecurityGroupsCommand({
    Filters: [{ Name: "group-name", Values: [SG_NAME] }, { Name: "vpc-id", Values: [vpcId] }],
  }));
  if (found.SecurityGroups?.length) {
    log(`  SG ${SG_NAME} exists: ${found.SecurityGroups[0].GroupId}`);
    return found.SecurityGroups[0].GroupId;
  }
  const sg = await ec2.send(new CreateSecurityGroupCommand({
    GroupName: SG_NAME, Description: "Ascent RDS Postgres (public 5432)", VpcId: vpcId,
  }));
  await ec2.send(new AuthorizeSecurityGroupIngressCommand({
    GroupId: sg.GroupId,
    IpPermissions: [{
      IpProtocol: "tcp", FromPort: 5432, ToPort: 5432,
      IpRanges: [{ CidrIp: "0.0.0.0/0", Description: "public postgres (tighten later)" }],
    }],
  }));
  log(`  created SG ${SG_NAME}: ${sg.GroupId} (5432 open to 0.0.0.0/0)`);
  return sg.GroupId;
}

async function main() {
  log("region:", region, "instance:", ID);

  // 1) Remove an existing UNENCRYPTED instance so we can recreate it encrypted.
  let inst = await getInstance();
  if (inst && !inst.StorageEncrypted) {
    log("found UNENCRYPTED instance — deleting to recreate with encryption");
    inst = await waitInstance(
      (i) => i && ["available", "failed", "incompatible-parameters", "incompatible-restore"].includes(i.DBInstanceStatus),
      "old-deletable",
    );
    await rds.send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: ID, SkipFinalSnapshot: true, DeleteAutomatedBackups: true }));
    await waitInstance((i) => i === null, "old-deleted");
    inst = null;
  } else if (inst && inst.StorageEncrypted) {
    log("encrypted instance already exists — will reuse (no new password available)");
  }

  // 2) Security group.
  const sgId = await ensureSecurityGroup();

  // 3) Create the encrypted instance (with the SG) if absent.
  let password = null;
  if (!inst) {
    password = randomBytes(32).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
    log("creating ENCRYPTED instance…");
    await rds.send(new CreateDBInstanceCommand({
      DBInstanceIdentifier: ID,
      Engine: "postgres",
      DBInstanceClass: "db.t4g.micro",
      AllocatedStorage: 20,
      StorageType: "gp3",
      StorageEncrypted: true, // default aws/rds KMS key
      MasterUsername: "ascent",
      MasterUserPassword: password,
      DBName: "ascent",
      PubliclyAccessible: true,
      VpcSecurityGroupIds: [sgId],
      BackupRetentionPeriod: 1, // free-tier max; raise once the account is upgraded
      DeletionProtection: false,
      Tags: [{ Key: "Name", Value: "ascent-prod" }],
    }));
  }

  // 4) Wait until available + has an endpoint.
  inst = await waitInstance((i) => i && i.DBInstanceStatus === "available" && i.Endpoint?.Address, "provisioning");
  const endpoint = inst.Endpoint.Address;
  const encrypted = inst.StorageEncrypted;

  // 5) Emit connection details.
  const databaseUrl = password
    ? `postgresql://ascent:${password}@${endpoint}:5432/ascent?sslmode=require`
    : `postgresql://ascent:<password>@${endpoint}:5432/ascent?sslmode=require`;
  const result = { id: ID, region, endpoint, port: 5432, db: "ascent", user: "ascent", password, encrypted, securityGroup: sgId, databaseUrl };
  writeFileSync(OUT, JSON.stringify(result, null, 2));

  log("\n==================== DONE ====================");
  log("endpoint:  ", endpoint);
  log("encrypted: ", encrypted);
  log("password:  ", password ?? "(reused instance — unknown; reset if needed)");
  log("DATABASE_URL:", databaseUrl);
  log("written to:", OUT);
}

main().catch((e) => {
  log("✗ FAILED:", e.name + ":", String(e.message).split("\n")[0]);
  process.exitCode = 1;
});
