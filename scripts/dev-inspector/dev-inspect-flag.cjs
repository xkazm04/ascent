"use strict";

/**
 * The ONE definition of the DEV_INSPECT flag (`npm run dev:inspect` sets DEV_INSPECT=1).
 *
 * The flag arms a build transform that stamps repo-relative source paths into every host element,
 * so a stray DEV_INSPECT on a production build (a copied .env, a CI job reusing a dev profile) must
 * be inert, not merely unused. The production floor is therefore read FIRST, here, inside the
 * definition (AGENTS.md: a dangerous env flag is hard-disabled inside its own definition).
 *
 * CommonJS so both readers can load it: next.config.ts (registers the Turbopack rule) and
 * source-loc-loader.cjs (re-checks per module). Nothing else may read the variable; pinned by
 * src/app/api/dev/dev-surfaces-gated.test.ts.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
function devInspectEnabled(env = process.env) {
  if (env.NODE_ENV === "production") return false; // floor FIRST
  return env.DEV_INSPECT === "1";
}

module.exports = { devInspectEnabled };
