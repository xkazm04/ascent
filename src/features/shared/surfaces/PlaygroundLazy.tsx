"use client";

import dynamic from "next/dynamic";
import styles from "./library.module.css";

export const Playground = dynamic(() => import("./Playground").then((m) => m.Playground), {
  // These local-only forms must not submit as native GETs before their handlers hydrate.
  ssr: false,
  loading: () => (
    <p role="status" className={styles.empty}>
      Opening playground…
    </p>
  ),
});
