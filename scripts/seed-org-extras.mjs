// Seed the demo-only org extras that scans DON'T produce — Goals, Segments (+ repo tags), and Members
// — so the Plan / Segments / Members tabs render populated for a demo. Drives the existing org APIs on
// a running dev server (requires DATABASE_URL + ASCENT_AUTH_BYPASS=1 + ASCENT_OPEN_ORG_DASHBOARDS=1).
//
// Usage: node scripts/seed-org-extras.mjs [baseUrl] [org]
import http from "node:http";

const base = new URL(process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3001");
const org = (process.argv[2]?.startsWith("http") ? process.argv[3] : process.argv[2]) || "vercel";

function post(path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: base.hostname,
        port: base.port || 80,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
          origin: base.origin, // satisfies the same-origin CSRF check on the members route
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: buf }));
      },
    );
    req.on("error", (e) => resolve({ error: e.message }));
    req.write(data);
    req.end();
  });
}

const ok = (r) => r.status >= 200 && r.status < 300;
const line = (kind, name, r) =>
  console.log(`  ${ok(r) ? "✓" : "✗"} ${kind.padEnd(8)} ${String(name).padEnd(28)} ${r.error ?? r.status}${ok(r) ? "" : "  " + String(r.body).slice(0, 120)}`);

const GOALS = [
  { label: "Org-wide L4 (Integrated)", metric: "overall", target: 75, targetDate: "2026-12-31" },
  { label: "Lift AI adoption to 60", metric: "adoption", target: 60, targetDate: "2026-09-30" },
  { label: "Automated testing (D2) to 70", metric: "D2", target: 70, targetDate: "2026-10-31" },
  { label: "Supply-chain security (D9) to 65", metric: "D9", target: 65, targetDate: "2026-11-30" },
];

const SEGMENTS = [
  { name: "Frameworks", color: "#3b9eff", repos: ["vercel/next.js", "vercel/turborepo", "vercel/swr"] },
  { name: "AI / SDK", color: "#a855f7", repos: ["vercel/ai", "vercel/sdk", "vercel/workflow"] },
  { name: "Infra / Edge", color: "#14b8a6", repos: ["vercel/storage", "vercel/flags", "vercel/otel"] },
  { name: "Examples & Apps", color: "#f59e0b", repos: ["vercel/examples", "vercel/shop", "vercel/chat"] },
];

const MEMBERS = [
  { login: "rauchg", role: "owner" },
  { login: "leerob", role: "admin" },
  { login: "shuding", role: "member" },
  { login: "timneutkens", role: "member" },
  { login: "styfle", role: "viewer" },
];

console.log(`Seeding org extras for "${org}" via ${base.origin}\n\nGoals:`);
for (const g of GOALS) line("goal", g.label, await post("/api/org/goals", { org, ...g }));

console.log("\nSegments:");
for (const s of SEGMENTS) {
  const r = await post("/api/org/segments", { org, name: s.name, color: s.color });
  let id = null;
  try { id = JSON.parse(r.body).id; } catch {}
  if (!ok(r) || !id) { line("segment", s.name, r); continue; }
  const t = await post(`/api/org/segments/${id}/repos/bulk`, { org, fullNames: s.repos });
  line("segment", `${s.name} (+${s.repos.length} repos)`, t);
}

console.log("\nMembers:");
for (const m of MEMBERS) line("member", `${m.login} (${m.role})`, await post("/api/org/members", { org, login: m.login, role: m.role }));

console.log("\nDone.");
