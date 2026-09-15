// POST /api/mcp — the agent door (W5). An MCP server, revision 2026-07-28.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THIS IS THE WHOLE SERVER. That is a fact about the 2026-07-28 revision, not about how little it
// does: the revision removed the `initialize` handshake, protocol sessions, the `Mcp-Session-Id`
// header, the standalone GET/SSE stream and stream resumability. Every request self-describes. So a
// single `force-dynamic` POST handler is conformant, with no session store, no sticky routing, and
// no long-lived connection fighting a serverless function timeout.
//
// AUTH. One org-scoped API token (`Authorization: Bearer askl_…`) identifies BOTH the caller and the
// org — there is no `?org=` to get wrong or to enumerate. Tools are filtered to the token's granted
// scopes, which the revision explicitly permits ("the tool set MAY vary by the authorization
// presented on the request … credentials are per-request input, not connection state").
//
// TWO AUTHORIZATIONS, NOT ONE (moonshot #17). A token's SCOPES say what this caller may do; the
// workspace's PLAN says what this org has. The door used to check only the first, so an `mcp:read` +
// `memory:read` token read an org's Shared Memory on any plan while `POST /api/org/memory` refused
// the same read — and where two doors onto one store disagree, the looser one is the policy. Both are
// now checked, and they refuse DIFFERENTLY on purpose: a scope refusal is opaque (`Unknown tool`) so
// the door cannot be used to enumerate an org's surface, a plan refusal is stated in words because
// the caller already holds this org's own token and is owed a fact it can act on.
//
// TWO RATE LIMITS, IN LADDER ORDER. The pre-auth one is per IP (`GATE_RATE_LIMIT`) and exists to make
// an unauthenticated flood cheap — it is charged before any body handling or token crypto. It cannot
// be the real budget: with `trustedProxyHops() === 0` (the default) `clientIp` is the shared
// "unknown" bucket, so on a self-hosted deployment every agent on earth would share one window. The
// budget that matters is charged AFTER the token is verified, keyed on the token id
// (`MCP_RATE_LIMIT`), because an authenticated door does not have to guess who is calling.
//
// AND A BODY CAP, before the parse, using the ingest door's own `readCappedBody` rather than a second
// implementation of it: this is the other route in the app an arbitrary body arrives at behind a
// bearer token, and an unbounded `req.json()` lets one request pin an instance's memory.
//
// IDENTITY IS THE TOKEN ID. Both the audit actor (`token:<id>`) and the work-queue holder
// (`agent:<id>`) key on the token's id, never its name — names are not unique, so a name-keyed
// identity made two tokens called `ci` one holder and one daily counter. The name travels as a label.
//
// HONEST LIMIT: this is bearer-token auth, not the OAuth 2.1 resource-server flow the revision
// describes. A `WWW-Authenticate` challenge is emitted on 401 so a client is told how to
// authenticate, but ascent is not yet an OAuth resource server with a paired authorization server.
// Claiming otherwise in a spec-conformance sense would be an over-claim; the door works, and the
// upgrade path is real.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { recordOrgAudit, verifyOrgApiToken, type SkillTokenScope } from "@/lib/db";
import { assertWriteAllowed, WRITE_TOOL_POLICY } from "@/lib/mcp/write-gate";
import { runTool, toolResultText } from "@/lib/mcp/handlers";
import {
  err,
  httpStatusFor,
  MCP_PROTOCOL_VERSION,
  ok,
  RPC,
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSIONS,
  validateHeaders,
  type JsonRpcRequest,
} from "@/lib/mcp/protocol";
import { MCP_TOOLS, TOOLS_CACHE_SCOPE, TOOLS_TTL_MS, toolsForScopes, toWireTool } from "@/lib/mcp/tools";
import { countTokenWritesToday, gateOpen, planRefusal, resolveMcpGates } from "@/app/api/mcp/gates";
import { rateLimitKeyed, rateLimitRequest, tooManyRequests, GATE_RATE_LIMIT, MCP_RATE_LIMIT } from "@/lib/rate-limit";
import { readCappedBody } from "@/lib/integrations/ingest-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** §Security & Endpoint — the transport MUST reject an invalid Origin (DNS-rebinding defence). An
 *  absent Origin is a non-browser client (the normal case for an agent) and is allowed. */
