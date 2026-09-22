/** Package/version pairs that OSV can query from supported committed lockfiles. */
export interface OsvDep { name: string; version: string; ecosystem: "npm" | "crates.io" }

const validVersion = (v: string) => /^\d/.test(v);

export function parsePnpmDeps(text: string): OsvDep[] {
  const out: OsvDep[] = [];
  const seen = new Set<string>();
  let packages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) { packages = true; continue; }
    if (/^[^\s#][^:]*:/.test(line)) packages = false;
    if (!packages) continue;
    const match = /^  (?:'([^']+)'|"([^"]+)"|([^\s:]+)):\s*(?:#.*)?$/.exec(line);
    if (!match) continue;
    const key = (match[1] ?? match[2] ?? match[3] ?? "").replace(/^\//, "").split("(")[0]!;
    const at = key.lastIndexOf("@");
    if (at <= 0) continue;
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    if (!validVersion(version) || seen.has(`${name}@${version}`)) continue;
    seen.add(`${name}@${version}`);
    out.push({ name, version, ecosystem: "npm" });
  }
  return out;
}

export function parseCargoDeps(text: string): OsvDep[] {
  const out: OsvDep[] = [];
  const seen = new Set<string>();
  let current: { name?: string; version?: string; source?: string } | null = null;
  const finish = () => {
    if (!current?.name || !current.version || !validVersion(current.version) ||
      !current.source?.startsWith("registry+")) return;
    const key = `${current.name}@${current.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: current.name, version: current.version, ecosystem: "crates.io" });
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^\[\[/.test(line)) {
      finish();
      current = line.trim() === "[[package]]" ? {} : null;
      continue;
    }
    if (!current) continue;
    const field = /^\s*(name|version|source)\s*=\s*"([^"]+)"/.exec(line);
    if (field) current[field[1] as "name" | "version" | "source"] = field[2];
  }
  finish();
  return out;
}
