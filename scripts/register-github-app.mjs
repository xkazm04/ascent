// One-click GitHub App registration via the App Manifest flow (the only programmatic path — a PAT
// cannot create an App). Starts a tiny local server: open http://localhost:7799, click "Create GitHub
// App" on GitHub's pre-filled review page, and GitHub redirects back with a code that this server
// exchanges for ALL the app credentials (id, slug, webhook secret, private key, client id/secret).
// Writes them to <tmp>/ascent-github-app.json and exits.
//
//   node --env-file=.env scripts/register-github-app.mjs

import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const PORT = 7799;
const OUT = join(tmpdir(), "ascent-github-app.json");
const state = randomBytes(8).toString("hex");

// Production host for the app's operational URLs (editable later in the App settings).
let host = (process.env.ASCENT_PUBLIC_URL || "").trim().replace(/\/+$/, "");
if (host && !/^https?:\/\//.test(host)) host = "https://" + host;
if (!host) host = "https://example.com"; // placeholder; fix on the review page

const manifest = {
  name: "ascent-maturity-xkazm04",
  url: host,
  hook_attributes: { url: `${host}/api/app/webhook`, active: true },
  redirect_url: `http://localhost:${PORT}/callback`,
  setup_url: `${host}/api/app/setup`,
  setup_on_update: true,
  callback_urls: [`${host}/api/auth/callback`, "http://localhost:3000/api/auth/callback"],
  public: true,
  default_permissions: {
    metadata: "read",
    contents: "read",
    pull_requests: "write",
    checks: "write",
    members: "read",
  },
  default_events: ["installation", "pull_request", "push"],
};

const page = `<!doctype html><meta charset="utf-8"><title>Register Ascent GitHub App</title>
<body style="font:16px system-ui;max-width:640px;margin:60px auto;padding:0 20px;color:#0b1322">
<h2>Register the Ascent GitHub App</h2>
<p>Clicking the button sends a pre-filled manifest to GitHub. On GitHub's page, review it and press
<b>"Create GitHub App"</b>. You'll be redirected back here and the credentials captured automatically.</p>
<form id="f" method="post" action="https://github.com/settings/apps/new?state=${state}">
  <input type="hidden" name="manifest" id="m">
  <button type="submit" style="font:600 16px system-ui;background:#3b9eff;color:#04070e;border:0;border-radius:10px;padding:12px 20px;cursor:pointer">Create the Ascent GitHub App →</button>
</form>
<script>document.getElementById('m').value = ${JSON.stringify(JSON.stringify(manifest))};</script>
</body>`;

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(page);
  }
  if (u.pathname === "/callback") {
    const code = u.searchParams.get("code");
    if (u.searchParams.get("state") !== state || !code) {
      res.writeHead(400, { "content-type": "text/html" });
      return res.end("<p>Bad state or missing code. Re-open http://localhost:7799 and retry.</p>");
    }
    try {
      const r = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
        method: "POST",
        headers: { Accept: "application/vnd.github+json", "User-Agent": "ascent-setup" },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
      const out = {
        app_id: j.id,
        slug: j.slug,
        name: j.name,
        webhook_secret: j.webhook_secret,
        pem: j.pem,
        pem_b64: Buffer.from(j.pem, "utf8").toString("base64"),
        client_id: j.client_id,
        client_secret: j.client_secret,
        html_url: j.html_url,
        owner: j.owner?.login,
      };
      writeFileSync(OUT, JSON.stringify(out, null, 2));
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<body style="font:18px system-ui;max-width:560px;margin:80px auto;text-align:center">
        <h2>✓ App created: ${out.slug}</h2><p>Credentials captured. You can close this tab and return to the terminal.</p></body>`);
      console.log("\n✓ App created:", out.slug, "(app_id", out.app_id + ")");
      console.log("  written to:", OUT);
      setTimeout(() => { server.close(); process.exit(0); }, 300);
    } catch (e) {
      res.writeHead(500, { "content-type": "text/html" });
      res.end(`<p>Conversion failed: ${e.message}</p>`);
      console.error("✗ conversion failed:", e.message);
      setTimeout(() => { server.close(); process.exit(1); }, 300);
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Manifest server listening — open:  http://localhost:${PORT}`);
  console.log(`App URLs target: ${host}  (editable on GitHub's review page)`);
});

// Don't hang forever if the user never completes the flow.
setTimeout(() => { console.error("timed out after 45 min — re-run to retry"); server.close(); process.exit(1); }, 45 * 60_000);
