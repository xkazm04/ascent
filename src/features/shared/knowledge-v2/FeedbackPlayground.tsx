"use client";

import { useEffect, useState } from "react";
import { AppearanceStudy } from "./AppearanceStudy";
import styles from "./playground.module.css";

export function FeedbackPlayground({ slug }: { slug: string }) {
  const [state, setState] = useState("Ready");
  useEffect(() => {
    if (state !== "Saving") return;
    const timer = setTimeout(() => setState("Saved"), 1000);
    return () => clearTimeout(timer);
  }, [state]);
  if (["design-tokens", "motion", "adaptive-fidelity-tiers"].includes(slug)) return <AppearanceStudy slug={slug} />;
  if (slug === "status-vocabulary" || slug === "async-ui-states") {
    const options =
      slug === "status-vocabulary"
        ? ["Ready", "In progress", "Complete", "Needs attention"]
        : ["Ready", "Loading", "Empty", "Error"];
    return (
      <div className={styles.demo}>
        <div className={styles.demoToolbar}>
          <h3>{slug === "status-vocabulary" ? "One task. Every state." : "The moments between."}</h3>
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
                Loading: "◌",
                Empty: "□",
                Error: "!",
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
                Loading: "Gathering your repositories…",
                Empty: "A fresh start",
                Error: "We couldn’t load your workspace",
                Complete: "All checks passed",
                "In progress": "Review in progress",
                "Needs attention": "Review needed",
              }[state]
            }
          </h3>
          {state === "Loading" ? (
            <div className={styles.skeleton}>
              <i />
              <i />
              <i />
            </div>
          ) : (
            <p>
              {state === "Empty"
                ? "Add a repository to begin."
                : state === "Error"
                  ? "Your saved work is safe."
                  : "Design system · Updated just now"}
            </p>
          )}
          {(state === "Empty" || state === "Error") && (
            <button onClick={() => setState("Ready")}>
              {state === "Error" ? "Try again" : "Add sample repository"}
            </button>
          )}
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
