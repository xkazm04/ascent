import { PreviewGraph } from "./PreviewGraph";
import styles from "./previews.module.css";

/** Decorative, code-native miniatures; the containing link supplies the accessible name. */
export function SurfacePreview({ slug }: { slug: string }) {
  const lines = (
    <>
      {[72, 48, 85, 60].map((width, i) => (
        <div key={i} className={styles.row}>
          <i />
          <span style={{ width: `${width}%` }} />
          <b />
        </div>
      ))}
    </>
  );
  let content;
  switch (slug) {
    case "table":
      content = (
        <div className={styles.sheet}>
          <div className={styles.columns}>
            <span>Repository</span>
            <span>Status</span>
          </div>
          {lines}
        </div>
      );
      break;
    case "data-viz":
      content = (
        <div className={styles.chart}>
          <div className={styles.metric}>
            84.2 <small>↗ 12.8%</small>
          </div>
          <div className={styles.bars}>
            {[32, 50, 42, 68, 58, 80, 74, 95, 85, 110, 102, 126].map((h, i) => (
              <i key={i} style={{ height: h }} />
            ))}
          </div>
        </div>
      );
      break;
    case "canvas-graph":
      content = <PreviewGraph />;
      break;
    case "diff-comparison":
      content = (
        <div className={styles.sheet}>
          <div className={styles.columns}>
            manifest.json <span>+ 2 − 1</span>
          </div>
          <pre className={styles.code}>{'{\n  "name": "studio",'}</pre>
          <pre className={styles.removed}>− &quot;version&quot;: 1</pre>
          <pre className={styles.added}>+ &quot;version&quot;: 2</pre>
          <pre className={styles.added}>+ &quot;verified&quot;: true</pre>
        </div>
      );
      break;
    case "file-browsing":
      content = (
        <div className={styles.sheet}>
          <div className={styles.columns}>⌂ &nbsp; / &nbsp; knowledge</div>
          <div className={styles.files}>
            {["Design", "Engineering", "Patterns"].map((x) => (
              <div key={x}>
                <span>▰</span>
                {x}
              </div>
            ))}
          </div>
        </div>
      );
      break;
    case "search":
      content = (
        <div className={styles.sheet}>
          <div className={styles.search}>
            ⌕ &nbsp; Find a pattern… <kbd>↵</kbd>
          </div>
          {lines}
        </div>
      );
      break;
    case "feed":
      content = (
        <div className={styles.feed}>
          {["Published a new pattern", "Updated the design system", "Reviewed 3 changes"].map((x, i) => (
            <div key={x}>
              <i>{["J", "A", "M"][i]}</i>
              <span>
                {x}
                <small>{i + 1} minutes ago</small>
              </span>
            </div>
          ))}
        </div>
      );
      break;
    case "design-tokens":
      content = (
        <div className={styles.palette}>
          <div>
            {["var(--kb-accent)", "var(--kb-green)", "var(--kb-warn)", "var(--kb-danger)", "var(--kb-text)"].map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </div>
          <strong>
            Aa <small>Aa</small>
          </strong>
          <span>Color · Type · Space</span>
        </div>
      );
      break;
    case "motion":
      content = (
        <div className={styles.orbit}>
          <span />
          <span />
          <span />
          <b>↗</b>
        </div>
      );
      break;
    case "status-vocabulary":
      content = (
        <div className={styles.statuses}>
          <span>✓ &nbsp; Complete</span>
          <span>◷ &nbsp; In progress</span>
          <span>! &nbsp; Needs attention</span>
        </div>
      );
      break;
    case "toasts-notifications":
      content = (
        <div className={styles.toast}>
          <i>✓</i>
          <div>
            Changes saved<small>Your workspace is up to date.</small>
          </div>
          <span>↶</span>
        </div>
      );
      break;
    case "accessibility":
      content = (
        <div className={styles.keys}>
          <div>
            <kbd>tab</kbd>
            <kbd>↵</kbd>
            <kbd>esc</kbd>
          </div>
          <span>Every path. Everyone.</span>
        </div>
      );
      break;
    case "async-ui-states":
      content = (
        <div className={styles.sheet}>
          <div className={styles.columns}>
            Your workspace <span>◌</span>
          </div>
          {lines}
          <div className={styles.progress}>
            <i />
          </div>
        </div>
      );
      break;
    case "adaptive-fidelity-tiers":
      content = (
        <div className={styles.fidelity}>
          {[30, 50, 70, 90, 110].map((h, i) => (
            <i key={h} style={{ height: h, opacity: 0.3 + i * 0.17 }} />
          ))}
          <span>Adapts to you</span>
        </div>
      );
      break;
    default:
      content = (
        <div className={styles.reference}>
          <span>▤</span>
          <div>{lines}</div>
        </div>
      );
  }
  return (
    <div className={styles.preview} aria-hidden="true" data-preview={slug}>
      {content}
    </div>
  );
}
