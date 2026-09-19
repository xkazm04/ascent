// One owner for modal keyboard input and the body lock, including out-of-order closes.
const layers: symbol[] = [];
let previousOverflow = "";

export function acquireModalLayer() {
  const id = Symbol("modal");
  if (layers.length === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  layers.push(id);
  return {
    isTop: () => layers.at(-1) === id,
    release: () => {
      const index = layers.indexOf(id);
      if (index < 0) return;
      layers.splice(index, 1);
      if (layers.length === 0) document.body.style.overflow = previousOverflow;
    },
  };
}
