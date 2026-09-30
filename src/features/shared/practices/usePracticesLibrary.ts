"use client";

// One owner for the library's client state. Altimeter and Prism both call it, so a created
// playbook, an open row, and a deep link cannot diverge between the two compositions.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { OrgPractice, PlaybookAdoption, PlaybookRow } from "@/lib/db";
import type { ThemeId } from "@/lib/theme/theme";
import { clearPracticeHash, publishPracticeHash, rowForLevelHash } from "./practiceLevelHash";
import { practiceToPlaybookDraft, type PlaybookDraft } from "./promotePractice";
import { buildPracticeRows, summarizeRollout, type PracticeRow } from "./practiceRows";
import { usePracticeHash } from "./usePracticeHash";
import type { PracticeDimOption } from "./practicesData";

export function usePracticesLibrary({
  initialPlaybooks,
  practices,
  adoption,
  dimOptions,
  repoOptions,
  theme = "altimeter",
}: {
  initialPlaybooks: PlaybookRow[];
  practices: OrgPractice[];
  adoption: Record<string, PlaybookAdoption>;
  dimOptions: PracticeDimOption[];
  repoOptions: string[];
  theme?: ThemeId;
}) {
  const [playbooks, setPlaybooks] = useState<PlaybookRow[]>(initialPlaybooks);
  const [openRow, setOpenRow] = useState<PracticeRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<PlaybookDraft | null>(null);

  const dimLabels = useMemo(() => new Map(dimOptions.map((d) => [d.id, d.label])), [dimOptions]);
  const rows = useMemo(
    () => buildPracticeRows(practices, playbooks, adoption, repoOptions.length),
    [practices, playbooks, adoption, repoOptions.length],
  );
  const rollout = useMemo(() => summarizeRollout(rows), [rows]);

  const open = useCallback((row: PracticeRow) => {
    setOpenRow(row);
    if (theme === "prism") publishPracticeHash(row);
  }, [theme]);

  usePracticeHash(rows, theme === "prism" ? open : setOpenRow);

  // Prism holds the open row in the URL. Back and Esc clear the hash; this follows it.
  useEffect(() => {
    if (theme !== "prism") return;
    const sync = () => setOpenRow(rowForLevelHash(rows, window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [theme, rows]);

  const close = useCallback(() => {
    setOpenRow(null);
    if (theme === "prism") clearPracticeHash();
  }, [theme]);

  function removeAuthored(id: string) {
    const prev = playbooks;
    setPlaybooks((p) => p.filter((x) => x.id !== id));
    setOpenRow(null);
    if (theme === "prism") clearPracticeHash();
    void fetch(`/api/org/playbooks/${id}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok) setPlaybooks(prev);
      })
      .catch(() => setPlaybooks(prev));
  }

  function promoteMined(p: OrgPractice) {
    setDraft(practiceToPlaybookDraft(p));
    setOpenRow(null);
    if (theme === "prism") clearPracticeHash();
    setShowCreate(true);
  }

  return {
    playbooks, rows, rollout, dimLabels, openRow, showCreate, draft,
    open, close, setOpenRow, setShowCreate, setDraft, setPlaybooks, removeAuthored, promoteMined,
  };
}
