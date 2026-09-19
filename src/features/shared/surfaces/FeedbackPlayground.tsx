"use client";

import { useEffect, useState } from "react";
import { Defer } from "@/components/ui/Defer";
import type { DeferStrategy } from "@/components/ui/deferPolicy";
import { STATE_HINT, STATE_LABEL, VIZ_STATES, type VizState } from "@/components/org/viz";
import { AppearanceStudy } from "./AppearanceStudy";
import styles from "./playground.module.css";

const DEFER_STRATEGIES: readonly DeferStrategy[] = ["next-frame", "idle", "visible"];

function AsyncUiStudy() {
  const [strategy, setStrategy] = useState<DeferStrategy>("next-frame");
  const [state, setState] = useState<VizState>("measured");
  return (
    <div className={styles.demo}>
      <div className={styles.demoToolbar}>
        <h3>Arrival, not loading</h3>
        <div className={styles.segmented}>
          {DEFER_STRATEGIES.map((s) => (
            <button key={s} aria-pressed={strategy === s} onClick={() => setStrategy(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.segmented}>
        {VIZ_STATES.map((s) => (
          <button key={s} aria-pressed={state === s} onClick={() => setState(s)}>
            {STATE_LABEL[s]}
          </button>
        ))}
      </div>
      <Defer
        key={strategy}
        strategy={strategy}
        placeholder={<div className={`${styles.stateStage} reveal-quiet`} aria-hidden />}
      >
        <div className={styles.stateStage}>
          <h3>{STATE_LABEL[state]}</h3>
          <p>{STATE_HINT[state]}</p>
        </div>
      </Defer>
      <p className={styles.hint} role="status">
        {state === "missing"
          ? `${STATE_LABEL.missing} is an absence, never a zero.`
          : "Defer schedules first appearance. It is not a loading state: no spinner, no skeleton, no data."}
      </p>
    </div>
  );
}

export function FeedbackPlayground({ slug }: { slug: string }) {
  const [state, setState] = useState("Ready");
  useEffect(() => {
    if (state !== "Saving") return;
    const timer = setTimeout(() => setState("Saved"), 1000);
    return () => clearTimeout(timer);
  }, [state]);
  if (["design-tokens", "motion", "adaptive-fidelity-tiers"].includes(slug)) return <AppearanceStudy slug={slug} />;
  if (slug === "async-ui-states") return <AsyncUiStudy />;
  if (slug === "status-vocabulary") {
    const options = ["Ready", "In progress", "Complete", "Needs attention"];
    return (
      <div className={styles.demo}>
        <div className={styles.demoToolbar}>
          <h3>One task. Every state.</h3>
        </div>
        <div className={styles.segmented}>
          {options.map((s) => (
            <button key={s} aria-pressed={state === s} onClick={() => setState(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className={styles.stateStage} role="status">
          <span className={styles.stateIcon} data-state={state}>
            {
              {
                Ready: "◈",
                Complete: "✓",
                "In progress": "◷",
                "Needs attention": "!",
              }[state]
            }
          </span>
          <h3>
            {
              {
                Ready: "Your workspace is ready",
                Complete: "All checks passed",
                "In progress": "Review in progress",
                "Needs attention": "Review needed",
              }[state]
            }
          </h3>
          <p>Design system · Updated just now</p>
        </div>
      </div>
    );
  }
  if (slug === "accessibility")
    return (
      <div className={styles.demo}>
        <div className={styles.demoToolbar}>
          <h3>A keyboard-friendly workspace</h3>
          <span>Tab → Space → Enter</span>
        </div>
        <form
          className={styles.accessForm}
          onSubmit={(e) => {
            e.preventDefault();
            setState("Saved");
          }}
        >
          <label>
            Workspace name
            <input name="workspace" required defaultValue="Design studio" />
          </label>
          <label>
            Notifications
            <select defaultValue="mentions">
              <option value="all">All updates</option>
              <option value="mentions">Mentions only</option>
              <option value="none">None</option>
            </select>
          </label>
          <label>
            <input type="checkbox" defaultChecked /> Include a weekly summary
          </label>
          <button type="submit">Save preferences</button>
          <p role="status">{state === "Saved" ? "✓ Preferences saved in this demo." : ""}</p>
        </form>
      </div>
    );
  return (
    <div className={styles.demo}>
      <div className={styles.demoToolbar}>
        <h3>Workspace settings</h3>
        <span>Notifications</span>
      </div>
      <div className={styles.stateStage}>
        <span className={styles.stateIcon}>↗</span>
        <h3>A quiet confirmation.</h3>
        <p>Save a change, then try undoing it.</p>
        <button disabled={state === "Saving"} onClick={() => setState("Saving")}>
          {state === "Saving" ? "Saving…" : "Save changes"}
        </button>
      </div>
      <div className={styles.notificationSlot} role="status">
        {state === "Saved" && (
          <div className={styles.notification}>
            <span>✓</span>
            <div>
              <strong>Changes saved</strong>
              <small>Your workspace is up to date.</small>
            </div>
            <button onClick={() => setState("Undone")}>Undo</button>
            <button aria-label="Dismiss notification" onClick={() => setState("Ready")}>
              ×
            </button>
          </div>
        )}
        {state === "Undone" && <p>↶ Changes undone.</p>}
      </div>
    </div>
  );
}
