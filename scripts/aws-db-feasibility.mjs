// Probe which AWS-native database we can actually create on this account, using the personas key.
//   node --env-file=.env scripts/aws-db-feasibility.mjs
// DynamoDB: actually creates + deletes a throwaway on-demand table (definitive, free, reversible).
// RDS/Aurora: checks permissions + account quota (a real cluster create is the provisioning step, not a probe).

import {
  DynamoDBClient, ListTablesCommand, CreateTableCommand, DescribeTableCommand, DeleteTableCommand,
} from "@aws-sdk/client-dynamodb";
import { RDSClient, DescribeDBClustersCommand, DescribeAccountAttributesCommand } from "@aws-sdk/client-rds";

const region = process.env.AWS_REGION || "us-east-1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const first = (s) => String(s).split("\n")[0];
const denied = (e) => e.name === "AccessDeniedException" || /AccessDenied/.test(e.name) || e.$metadata?.httpStatusCode === 403;

async function dynamo() {
  console.log("== DynamoDB ==");
  const ddb = new DynamoDBClient({ region });
  try {
    const l = await ddb.send(new ListTablesCommand({}));
    console.log(`  perms OK — ${(l.TableNames ?? []).length} existing table(s)`);
  } catch (e) {
    console.log(`  ${e.name}: ${first(e.message)}`);
    if (denied(e)) return console.log("  → attach AmazonDynamoDBFullAccess to test/create");
  }
  const T = "ascent-prov-test";
  try {
    await ddb.send(new CreateTableCommand({
      TableName: T, BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
    }));
    console.log("  ✓ CREATE OK — account can create DynamoDB tables");
    for (let i = 0; i < 12; i++) {
      const d = await ddb.send(new DescribeTableCommand({ TableName: T }));
      if (d.Table?.TableStatus === "ACTIVE") break;
      await sleep(2500);
    }
    await ddb.send(new DeleteTableCommand({ TableName: T }));
    console.log("  cleaned up throwaway table");
  } catch (e) {
    console.log(`  ✗ CreateTable ${e.name}: ${first(e.message)}`);
  }
}

async function rds() {
  console.log("\n== RDS / Aurora PostgreSQL ==");
  const r = new RDSClient({ region });
  try {
    const c = await r.send(new DescribeDBClustersCommand({}));
    console.log(`  perms OK — ${(c.DBClusters ?? []).length} existing cluster(s)`);
  } catch (e) {
    console.log(`  ${e.name}: ${first(e.message)}`);
    if (denied(e)) return console.log("  → attach AmazonRDSFullAccess to test/create");
  }
  try {
    const a = await r.send(new DescribeAccountAttributesCommand({}));
    for (const q of a.AccountQuotas ?? []) {
      if (["DBClusters", "DBInstances"].includes(q.AccountQuotaName)) {
        console.log(`  quota ${q.AccountQuotaName}: ${q.Used}/${q.Max}`);
      }
    }
    console.log("  (creating Aurora/RDS needs a VPC + public security group; that's the provisioning step)");
  } catch (e) {
    console.log(`  DescribeAccountAttributes ${e.name}`);
  }
}

await dynamo();
await rds();
