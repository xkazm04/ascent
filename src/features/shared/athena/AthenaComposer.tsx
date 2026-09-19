"use client";

// The composer. `TextArea` from the brand form kit, never a hand-written `border-slate-700
// bg-slate-900` input — one control skin on the real tokens is the whole point of `Field` & co.
//
// ENTER SENDS, SHIFT+ENTER NEWLINES. The alternative (a send button only) costs a mouse trip on every
// turn of what is a typing surface; the alternative to that (Enter always newlines) makes the button
// the only way out and is what people complain about in chat UIs. Both paths stay keyboard-reachable:
// the button is a real submit inside a real form, so Tab-then-Enter works without knowing the shortcut.
//
// The form is deliberately NOT disabled while a turn is in flight — only the submit is. A disabled
// textarea would throw away whatever the operator was typing while they waited.

import { useId, useState } from "react";
import { TextArea } from "@/components/ui";

/** Mirrors `MESSAGE_MAX` in the message route, which rejects anything longer. */
const MESSAGE_MAX = 8_000;

export function AthenaComposer({ onSend, sending }: { onSend: (text: string) => void; sending: boolean }) {
  const [text, setText] = useState("");
  const id = useId();

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <form
      className="border-t border-divider px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Ask Athena
      </label>
      <TextArea
        id={id}
        rows={2}
        value={text}
        maxLength={MESSAGE_MAX}
        placeholder="Ask about this organization…"
        className="type-body-sm"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="type-caption text-slate-600">Enter sends · Shift+Enter for a new line</span>
        <button
          type="submit"
          disabled={sending || text.trim().length === 0}
          className="focus-ring rounded-lg bg-accent px-3 py-1.5 type-body-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Thinking…" : "Ask"}
        </button>
      </div>
    </form>
  );
}
