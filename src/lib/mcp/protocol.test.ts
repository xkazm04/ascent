import { describe, expect, it } from "vitest";
import {
  bodyNameFor,
  decodeHeaderValue,
  err,
  httpStatusFor,
  MCP_PROTOCOL_VERSION,
  META,
  ok,
  RPC,
  validateHeaders,
} from "./protocol";

const meta = (version = MCP_PROTOCOL_VERSION) => ({ [META.protocolVersion]: version });

describe("result envelopes", () => {
  // `resultType` became REQUIRED on every result in 2026-07-28. A client is entitled to read its
  // absence as an earlier-era server.
  it("stamps resultType: complete and identifies the server", () => {
    const r = ok(1, { tools: [] }) as { result: Record<string, unknown> };
    expect(r.result.resultType).toBe("complete");
    expect((r.result._meta as Record<string, unknown>)[META.serverInfo]).toMatchObject({ name: "ascent" });
  });

  it("carries a null id when the request had none", () => {
    expect(err(null, { code: RPC.parseError, message: "x" })).toMatchObject({ jsonrpc: "2.0", id: null });
  });
});

describe("httpStatusFor", () => {
  // These three are spec-mandated, and getting them wrong breaks a documented client behaviour: a
  // client probing for era support falls back to the legacy `initialize` handshake on a 400/404/405
  // whose body is not a recognized modern error.
  it("maps method-not-found to 404 and the validation errors to 400", () => {
    expect(httpStatusFor(RPC.methodNotFound)).toBe(404);
    expect(httpStatusFor(RPC.headerMismatch)).toBe(400);
    expect(httpStatusFor(RPC.unsupportedProtocolVersion)).toBe(400);
  });

  it("maps anything else to 500", () => {
    expect(httpStatusFor(RPC.internalError)).toBe(500);
  });
});

describe("bodyNameFor — which body field Mcp-Name mirrors", () => {
  it("uses params.name for tools/call and prompts/get", () => {
    expect(bodyNameFor("tools/call", { name: "get_repo_standing" })).toBe("get_repo_standing");
    expect(bodyNameFor("prompts/get", { name: "p" })).toBe("p");
  });

  it("uses params.uri for resources/read", () => {
    expect(bodyNameFor("resources/read", { uri: "file:///x" })).toBe("file:///x");
  });

  it("is null for methods that carry no name", () => {
    expect(bodyNameFor("tools/list", {})).toBeNull();
    expect(bodyNameFor("server/discover", {})).toBeNull();
  });
});

describe("decodeHeaderValue — the =?base64?…?= sentinel", () => {
  it("passes a plain ASCII value through untouched", () => {
    expect(decodeHeaderValue("get_weather")).toBe("get_weather");
  });

  it("decodes an encoded value", () => {
    const encoded = `=?base64?${Buffer.from("Hello, 世界", "utf8").toString("base64")}?=`;
    expect(decodeHeaderValue(encoded)).toBe("Hello, 世界");
  });

  it("degrades to the raw value rather than throwing on malformed base64", () => {
    expect(decodeHeaderValue("=?base64?!!!not-base64!!!?=")).toBeTypeOf("string");
  });

  it("is null-safe", () => {
    expect(decodeHeaderValue(null)).toBeNull();
  });
});

describe("validateHeaders", () => {
  const base = { protocolVersion: MCP_PROTOCOL_VERSION, method: "tools/list", name: null };
  const body = { method: "tools/list", params: { _meta: meta() } };

  it("accepts a consistent request", () => {
    expect(validateHeaders(base, body)).toBeNull();
  });

  it("requires the protocol version header", () => {
    expect(validateHeaders({ ...base, protocolVersion: null }, body)?.code).toBe(RPC.headerMismatch);
  });

  it("rejects a version header that disagrees with the body's _meta", () => {
    const e = validateHeaders(base, { method: "tools/list", params: { _meta: meta("2025-11-25") } });
    expect(e?.code).toBe(RPC.headerMismatch);
    expect(e?.message).toContain("does not match body value");
  });

  // A minimal-but-correct client that sends the header and omits the `_meta` mirror is tolerated:
  // the header is the routable source of truth, and rejecting on absence alone would break clients
  // that are otherwise fine.
  it("tolerates a body with no _meta version", () => {
    expect(validateHeaders(base, { method: "tools/list", params: {} })).toBeNull();
    expect(validateHeaders(base, { method: "tools/list" })).toBeNull();
  });

  it("rejects an unsupported protocol version and lists what it supports", () => {
    const e = validateHeaders({ ...base, protocolVersion: "2025-03-26" }, { method: "tools/list" });
    expect(e?.code).toBe(RPC.unsupportedProtocolVersion);
    expect((e?.data as { supported: string[] }).supported).toContain(MCP_PROTOCOL_VERSION);
  });

  it("requires the Mcp-Method header", () => {
    expect(validateHeaders({ ...base, method: null }, body)?.code).toBe(RPC.headerMismatch);
  });

  // THE reason header validation exists: a load balancer routing on the header while the server
  // executes on the body would be acting on two different requests.
  it("rejects a method header that disagrees with the body method", () => {
    const e = validateHeaders({ ...base, method: "tools/call" }, body);
    expect(e?.code).toBe(RPC.headerMismatch);
    expect(e?.message).toContain("does not match body method");
  });

  it("requires Mcp-Name on tools/call", () => {
    const call = { method: "tools/call", params: { name: "get_ai_stance", _meta: meta() } };
    const e = validateHeaders({ ...base, method: "tools/call", name: null }, call);
    expect(e?.code).toBe(RPC.headerMismatch);
    expect(e?.message).toContain("Missing required Mcp-Name");
  });

  it("rejects an Mcp-Name that disagrees with the body", () => {
    const call = { method: "tools/call", params: { name: "get_ai_stance", _meta: meta() } };
    expect(validateHeaders({ ...base, method: "tools/call", name: "other_tool" }, call)?.code).toBe(RPC.headerMismatch);
  });

  it("compares Mcp-Name after decoding the base64 sentinel", () => {
    const call = { method: "tools/call", params: { name: "héllo", _meta: meta() } };
    const encoded = `=?base64?${Buffer.from("héllo", "utf8").toString("base64")}?=`;
    expect(validateHeaders({ ...base, method: "tools/call", name: encoded }, call)).toBeNull();
  });

  it("does not require Mcp-Name on a method that has no name", () => {
    expect(validateHeaders({ ...base, method: "server/discover", name: null }, { method: "server/discover" })).toBeNull();
  });
});
