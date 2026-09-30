import { Caption, Eyebrow, Frame, KeyValue, MonoPath, SectionHead } from "@/components/kit";
import { HOWTO_HOSTED_NOTE, HOWTO_USAGE_NOTE } from "@/lib/org/registry-howto";
import type { RegistryView } from "@/lib/org/registry-view";

export function RegistryHowToV2({ view }: { view: RegistryView }) {
  const { reportCmd, hooksCmd, pointer, hostedPushCmd, hostedEventsCmd } = view.howTo;
  return (
    <Frame>
      <SectionHead
        eyebrow="Developer how-to"
        title="Git is"
        named="the interface."
        lede="A developer clones the registry, edits a SKILL.md, bumps its version, appends LESSONS.md and opens a PR. Nothing here needs an ascent session."
      />
      <div data-howto="git-native" className="mt-4">
        <KeyValue
          layout="stack"
          items={[
            { key: "Usage", value: <MonoPath>{reportCmd}</MonoPath> },
            { key: "Hooks", value: <MonoPath>{hooksCmd}</MonoPath> },
            { key: "Pointer", value: <MonoPath>{pointer}</MonoPath> },
          ]}
        />
      </div>
      <Caption className="mt-3">{HOWTO_USAGE_NOTE}</Caption>
      <Eyebrow className="mb-2 mt-6">Hosted push and events</Eyebrow>
      <div data-howto="hosted">
        <KeyValue
          layout="stack"
          items={[
            { key: "Push", value: <MonoPath>{hostedPushCmd}</MonoPath> },
            { key: "Events", value: <MonoPath>{hostedEventsCmd}</MonoPath> },
          ]}
        />
      </div>
      <Caption className="mt-3">{HOWTO_HOSTED_NOTE}</Caption>
    </Frame>
  );
}
