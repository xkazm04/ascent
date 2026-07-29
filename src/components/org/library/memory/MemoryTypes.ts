// Shared types for the Memory tab's write form. Pulled out of MemoryAuthorForm.tsx so both it and
// useMemoryLibrary.ts (which owns the form's state) import the shape from a JSX-free module rather than
// a JSX-free hook importing a type from a .tsx file.

import type { MemoryKind } from "@/lib/org/memory-kinds";

export interface MemoryFormState {
  content: string;
  kind: MemoryKind;
  namespace: string;
  visibility: string;
  source: string;
  confidence: number;
  tagsText: string;
}
