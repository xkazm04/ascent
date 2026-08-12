"use client";

// The corridor SVG for variant B — four pressurised chambers (T0…T3) separated by three sealed
// doors. Every scanned repo is a token sitting in the chamber it has actually reached; each door is
// labelled with the gates that seal it and how many repos are queued behind it. Dependency-free SVG
// on the brand tokens, per BRAND.md. Extracted from AutonomyAirlock for the 300-LOC rule.

import { scoreHex } from "@/lib/ui";
import { TIERS, TIER_META, tierHex, type AutonomyTier, type RepoAutonomy } from "./autonomyModel";

const CH_W = 200;
const DOOR_W = 60;
const LAST_W = 180;
const H = 250;
const TOP = 46;

const chamberX = (t: AutonomyTier) => t * (CH_W + DOOR_W);
const doorX = (d: number) => chamberX(d as AutonomyTier) + CH_W;
const widthOf = (t: AutonomyTier) => (t === 3 ? LAST_W : CH_W);

export interface DoorState {
  /** The tier this door opens INTO (1 | 2 | 3). */
  into: AutonomyTier;
  /** Gates that seal it. */
  gateShorts: string[];
  /** Repos queued immediately behind it (currently at `into - 1`). */
  queued: RepoAutonomy[];
  /** Mean readiness of the queued repos for this door, 0–100. */
  pressure: number;
}

export function AirlockCorridor({
  repos,
  doors,
  active,
  onDoor,
  onRepo,
  focused,
}: {
  repos: RepoAutonomy[];
  doors: DoorState[];
  active: AutonomyTier | null;
  onDoor: (into: AutonomyTier) => void;
  onRepo: (fullName: string) => void;
  focused: string | null;
}) {
  const byTier = (t: AutonomyTier) => repos.filter((r) => r.tier === t);

  return (
    <svg
      viewBox={`0 0 ${3 * (CH_W + DOOR_W) + LAST_W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Autonomy airlock: repositories held in the tier chamber they have reached, with the sealed doors between them"
    >
      {TIERS.map((t) => {
        const hex = tierHex(t);
        const x = chamberX(t);
        const w = widthOf(t);
        const held = byTier(t);
        return (
          <g key={t}>
            <rect x={x + 1} y={TOP} width={w - 2} height={H - TOP - 34} rx={10} fill="#0f172a" fillOpacity={0.55} stroke="#1e293b" />
            <rect x={x + 1} y={TOP} width={w - 2} height={3} rx={1.5} fill={hex} />
            <text x={x + 12} y={26} className="font-mono" fontSize={17} fill={hex}>
              {TIER_META[t].code}
            </text>
            <text x={x + 46} y={26} className="font-mono" fontSize={11} fill="#94a3b8" letterSpacing="1.6">
              {TIER_META[t].label.toUpperCase()}
            </text>
            <text x={x + 12} y={40} fontSize={11} fill="#64748b">
              {TIER_META[t].grant}
            </text>
            {/* Repo tokens, packed left-to-right. Each is a real repo, clickable. */}
            {held.map((r, i) => {
              const col = i % 5;
              const row = Math.floor(i / 5);
              const cx = x + 22 + col * 34;
              const cy = TOP + 30 + row * 30;
              const isFocus = focused === r.fullName;
              return (
                <g
                  key={r.fullName}
                  onClick={() => onRepo(r.fullName)}
                  className="cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onRepo(r.fullName);
                  }}
                >
                  <title>{`${r.name} — ${TIER_META[r.tier].code}, ${r.nextProgress}% toward next`}</title>
                  <circle cx={cx} cy={cy} r={isFocus ? 11 : 8} fill={hex} fillOpacity={isFocus ? 0.95 : 0.55} stroke={hex} strokeWidth={isFocus ? 2 : 1} />
                  <text x={cx} y={cy + 3.5} textAnchor="middle" className="font-mono" fontSize={8} fill="#04070e">
                    {r.name.slice(0, 2).toUpperCase()}
                  </text>
                </g>
              );
            })}
            {held.length === 0 && (
              <text x={x + w / 2} y={TOP + 60} textAnchor="middle" fontSize={11} fill="#475569">
                empty
              </text>
            )}
            <text x={x + 12} y={H - 12} className="font-mono" fontSize={12} fill="#94a3b8">
              {held.length} repo{held.length === 1 ? "" : "s"}
            </text>
          </g>
        );
      })}

      {doors.map((d) => {
        const x = doorX(d.into - 1);
        const isActive = active === d.into;
        const hex = scoreHex(d.pressure);
        const sealed = d.queued.length > 0;
        return (
          <g
            key={d.into}
            onClick={() => onDoor(d.into)}
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onDoor(d.into);
            }}
          >
            <title>{`Door into ${TIER_META[d.into].code}: ${d.gateShorts.join(" + ")} — ${d.queued.length} repo(s) queued`}</title>
            <rect
              x={x + 8}
              y={TOP}
              width={DOOR_W - 16}
              height={H - TOP - 34}
              rx={5}
              fill={sealed ? "#020617" : "#0f172a"}
              fillOpacity={0.9}
              stroke={isActive ? "#3b9eff" : sealed ? hex : "#1e293b"}
              strokeWidth={isActive ? 2 : 1}
              strokeDasharray={sealed ? undefined : "3 3"}
            />
            {/* Seal hatching reads "closed"; an open door is drawn as a dashed outline only. */}
            {sealed &&
              [0, 1, 2, 3, 4].map((i) => (
                <line
                  key={i}
                  x1={x + 8}
                  y1={TOP + 24 + i * 30}
                  x2={x + DOOR_W - 8}
                  y2={TOP + 24 + i * 30}
                  stroke={hex}
                  strokeOpacity={0.35}
                />
              ))}
            <text x={x + DOOR_W / 2} y={TOP - 8} textAnchor="middle" className="font-mono" fontSize={10} fill={sealed ? hex : "#475569"} letterSpacing="1.2">
              {d.gateShorts.join("+")}
            </text>
            <text x={x + DOOR_W / 2} y={H - 12} textAnchor="middle" className="font-mono" fontSize={12} fill={sealed ? hex : "#475569"}>
              {d.queued.length ? `↤${d.queued.length}` : "open"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
