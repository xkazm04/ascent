// The GitHub half of the catalog write-back (the policy lives in ./catalog-write).
//
// NO MINT HERE. The token is the one the index source already carries: the index route's gate minted
// it for the gated org, and the push webhook minted it for the installation it confirmed is bound to
// the pushing owner. The coordinate is that org's own registry row (`registry.fullName`), never a
// caller-supplied string. Token and coordinate therefore come from the gated org by construction, the
// same rule `requirePrWriteTarget` enforces for the PR-write routes.

import { githubAppFetch } from "@/lib/github/app";
import { encodePathSegments } from "@/lib/github/host";
import { REGISTRY_CATALOG_PATH } from "./layout";
import { readFileAtRef } from "./read";
import { openOrUpdateSignalsPr } from "./signals-pr";
import type { CatalogWriter } from "./catalog-write";

const enc = (s: string) => Buffer.from(s, "utf8").toString("base64");

export function githubCatalogWriter(token: string, owner: string, repo: string): CatalogWriter {
  return {
    async commit({ branch, content, priorBlobSha, message }) {
      // Contents API: `sha` is the blob being replaced, which is exactly what the tree walk handed us.
      // If the file moved since the pass read it, GitHub answers 409 and the trailing pass (fired by
      // whatever moved it) rebuilds from the newer tree.
      const put = await githubAppFetch<{ content?: { sha?: string }; commit?: { sha?: string } }>(
        `/repos/${owner}/${repo}/contents/${encodePathSegments(REGISTRY_CATALOG_PATH)}`,
        token,
        {
          method: "PUT",
          body: JSON.stringify({ message, content: enc(content), branch, ...(priorBlobSha ? { sha: priorBlobSha } : {}) }),
        },
      );
      return { commitSha: put.commit?.sha ?? null, blobSha: put.content?.sha ?? null };
    },
    readBranch: (branch) => readFileAtRef(token, owner, repo, REGISTRY_CATALOG_PATH, branch),
    async propose({ base, branch, content, message, title, body }) {
      // The create-or-update PR helper: ascent is this file's only author on its branch, so a repeat
      // pass must UPDATE the file there rather than 409 the way the never-clobber starter helper does.
      const pr = await openOrUpdateSignalsPr({
        token,
        owner,
        repo,
        base,
        branch,
        path: REGISTRY_CATALOG_PATH,
        content,
        commitMessage: message,
        prTitle: title,
        prBody: body,
      });
      return { url: pr.url, number: pr.number, branch: pr.branch, reused: pr.reused };
    },
  };
}
