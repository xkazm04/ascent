"use client";

// Prism A-vs-B picker. Same `?a=` / `?b=` writes as SegmentComparePicker.
import { useId } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormField, Select } from "@/components/kit";

export function SegmentComparePickerV2({
  options,
  a,
  b,
}: {
  options: { id: string; name: string }[];
  a: string;
  b: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const aId = useId();
  const bId = useId();

  function navigate(next: { a: string; b: string | null }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("a", next.a);
    if (next.b) params.set("b", next.b);
    else params.delete("b");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <FormField label="Segment A" htmlFor={aId} className="min-w-40">
        <Select id={aId} value={a} aria-label="Segment A" onChange={(e) => navigate({ a: e.target.value, b })}>
          {options.map((o) => (
            <option key={o.id} value={o.id} disabled={o.id === b}>
              {o.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Segment B" htmlFor={bId} className="min-w-40">
        <Select id={bId} value={b ?? ""} aria-label="Segment B" onChange={(e) => navigate({ a, b: e.target.value || null })}>
          <option value="">Whole fleet</option>
          {options.map((o) => (
            <option key={o.id} value={o.id} disabled={o.id === a}>
              {o.name}
            </option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}
