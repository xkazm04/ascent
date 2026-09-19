"use client";

import { useState } from "react";
import { DataCharts } from "./DataCharts";
import { projects } from "./sampleProjects";
import { DiffStudy } from "./DiffStudy";
import styles from "./playground.module.css";

export function DataPlayground({ slug }: { slug: string }) {
  const [query, setQuery] = useState("");
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [events, setEvents] = useState([
    "Published design tokens",
    "Reviewed the navigation patterns",
    "Updated the component library",
  ]);
  const rows = projects
    .filter((p) => `${p.name} ${p.language}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (ascending ? a.score - b.score : b.score - a.score));
  if (slug === "data-viz" || slug === "canvas-graph") return <DataCharts slug={slug} />;
  if (slug === "diff-comparison") return <DiffStudy />;
  if (slug === "file-browsing")
    return (
      <div className={styles.demo}>
        <div className={styles.demoToolbar}>
          <button
            className={styles.textButton}
            onClick={() => {
              setFolder(null);
              setFile(null);
            }}
          >
            ⌂ Knowledge
          </button>
          <span>{folder ? `/ ${folder}` : "/"}</span>
        </div>
        <div className={styles.fileGrid}>
          {(folder ? ["Overview.md", "Principles.md", "Examples.tsx"] : ["Design", "Engineering", "Patterns"]).map(
            (name) => (
              <button key={name} onClick={() => (folder ? setFile(name) : setFolder(name))}>
                <span>{folder ? "▤" : "▰"}</span>
                {name}
              </button>
            ),
          )}
        </div>
        {file && (
          <div className={styles.insight} role="status">
            <strong>{file}</strong>
            <span>Sample document in {folder}</span>
            <p>
              {file === "Examples.tsx"
                ? "export const spacing = { small: 8, medium: 16, large: 24 };"
                : "Keep one clear hierarchy. Name actions with verbs. Reveal details when they help the next decision."}
            </p>
          </div>
        )}
      </div>
    );
  if (slug === "feed")
    return (
      <div className={styles.demo}>
        <div className={styles.demoToolbar}>
          <h3>Workspace activity</h3>
          <button onClick={() => setEvents((e) => [`Published revision ${e.length + 1}`, ...e])}>＋ Add event</button>
        </div>
        <div className={styles.eventList} aria-live="polite">
          {events.map((event, i) => (
            <div key={event}>
              <span className={styles.avatar}>{["J", "A", "M"][i % 3]}</span>
              <div>
                <strong>{event}</strong>
                <p>{i === 0 ? "Just now" : `${i * 4} minutes ago`} · Design team</p>
              </div>
              <span>↗</span>
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <div className={styles.demo}>
      <div className={styles.demoToolbar}>
        <h3>{slug === "search" ? "Find a repository" : "Repositories"}</h3>
        <span>{projects.length} in workspace</span>
      </div>
      <label className={styles.query}>
        <span aria-hidden="true">⌕</span>
        <input
          aria-label="Find repositories"
          placeholder="Search repositories or languages…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <kbd>{rows.length} found</kbd>
      </label>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>
                <span className={styles.srOnly}>Select</span>
              </th>
              <th>Repository</th>
              <th>Language</th>
              <th aria-sort={ascending ? "ascending" : "descending"}>
                <button
                  onClick={() => {
                    setAscending(!ascending);
                    setPage(0);
                  }}
                >
                  Readiness {ascending ? "↑" : "↓"}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(page * 5, page * 5 + 5).map((p) => (
              <tr key={p.name} data-selected={selected.includes(p.name)}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${p.name}`}
                    checked={selected.includes(p.name)}
                    onChange={() =>
                      setSelected((s) => (s.includes(p.name) ? s.filter((n) => n !== p.name) : [...s, p.name]))
                    }
                  />
                </td>
                <td>
                  <strong>{p.name}</strong>
                </td>
                <td>{p.language}</td>
                <td>
                  <div className={styles.score}>
                    <i style={{ width: `${p.score / 2}px` }} />
                    {p.score}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className={styles.noResults} role="status">
          No repositories match “{query}”.
        </p>
      )}
      <div className={styles.demoFooter}>
        <span role="status">{selected.length ? `${selected.length} selected` : `${rows.length} repositories`}</span>
        <div>
          <button disabled={page === 0} aria-label="Previous page" onClick={() => setPage((p) => p - 1)}>
            ←
          </button>
          <span>
            {page + 1} / {Math.max(1, Math.ceil(rows.length / 5))}
          </span>
          <button disabled={(page + 1) * 5 >= rows.length} aria-label="Next page" onClick={() => setPage((p) => p + 1)}>
            →
          </button>
        </div>
      </div>
    </div>
  );
}
