// A FormField whose visible name is the SettingRow above it. The label stays tied to the control.
import type { ReactNode } from "react";
import { FormField } from "@/components/kit";

export function QuietField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <FormField className="[&_label]:sr-only" label={label} htmlFor={htmlFor} hint={hint}>
      {children}
    </FormField>
  );
}
