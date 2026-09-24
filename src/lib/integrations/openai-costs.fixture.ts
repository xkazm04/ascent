// RECORDED FIXTURE: OpenAI Admin Costs API (`GET https://api.openai.com/v1/organization/costs`).
//
// Shape source (fetched 2026-09-24): the OpenAI OpenAPI spec, operationId `usage-costs`, in
// https://github.com/openai/openai-openapi/blob/manual_spec/openapi.yaml (branch head 498c71dd,
// schemas `UsageResponse`, `UsageTimeBucket`, `CostsResult`), cross-checked against the cookbook
// "How to use the Usage API and Cost API" (https://developers.openai.com/cookbook/examples/completions_usage_api).
// The reference pages under platform.openai.com/docs/api-reference/usage/costs answered 403 to an
// unauthenticated fetch, so the spec file is the citation.
//
// What the spec says and this fixture reproduces:
//   - `start_time` (unix seconds, inclusive, required), `end_time` (exclusive), `bucket_width` (only
//     `1d`), `project_ids[]`, `group_by[]` (`project_id` | `line_item`), `limit` = number of BUCKETS
//     per page (1..180, default 7), `page` = the previous response's `next_page` cursor.
//   - Response: `{ object: "page", data: bucket[], has_more, next_page }`; a bucket is
//     `{ object: "bucket", start_time, end_time, results: CostsResult[] }`; a result is
//     `{ object: "organization.costs.result", amount: { value, currency }, line_item, project_id }`.
//   - The spec's `UsageTimeBucket` schema names the array `result`, while the spec's own example
//     response and the cookbook both use `results`. The parser accepts either; this fixture uses
//     `results`, the documented example's spelling.
//
// The amounts, project ids and cursor below are invented for the test; only the SHAPE is recorded.
// No test calls the live API.

import type { OpenAICostsPage } from "./openai-costs";

const DAY = 86_400;
/** 2026-08-01T00:00:00Z. */
export const FIXTURE_START = 1_785_542_400;

/** Page 1 of 2: two day buckets and a cursor. Day 1 has two project rows. */
export const COSTS_PAGE_1: OpenAICostsPage = {
  object: "page",
  data: [
    {
      object: "bucket",
      start_time: FIXTURE_START,
      end_time: FIXTURE_START + DAY,
      results: [
        { object: "organization.costs.result", amount: { value: 0.06, currency: "usd" }, line_item: null, project_id: "proj_codex" },
        { object: "organization.costs.result", amount: { value: 1.234, currency: "usd" }, line_item: null, project_id: "proj_ci" },
      ],
    },
    {
      object: "bucket",
      start_time: FIXTURE_START + DAY,
      end_time: FIXTURE_START + 2 * DAY,
      results: [
        { object: "organization.costs.result", amount: { value: 12.5, currency: "usd" }, line_item: null, project_id: "proj_codex" },
      ],
    },
  ],
  has_more: true,
  next_page: "page_AAAAAGdGxdEAAAAAZ0bF0Q==",
};

/** Page 2 of 2: a day with no spend (an empty `results`) and the end of the window. */
export const COSTS_PAGE_2: OpenAICostsPage = {
  object: "page",
  data: [
    { object: "bucket", start_time: FIXTURE_START + 2 * DAY, end_time: FIXTURE_START + 3 * DAY, results: [] },
  ],
  has_more: false,
  next_page: null,
};
