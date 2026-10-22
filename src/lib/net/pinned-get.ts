// A dependency-free HTTPS GET whose socket is PINNED to one address the caller already validated.
//
// Why not fetch(): fetch resolves the hostname again when it connects, so a check over a DNS answer
// and the connection that follows can see two different answers (DNS rebinding: public at the check,
// private at the connect). Here the `lookup` option hands net.connect the single validated address,
// so there is no second resolution at all. TLS still verifies the certificate against the REAL
// hostname (SNI `servername` and the Host header keep it), so pinning does not weaken TLS.
//
// No redirect is followed (a 3xx is a non-2xx answer like any other), the whole exchange runs under
// one timeout, and the body is capped while it streams, not after it lands.

import { request } from "node:https";
import { isIP } from "node:net";

export interface PinnedGetOptions {
  /** The address the socket opens. The caller has already refused private/internal addresses. */
  address: string;
  family: 4 | 6;
  maxBytes: number;
  timeoutMs: number;
  accept?: string;
}

export type PinnedGetResult =
  | { ok: true; status: number; contentType: string; bytes: Buffer }
  | { ok: false; reason: "http-status" | "too-large" | "timeout" | "network" };

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

/** GET `url` over HTTPS with the socket pinned to `opts.address`. Never throws. */
export function pinnedHttpsGet(url: URL, opts: PinnedGetOptions): Promise<PinnedGetResult> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  // net.connect asks `lookup` for the socket address; answer with the pinned one in either shape it
  // asks for (`all: true` is what autoSelectFamily uses).
  const pinnedLookup = (_host: string, options: { all?: boolean } | undefined, cb: LookupCallback) => {
    if (options?.all) cb(null, [{ address: opts.address, family: opts.family }]);
    else cb(null, opts.address, opts.family);
  };

  return new Promise<PinnedGetResult>((resolve) => {
    let settled = false;
    const finish = (r: PinnedGetResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!r.ok) req.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), opts.timeoutMs);

    const req = request(
      {
        protocol: "https:",
        hostname,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        // SNI must be a name, never an IP literal.
        servername: isIP(hostname) ? undefined : hostname,
        headers: { host: url.host, accept: opts.accept ?? "*/*" },
        lookup: pinnedLookup as never,
        agent: false, // no pooled socket that was opened against some other answer
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          return finish({ ok: false, reason: "http-status" });
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          res.destroy();
          return finish({ ok: false, reason: "too-large" });
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer | string) => {
          const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          total += buf.length;
          if (total > opts.maxBytes) {
            res.destroy();
            return finish({ ok: false, reason: "too-large" });
          }
          chunks.push(buf);
        });
        res.on("error", () => finish({ ok: false, reason: "network" }));
        res.on("end", () => {
          const contentType = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
          finish({ ok: true, status, contentType, bytes: Buffer.concat(chunks) });
        });
      },
    );
    req.on("error", () => finish({ ok: false, reason: "network" }));
    req.end();
  });
}
