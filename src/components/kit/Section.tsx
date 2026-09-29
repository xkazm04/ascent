// Section — a heading block: optional kicker eyebrow, title, intro and a right-aligned slot. The kit
// name for SectionHeading; `display: contents` on the hook (kit.css) keeps layout identical while
// giving the Prism theme one selector to dress. `size` steps: page (editorial), lg (dashboard), sm (in-card).
import { SectionHeading } from "@/components/ui/SectionHeading";

export type SectionProps = React.ComponentProps<typeof SectionHeading>;

export function Section(props: SectionProps) {
  return (
    <div data-kit="section" data-size={props.size ?? "lg"} data-role="section">
      <SectionHeading {...props} />
    </div>
  );
}
