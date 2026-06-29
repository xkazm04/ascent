// Try to grant the current IAM user the DSQL permissions it needs — headless if the user is allowed to
// manage its own policies, otherwise it reports exactly what an admin must attach.
//   node --env-file=.env scripts/aws-grant-dsql.mjs

import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  IAMClient,
  ListAttachedUserPoliciesCommand,
  AttachUserPolicyCommand,
} from "@aws-sdk/client-iam";

const region = process.env.AWS_REGION || "us-east-1";
const POLICY_ARN = "arn:aws:iam::aws:policy/AmazonAuroraDSQLFullAccess";

const sts = new STSClient({ region });
const iam = new IAMClient({ region });

const id = await sts.send(new GetCallerIdentityCommand({}));
const userName = id.Arn.split("/").pop(); // arn:aws:iam::acct:user/<name>
console.log("user:", userName, "account:", id.Account);

try {
  const cur = await iam.send(new ListAttachedUserPoliciesCommand({ UserName: userName }));
  console.log("attached policies:", (cur.AttachedPolicies ?? []).map((p) => p.PolicyName).join(", ") || "(none)");
} catch (e) {
  console.log("(can't list policies:", e.name + ")");
}

try {
  await iam.send(new AttachUserPolicyCommand({ UserName: userName, PolicyArn: POLICY_ARN }));
  console.log(`\n✓ Attached ${POLICY_ARN} to ${userName}. DSQL is now usable headlessly.`);
} catch (e) {
  console.log(`\n✗ Could not self-attach (${e.name}).`);
  console.log("  This user can't grant its own permissions — an admin must do it once:");
  console.log("  • Console: IAM → Users → " + userName + " → Add permissions → AmazonAuroraDSQLFullAccess");
  console.log("  • Or CLI with an admin key:");
  console.log(`      aws iam attach-user-policy --user-name ${userName} --policy-arn ${POLICY_ARN}`);
}
