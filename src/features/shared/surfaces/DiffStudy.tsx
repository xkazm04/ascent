"use client";

import { useState } from "react";
import styles from "./playground.module.css";

export function DiffStudy() {
  const [split, setSplit] = useState(true);
  const before = <pre className={styles.removed}>− &quot;version&quot;: 1</pre>;
  const after = <pre className={styles.added}>+ &quot;version&quot;: 2{"\n"}+ &quot;verified&quot;: true</pre>;
  return (
    <div className={styles.demo}>
      <div className={styles.demoToolbar}>
        <h3>manifest.json</h3>
        <div className={styles.segmented}>
          {[true, false].map((mode) => (
            <button key={String(mode)} aria-pressed={split === mode} onClick={() => setSplit(mode)}>
              {mode ? "Split" : "Unified"}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.diff} data-split={split}>
        {split ? (
          <>
            <div>
              <span>Before · v1</span>
              <pre>{'{\n  "name": "studio",\n'}</pre>
              {before}
              <pre>{"}"}</pre>
            </div>
            <div>
              <span>After · v2</span>
              <pre>{'{\n  "name": "studio",\n'}</pre>
              {after}
              <pre>{"}"}</pre>
            </div>
          </>
        ) : (
          <div>
            <span>v1 → v2</span>
            <pre>{'{\n  "name": "studio",\n'}</pre>
            {before}
            {after}
            <pre>{"}"}</pre>
          </div>
        )}
      </div>
      <div className={styles.insight}>2 additions · 1 deletion</div>
    </div>
  );
}
