// The app-level modal host: an empty, stable portal target rendered ONCE at the end of the root
// layout's <body>, so every Modal mounts above the whole app (never inside a section's stacking
// context — a transformed/overflow ancestor can't clip or trap it). Server-safe on purpose: it's
// just a div; all behavior lives in Modal, which portals into it (and falls back to document.body
// if a non-standard layout omits it).

export const MODAL_ROOT_ID = "ascent-modal-root";

export function ModalRoot() {
  return <div id={MODAL_ROOT_ID} />;
}
