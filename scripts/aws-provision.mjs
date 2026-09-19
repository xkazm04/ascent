// Headless Aurora DSQL provisioning for production. Load the AWS creds from .env via Node's env-file:
//
//   node --env-file=.env scripts/aws-provision.mjs           # read-only: validate creds + list clusters
//   node --env-file=.env scripts/aws-provision.mjs --create  # create the Ascent cluster if absent, wait
//                                                             # for ACTIVE, print DSQL_ENDPOINT + DATABASE_URL
//
// Idempotent: --create reuses a cluster tagged Name=ascent-prod instead of making a duplicate.

import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  DSQLClient,
  CreateClusterCommand,
  GetClusterCommand,
  ListClustersCommand,
  ListTagsForResourceCommand,
} from "@aws-sdk/client-dsql";

const region = process.env.AWS_REGION || "us-east-1";
const TAG_KEY = "Name";
const TAG_VAL = "ascent-prod";
const create = process.argv.includes("--create");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error("Missing AWS creds. Run: node --env-file=.env scripts/aws-provision.mjs");
  process.exit(1);
}

const sts = new STSClient({ region });
const dsql = new DSQLClient({ region });

async function describe(identifier) {
  const g = await dsql.send(new GetClusterCommand({ identifier }));
  let tags = {};
  try {
    const t = await dsql.send(new ListTagsForResourceCommand({ resourceArn: g.arn }));
    tags = t.tags ?? {};
  } catch {
    /* tag read is best-effort */
  }
  return { identifier, arn: g.arn, status: g.status, tags };
}

async function main() {
  // 1) Validate the access key + show who we are.
  const id = await sts.send(new GetCallerIdentityCommand({}));
  console.log("✓ Authenticated");
  console.log("   account:", id.Account);
  console.log("   arn:    ", id.Arn);
  console.log("   region: ", region);

  // 2) List existing DSQL clusters (read-only) and find a prior ascent-prod one.
  const list = await dsql.send(new ListClustersCommand({}));
  const summaries = list.clusters ?? [];
  console.log(`\nDSQL clusters in ${region}: ${summaries.length}`);
  let target = null;
  for (const s of summaries) {
    const c = await describe(s.identifier);
    const mine = c.tags[TAG_KEY] === TAG_VAL;
    console.log(`   - ${c.identifier}  status=${c.status}${mine ? "  ← ascent-prod" : ""}`);
    if (mine) target = c;
  }

  if (!create) {
    console.log("\n(read-only) Re-run with --create to provision.");
    return;
  }

  // 3) Reuse the tagged cluster, or create a fresh one.
  if (!target) {
    console.log("\nCreating DSQL cluster (tag Name=ascent-prod)…");
    const c = await dsql.send(
      new CreateClusterCommand({ tags: { [TAG_KEY]: TAG_VAL } }),
    );
    target = { identifier: c.identifier, arn: c.arn, status: c.status };
    console.log("   identifier:", target.identifier, " status:", target.status);
  } else {
    console.log(`\nReusing cluster ${target.identifier} (status=${target.status}).`);
  }

  // 4) Poll until ACTIVE.
  const started = Date.now();
  while (target.status !== "ACTIVE") {
    if (Date.now() - started > 8 * 60_000) throw new Error(`Timed out waiting for ACTIVE (last=${target.status})`);
    await sleep(5000);
    target.status = (await dsql.send(new GetClusterCommand({ identifier: target.identifier }))).status;
    process.stdout.write(`   status=${target.status}        \r`);
  }

  // 5) Emit the connection settings.
  const endpoint = `${target.identifier}.dsql.${region}.on.aws`;
  console.log(`\n✓ ACTIVE — ${target.identifier}`);
  console.log("\n── .env ──");
  console.log(`DSQL_ENDPOINT=${endpoint}`);
  console.log(`DATABASE_URL=postgresql://admin@${endpoint}:5432/postgres?sslmode=require`);
}

main().catch((e) => {
  console.error(`\n✗ ${e.name}: ${e.message}`);
  if (e.name === "AccessDeniedException" || e.$metadata?.httpStatusCode === 403) {
    console.error("  → the IAM user lacks DSQL permissions (attach AmazonAuroraDSQLFullAccess).");
  }
  if (e.name === "UnrecognizedClientException" || e.name === "InvalidSignatureException") {
    console.error("  → the access key/secret looks wrong.");
  }
  process.exit(1);
});
