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
// HONEST LIMIT: this is bearer-token auth, not the OAuth 2.1 resource-server flow the revision
// describes. A `WWW-Authenticate` challenge is emitted on 401 so a client is told how to
// authenticate, but ascent is not yet an OAuth resource server with a paired authorization server.
// Claiming otherwise in a spec-conformance sense would be an over-claim; the door works, and the
// upgrade path is real.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { verifyOrgApiToken, type SkillTokenScope } from "@/lib/db";
import { runTool } from "@/lib/mcp/handlers";
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
import { rateLimitRequest, tooManyRequests, GATE_RATE_LIMIT } from "@/lib/rate-limit";

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
  const scopes = token.scopes as SkillTokenScope[];
  if (!scopes.includes("mcp:read")) {
    return rpc(
      err(null, { code: RPC.invalidRequest, message: "This token lacks the mcp:read scope." }),
      403,
      { "www-authenticate": `${CHALLENGE}, error="insufficient_scope"` },
    );
  }

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
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

  const allowed = toolsForScopes(scopes);

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
      if (!def || !allowed.some((t) => t.name === name)) {
        return rpc(err(id, { code: RPC.invalidParams, message: `Unknown tool: ${name}` }), 400);
      }
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await runTool(name, token.orgSlug, args);
        const text = result.text ?? JSON.stringify(result.structuredContent, null, 2);
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