function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) return false; // fail closed: with no configured origin we cannot verify one
  try {
    return new URL(origin).origin === new URL(site).origin;
  } catch {
    return false;
  }
}

const CHALLENGE = 'Bearer realm="ascent", scope="mcp:read"';

/**
 * Max accepted request body. A JSON-RPC frame here is a method, an id and a tool's arguments — the
 * largest realistic one is a `report_attempt` whose `reason` is a paragraph, a few KB. 64 KB is an
 * order of magnitude of headroom over that while bounding a hostile body; the named ceiling is
 * checked before the value is used, the same convention `/api/org/issue` and the ingest door keep.
 */
const MCP_MAX_BODY = 64_000;

function rpc(body: Record<string, unknown>, status: number, extra?: Record<string, string>): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store", ...(extra ?? {}) },
  });
}

export async function POST(req: Request) {
  if (!originAllowed(req)) {
    return rpc(err(null, { code: RPC.invalidRequest, message: "Origin not allowed." }), 403);
  }
  // Charged before any body handling or token crypto, like the ingest front door.
  const rl = rateLimitRequest(req, GATE_RATE_LIMIT);
  // Whole result: this door is driven by MCP clients and agents, which retry on a schedule. Naming
  // the scope lets one back off correctly — `ip` means its own budget (stated, with the window),
  // `global` means retrying harder cannot help. Deliberately not the JSON-RPC envelope: the request
  // is refused before any body parse, so there is no request id to answer, which is why this gate
  // has always returned a plain JSON 429 rather than an `err(null, ...)` frame.
  if (!rl.ok) return tooManyRequests(rl);

  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  if (!bearer) {
    return rpc(err(null, { code: RPC.invalidRequest, message: "Missing bearer token." }), 401, {
      "www-authenticate": CHALLENGE,
    });
  }
  const token = await verifyOrgApiToken(bearer);
  if (!token) {
    return rpc(err(null, { code: RPC.invalidRequest, message: "Invalid or revoked API token." }), 401, {
      "www-authenticate": CHALLENGE,
    });
  }
  // THE REAL BUDGET, keyed on the verified credential (see the header). Charged before the scope
  // check so a token looping on tools it cannot reach is throttled like any other caller.
  const tokenRl = rateLimitKeyed(token.tokenId, MCP_RATE_LIMIT);
  if (!tokenRl.ok) return tooManyRequests(tokenRl);

  const scopes = token.scopes as SkillTokenScope[];
  if (!scopes.includes("mcp:read")) {
    return rpc(
      err(null, { code: RPC.invalidRequest, message: "This token lacks the mcp:read scope." }),
      403,
      { "www-authenticate": `${CHALLENGE}, error="insufficient_scope"` },
    );
  }

  let body: JsonRpcRequest;
  const raw = await readCappedBody(req, MCP_MAX_BODY);
  if (!raw.ok) {
    // A PROTOCOL error, not a tool result: nothing was parsed, so there is no request id to answer
    // and no model-fixable argument to name — the frame itself is inadmissible.
    return rpc(
      err(null, {
        code: RPC.invalidRequest,
        message: `Request body exceeds ${MCP_MAX_BODY} bytes. A JSON-RPC frame at this door is a tool name and its arguments; send less.`,
      }),
      413,
    );
  }
  try {
    body = JSON.parse(raw.text) as JsonRpcRequest;
  } catch {
    return rpc(err(null, { code: RPC.parseError, message: "Invalid JSON." }), 400);
  }
  const id = body.id ?? null;

  const headerError = validateHeaders(
    {
      protocolVersion: req.headers.get("mcp-protocol-version"),
      method: req.headers.get("mcp-method"),
      name: req.headers.get("mcp-name"),
    },
    body,
  );
  if (headerError) return rpc(err(id, headerError), httpStatusFor(headerError.code));

  const scoped = toolsForScopes(scopes);
  // TWO filters, in this order and never collapsed into one. Scopes are what this TOKEN may do; the
  // plan is what this WORKSPACE has. `server/discover` needs neither, so the gates are resolved only
  // for the two methods that can name a tool — a discovery probe must not cost a credit-state read.
  const needsGates = body.method === "tools/list" || body.method === "tools/call";
  const gates = needsGates
    ? await resolveMcpGates(token.orgSlug)
    : { memory: false as boolean, skills: false as boolean };
  const allowed = scoped.filter((t) => gateOpen(gates, t.planGate));

  switch (body.method) {
    // MUST be implemented by every server in this revision: it is how a client selects a version
    // up-front and how it probes an unknown endpoint for era support.
    case "server/discover":
      return rpc(
        ok(id, {
          protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
          serverInfo: SERVER_INFO,
          // `listChanged: false` is the honest declaration: the catalog is a compile-time constant
          // and this server hosts no `subscriptions/listen` stream, so promising change
          // notifications would advertise a channel that never fires.
          capabilities: { tools: { listChanged: false } },
        }),
        200,
      );

    case "tools/list":
      return rpc(
        ok(id, {
          tools: allowed.map(toWireTool),
          // REQUIRED on list results in this revision. `private` because the list varies by the
          // caller's scopes — a shared cache serving one org's list to another would leak which
          // tools that token reaches.
          ttlMs: TOOLS_TTL_MS,
          cacheScope: TOOLS_CACHE_SCOPE,
        }),
        200,
      );

    case "tools/call": {
      const name = typeof body.params?.name === "string" ? body.params.name : "";
      const def = MCP_TOOLS.find((t) => t.name === name);
      // An unknown tool is a PROTOCOL error (the request names something that does not exist); a
      // tool that exists but is out of scope is answered the same way ON PURPOSE, so the door does
      // not become an oracle for which tools an org has that this token cannot reach.
      if (!def || !scoped.some((t) => t.name === name)) {
        return rpc(err(id, { code: RPC.invalidParams, message: `Unknown tool: ${name}` }), 400);
      }
      // A PLAN refusal is answered in words, and the split from the opaque scope refusal above is the
      // whole point. A caller past the scope check holds this org's own token for a tool this org's
      // token type carries — it has proven it belongs here — so "your workspace's plan does not
      // include this" is a fixable fact it is owed. Reported as a tool-execution error (isError on a
      // 200) rather than a protocol error, because the model should choose another tool, not decide
      // the server is broken.
      if (def.planGate && !gateOpen(gates, def.planGate)) {
        const reason = planRefusal(def.planGate);
        return rpc(
          ok(id, {
            content: [{ type: "text", text: reason }],
            structuredContent: { error: reason, reason: "plan", gate: def.planGate },
            isError: true,
          }),
          200,
        );
      }
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>;

      // THE WRITE DOOR. Only tools the catalog marks `mutates` reach this block, and only after the
      // scope and plan gates above — this is the third gate, not the first. `actorId` is what the
      // org's audit viewer shows and what the daily ceiling is counted against.
      //
      // KEYED ON THE TOKEN ID, NOT ITS NAME. `createOrgApiToken` enforces no uniqueness on a name, so
      // `token:ci` was one bucket for every token an org happened to call `ci` — two agents shared one
      // `perTokenDailyMax` and one entry in the audit viewer's actor column. The id is unique by
      // construction; the NAME rides along in the audit meta as a label, which is where a
      // human-readable string belongs and where an ambiguous one costs nothing.
      const actorId = `token:${token.tokenId}`;
      const policy = def.mutates ? WRITE_TOOL_POLICY[name] : undefined;
      if (def.mutates) {
        if (!policy) {
          // Fails CLOSED. A catalog entry marked `mutates` with no policy row is a half-finished
          // write tool; write-gate.test.ts makes that state uncommittable, and this is the runtime
          // half of the same rule.
          return rpc(err(id, { code: RPC.invalidParams, message: `Unknown tool: ${name}` }), 400);
        }
        const writesToday = await countTokenWritesToday(token.orgSlug, actorId, policy.auditAction);
        const denial = assertWriteAllowed({
          tool: name,
          scopes,
          gates,
          tokenId: token.tokenId,
          writesToday,
        });
        if (denial) {
          return rpc(
            ok(id, {
              content: [{ type: "text", text: denial.denied }],
              structuredContent: { error: denial.denied, reason: "write_gate" },
              isError: true,
            }),
            200,
          );
        }
      }

      try {
        // THE PRINCIPAL (moonshot #3). `actorId` above is the AUDIT label; this is the WORK identity
        // stored in `Recommendation.claimActor` and compared on every later call by this token. They
        // are deliberately different strings: the audit trail records how a call authenticated, the
        // ledger records what held the row, and collapsing the two would make the ledger's holder
        // comparison depend on the credential type it happened to arrive under.
        const result = await runTool(name, token.orgSlug, args, {
          actor: `agent:${token.tokenId}`,
          // TRANSITIONAL: rows claimed before 2026-09-05 stored `agent:<name>`, and their holder must
          // still be able to brief and report on them. `followup-claims.ts`'s `holderActors` matches
          // either form; that arm (and this field) come out once every such lease has lapsed — hours,
          // not weeks — leaving the id as the only holder identity.
          legacyActor: `agent:${token.name}`,
          tokenId: token.tokenId,
          label: token.name,
        });
        // ONE AUDIT ROW PER ACCEPTED WRITE, after the handler and only when it did not report an
        // error — an audit trail of attempts that failed validation would drown the trail of actual
        // changes. `args` is recorded as its KEY SHAPE plus the idempotency key, never verbatim: a
        // citation `note` is free text an agent wrote and the audit trail is not a second place for
        // it to be stored and re-read.
        if (policy && !result.isError) {
          await recordOrgAudit(
            policy.auditAction,
            token.orgSlug,
            {
              tool: name,
              tokenId: token.tokenId,
              // The name is a LABEL beside the id, never the key: it is what makes the audit row
              // readable to the person who minted the token, and it is not unique.
              tokenName: token.name,
              argKeys: Object.keys(args).sort(),
              idempotencyKey: policy.idempotencyKey(token.orgSlug, args),
            },
            actorId,
          );
        }
        // Serialized by the shared helper, not inline: Athena dispatches these same handlers in-process
        // (src/lib/athena/grounding.ts), and both doors must show the model byte-identical text.
        const text = toolResultText(result);
        return rpc(
          ok(id, {
            content: [{ type: "text", text }],
            structuredContent: result.structuredContent,
            isError: Boolean(result.isError),
          }),
          200,
        );
      } catch (e) {
        console.error("[mcp] tool failed", { tool: name, err: e });
        // A crash is reported as a TOOL EXECUTION error, not a protocol error: the revision says
        // clients SHOULD hand these to the model, which can then choose a different approach rather
        // than treating the whole server as broken.
        return rpc(
          ok(id, {
            content: [{ type: "text", text: `The ${name} tool failed. This is a server-side error, not a problem with your arguments.` }],
            isError: true,
          }),
          200,
        );
      }
    }

    default:
      // §Protocol Version Header — an unimplemented method is 404 + -32601, and the JSON-RPC body is
      // what distinguishes this from a legacy server that simply has no MCP endpoint here.
      return rpc(err(id, { code: RPC.methodNotFound, message: `Method not found: ${body.method ?? ""}` }), 404);
  }
}

/** §Backward Compatibility — this revision has no GET stream and no DELETE session teardown. */
export async function GET() {
  return NextResponse.json(
    { error: `This endpoint speaks MCP ${MCP_PROTOCOL_VERSION}, which is POST-only. The GET/SSE stream was removed in this revision.` },
    { status: 405, headers: { allow: "POST" } },
  );
}

export const DELETE = GET;
