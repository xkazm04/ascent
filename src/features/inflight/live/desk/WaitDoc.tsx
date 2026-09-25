// A Waiting card's evidence page — heading, figure strip, the evidence; when the card needs a verdict,
// ONE door to the Ledger, where decisions are made (the desk decides nothing in this beta). Prev/next
// walks the cards in rank order. No hooks.

import type { DeskCtx } from "./deskCtx";
import { DocHead, PrevNext, Strip } from "./DocParts";
import { LayerFrame } from "./LayerFrame";
import { waitNav } from "./layerNav";
import { waitBody } from "./WaitBodies";
import type { WaitKey } from "./waitingModel";
import l from "./deskLayers.module.css";
import s from "./desk.module.css";

export function WaitDoc({ ctx, k }: { ctx: DeskCtx; k: WaitKey }) {
  const card = ctx.waiting.cards.find((c) => c.key === k);
  const { prev, next } = waitNav(ctx.waiting.cards, k);
  const name = card?.cap ?? "Waiting";
  const b = waitBody(ctx, k);
  return (
    <LayerFrame
      crumbs={[{ label: "Desk", to: null }, { label: "Waiting on you", to: null }, { label: name }]}
      prev={prev}
      next={next}
      go={ctx.go}
      docKey={`wait:${k}`}
    >
      <div className={`${l.doc} ${l.narrow}`}>
        <DocHead
          kick={`Waiting on you · ${card?.src ?? "records"}`}
          title={b.title}
          sub={<span>{b.sub}</span>}
          aside={
            b.decide ? (
              <a className={`${s.btn} ${s.primary}`} href={`${ctx.hrefs.ledger}#ledger-needs-you`}>
                {b.decide} →
              </a>
            ) : null
          }
        />
        {b.cells.length ? <Strip cells={b.cells} /> : null}
        {b.body}
        <PrevNext prev={prev} next={next} go={ctx.go} />
      </div>
    </LayerFrame>
  );
}
