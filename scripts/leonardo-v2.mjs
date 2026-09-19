// Generate on-brand, text-free ambient backdrops via Leonardo's v2 API using OpenAI's GPT Image 2
// model (model id "gpt-image-2"). The existing leonardo skill is v1-only, so this is a small,
// self-contained v2 client. Reads LEONARDO_API_KEY from the environment or from a sibling .env so the
// secret never has to pass through the shell.
//
// Usage: node scripts/leonardo-v2.mjs [altimeter|flightdeck|index|all]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";

const V2 = "https://cloud.leonardo.ai/api/rest/v2/generations";
const V1 = "https://cloud.leonardo.ai/api/rest/v1/generations";
const POLL_MS = 3000;
const MAX_POLLS = 60;

function resolveKey() {
  if (process.env.LEONARDO_API_KEY) return process.env.LEONARDO_API_KEY;
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../personas/.env"),
    "C:/Users/kazda/kiro/personas/.env",
  ];
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const line = readFileSync(p, "utf8").split(/\r?\n/).find((l) => /^\s*LEONARDO_API_KEY\s*=/.test(l));
      if (line) return line.replace(/^\s*LEONARDO_API_KEY\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
    } catch {}
  }
  return null;
}

const API_KEY = resolveKey();
if (!API_KEY) {
  console.error("LEONARDO_API_KEY not found (env or personas/.env)");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = { accept: "application/json", authorization: `Bearer ${API_KEY}`, "content-type": "application/json" };

// A prompt is either a bare string (→ default 1536×768 wide backdrop) or { prompt, width, height }
// for a custom size (the /about feature plates are 1024×1024 squares).
const PROMPTS = {
  altimeter:
    "Abstract topographic contour map, fine concentric elevation lines rising toward a summit, deep navy-to-black background, a single luminous azure-blue accent glow, dark, minimal, high-tech cartographic aesthetic, atmospheric depth, no text, no labels, no numbers, premium technology background",
  flightdeck:
    "Abstract dark mission-control head-up display atmosphere, faint blue telemetry grid and a glowing ascending trajectory arc, deep space-navy background, a single azure-blue accent glow, subtle scanlines, cinematic, minimal, no text, no readouts, no numbers, premium technology background",
  index:
    "Abstract minimal editorial paper-relief texture, subtle embossed ascending hairlines and a faint fine grid, very dark charcoal-navy, a restrained azure-blue accent, elegant, sophisticated, premium, no text, no letters, no numbers, refined background",
  // /about marketing page — one 2:1 hero backdrop + four square feature plates, all abstract + text-free.
  "about-hero":
    "Abstract editorial ascent, a luminous azure path of light climbing through layered dark strata toward a distant summit, fine embossed elevation hairlines, deep charcoal-navy, a single restrained azure-blue glow, elegant, sophisticated, premium, atmospheric depth, no text, no letters, no numbers, refined technology background",
  "about-xray": {
    prompt:
      "Abstract fleet x-ray, many small luminous nodes arranged in a precise grid across a dark field, one sweeping azure-blue scan line revealing their structure, fine telemetry hairlines, deep charcoal-navy, a restrained single azure accent, minimal, sophisticated, no text, no numbers, premium technology background",
    width: 1024,
    height: 1024,
  },
  "about-roi": {
    prompt:
      "Abstract forecasting, several diverging glowing trajectory paths over a dark grid, one azure-blue path rising clearly higher than the dimmer alternatives, a sense of projection and a chosen direction, deep navy-to-black, a restrained azure accent, minimal, elegant, no text, no numbers, premium technology background",
    width: 1024,
    height: 1024,
  },
  "about-adoption": {
    prompt:
      "Abstract influence network, interconnected luminous nodes on a dark field, a few brighter azure-blue champion nodes radiating concentric ripples of light outward through the network, deep charcoal-navy, a restrained single azure accent, minimal, sophisticated, no text, no numbers, premium technology background",
    width: 1024,
    height: 1024,
  },
  "about-risk": {
    prompt:
      "Abstract sentinel radar, concentric azure-blue rings sweeping across a dark field, detecting a few faint warning points near the edges, a calm protective scanning beam, deep navy-to-black, a restrained single azure accent, vigilant, minimal, no text, no numbers, premium technology background",
    width: 1024,
    height: 1024,
  },
};

async function generate(variant) {
  const spec = PROMPTS[variant];
  const prompt = typeof spec === "string" ? spec : spec.prompt;
  const width = (typeof spec === "object" && spec.width) || 1536;
  const height = (typeof spec === "object" && spec.height) || 768;
  const body = {
    public: false,
    model: "gpt-image-2",
    parameters: { quality: "MEDIUM", prompt, quantity: 1, width, height, prompt_enhance: "OFF" },
  };
  process.stderr.write(`[v2] creating ${variant} ...\n`);
  const res = await fetch(V2, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[v2] create failed ${res.status}: ${text.slice(0, 600)}`);
    return false;
  }
  let data;
  try { data = JSON.parse(text); } catch { console.error(`[v2] non-JSON: ${text.slice(0, 400)}`); return false; }
  process.stderr.write(`[v2] create response keys: ${JSON.stringify(Object.keys(data))}\n`);
  const id =
    data?.generate?.generationId ||
    data?.sdGenerationJob?.generationId ||
    data?.generations_by_pk?.id ||
    data?.generationId ||
    data?.generation?.id ||
    data?.id;
  if (!id) {
    console.error(`[v2] no generation id in response: ${JSON.stringify(data).slice(0, 600)}`);
    return false;
  }
  process.stderr.write(`[v2] generationId=${id}\n`);
  return pollAndSave(id, variant);
}

async function pollAndSave(id, variant) {
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_MS);
    let gen = null;
    for (const base of [V1, V2]) {
      const pr = await fetch(`${base}/${id}`, { headers });
      if (!pr.ok) continue;
      const pd = await pr.json().catch(() => null);
      gen = pd?.generations_by_pk || pd?.generation || pd?.generations?.[0] || pd;
      if (gen?.status) break;
    }
    const status = gen?.status;
    process.stderr.write(`[v2] poll ${i + 1}/${MAX_POLLS} status=${status ?? "?"}\n`);
    if (status === "FAILED") { console.error("[v2] generation FAILED"); return false; }
    const images = gen?.generated_images || gen?.images || [];
    if (status === "COMPLETE" && images.length) {
      const url = images[0]?.url || images[0]?.image?.url;
      if (!url) { console.error(`[v2] complete but no url: ${JSON.stringify(images[0]).slice(0, 300)}`); return false; }
      const imgRes = await fetch(url);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const out = resolve(process.cwd(), `public/brand/proto/${variant}-bg.png`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, buf);
      console.log(JSON.stringify({ variant, output: out, bytes: buf.length, url }));
      return true;
    }
  }
  console.error("[v2] timed out");
  return false;
}

const arg = (process.argv[2] || "all").toLowerCase();
let ok = true;
if (arg === "poll") {
  // Retrieve an already-created generation without re-charging: poll <generationId> <variant>
  ok = await pollAndSave(process.argv[3], process.argv[4] || "altimeter");
} else {
  const variants =
    arg === "all"
      ? Object.keys(PROMPTS)
      : arg === "about"
        ? Object.keys(PROMPTS).filter((v) => v.startsWith("about-"))
        : [arg];
  for (const v of variants) {
    if (!PROMPTS[v]) { console.error(`unknown variant ${v}`); ok = false; continue; }
    ok = (await generate(v)) && ok;
  }
}
process.exit(ok ? 0 : 1);
