// MCP wire protocol, revision 2026-07-28 (W5). Pure — no IO, no db, no Next.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THERE IS NO SDK HERE, AND WHY THAT IS THE RIGHT CALL NOW.
//
// The 2026-07-28 revision made MCP STATELESS. It removed the `initialize`/`notifications/initialized`
// handshake, removed protocol-level sessions and the `Mcp-Session-Id` header, removed the standalone
// GET/SSE stream, and removed stream resumability (`Last-Event-ID`). Every request now self-describes
// through `_meta`, and list results are explicitly not allowed to vary per-connection.
//
// What that means for a Next.js app on serverless: a single `force-dynamic` POST route handler IS a
// complete, conformant MCP server. There is no session store to run, no sticky routing to configure,
// no long-lived connection to keep alive across a function timeout — the three things that used to
// make "host an MCP server" a real piece of infrastructure work in this deployment shape. Pulling in
// an SDK would import transport and session machinery this revision deleted, to save writing the
// ~150 lines below.
//
// The one thing the revision ADDED that costs us anything is header/body validation (§Server
// Validation): `Mcp-Method` and `Mcp-Name` mirror body fields so intermediaries can route without
// parsing, and the server MUST reject a mismatch — otherwise a load balancer and the server could
// act on different values. That is `validateHeaders` below.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The revision this server implements. Sent back on every result's `_meta.serverInfo` era check. */
export const MCP_PROTOCOL_VERSION = "2026-07-28";

/** Revisions this server accepts. Deliberately one: earlier eras need the `initialize` handshake
 *  and session machinery this implementation does not have, and pretending otherwise would fail
 *  confusingly mid-conversation rather than clearly at the version check. */
export const SUPPORTED_PROTOCOL_VERSIONS = [MCP_PROTOCOL_VERSION] as const;

/** `_meta` keys the revision defines. Namespaced exactly as the spec writes them. */
export const META = {
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientInfo: "io.modelcontextprotocol/clientInfo",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
  serverInfo: "io.modelcontextprotocol/serverInfo",
} as const;

/**
 * JSON-RPC error codes.
 *
 * `-32020`/`-32022` come from the range the 2026-07-28 revision reserved for the specification
 * itself (`-32020`..`-32099`); `-32000`..`-32019` stays implementation-defined. They were renumbered
 * in this revision — HeaderMismatch was `-32001` in the draft — so they are named here rather than
 * inlined at call sites.
 */
export const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  headerMismatch: -32020,
  unsupportedProtocolVersion: -32022,
} as const;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export const SERVER_INFO = { name: "ascent", version: "1", title: "Ascent" } as const;

/** A successful result envelope. `resultType` is REQUIRED in this revision on every result. */
export function ok(id: string | number | null, result: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      resultType: "complete",
      ...result,
      // The spec SHOULDs that servers identify themselves in each result's `_meta`. Cheap, and it is
      // what lets a client tell which server answered when several are aggregated behind a proxy.
      _meta: { [META.serverInfo]: SERVER_INFO },
    },
  };
}

/** An error envelope. `id` is null when the request was unparseable enough to have no id. */
export function err(id: string | number | null, error: RpcError): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error };
}

/**
 * The HTTP status an error code maps to. The revision is specific about three of these, and getting
 * them wrong breaks a documented client behaviour: a client probing for era support falls back to
 * the legacy `initialize` handshake on a 400/404/405 whose body is NOT a recognized modern error, so
 * a modern server must return the right status AND a recognizable body.
 */
export function httpStatusFor(code: number): number {
  if (code === RPC.methodNotFound) return 404; // §Protocol Version Header — 404 + -32601
  if (code === RPC.headerMismatch || code === RPC.unsupportedProtocolVersion || code === RPC.invalidRequest) return 400;
  if (code === RPC.parseError) return 400;
  return 500;
}

export interface HeaderView {
  protocolVersion: string | null;
  method: string | null;
  name: string | null;
}

/** Decode the `=?base64?…?=` sentinel the revision defines for header values that are not plain ASCII. */
export function decodeHeaderValue(raw: string | null): string | null {
  if (raw == null) return null;
  const m = /^=\?base64\?(.*)\?=$/.exec(raw);
  if (!m) return raw;
  try {
    return Buffer.from(m[1] ?? "", "base64").toString("utf8");
  } catch {
    return raw;
  }
}

/** The body field `Mcp-Name` mirrors, per method. Null for methods that have no name. */
export function bodyNameFor(method: string | undefined, params: Record<string, unknown> | undefined): string | null {
  if (method === "tools/call" || method === "prompts/get") return typeof params?.name === "string" ? params.name : null;
  if (method === "resources/read") return typeof params?.uri === "string" ? params.uri : null;
  return null;
}

/**
 * §Server Validation. The headers exist so intermediaries can route and meter without parsing the
 * body; the server MUST reject a mismatch, because otherwise a load balancer routing on the header
 * and this server executing on the body would be acting on different requests. Returns an RpcError,
 * or null when the request is consistent.
 */
export function validateHeaders(h: HeaderView, body: JsonRpcRequest): RpcError | null {
  if (!h.protocolVersion) {
    return { code: RPC.headerMismatch, message: "Missing required MCP-Protocol-Version header." };
  }
  const metaVersion = (body.params?._meta as Record<string, unknown> | undefined)?.[META.protocolVersion];
  // The header must agree with the body's `_meta`. A client that sends only one of them is not
  // conformant, but a MISSING `_meta` version is tolerated: the header is the routable source of
  // truth and rejecting on absence alone would break otherwise-correct minimal clients.
  if (typeof metaVersion === "string" && metaVersion !== h.protocolVersion) {
    return {
      code: RPC.headerMismatch,
      message: `Header mismatch: MCP-Protocol-Version header '${h.protocolVersion}' does not match body value '${metaVersion}'.`,
    };
  }
  if (!(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(h.protocolVersion)) {
    return {
      code: RPC.unsupportedProtocolVersion,
      message: `Unsupported protocol version '${h.protocolVersion}'.`,
      data: { supported: [...SUPPORTED_PROTOCOL_VERSIONS] },
    };
  }
  if (!h.method) return { code: RPC.headerMismatch, message: "Missing required Mcp-Method header." };
  if (h.method !== body.method) {
    return {
      code: RPC.headerMismatch,
      message: `Header mismatch: Mcp-Method header '${h.method}' does not match body method '${body.method ?? ""}'.`,
    };
  }
  const expectedName = bodyNameFor(body.method, body.params);
  if (expectedName != null) {
    const headerName = decodeHeaderValue(h.name);
    if (headerName == null) {
      return { code: RPC.headerMismatch, message: `Missing required Mcp-Name header for ${body.method}.` };
    }
    if (headerName !== expectedName) {
      return {
        code: RPC.headerMismatch,
        message: `Header mismatch: Mcp-Name header '${headerName}' does not match body value '${expectedName}'.`,
      };
    }
  }
  return null;
}
