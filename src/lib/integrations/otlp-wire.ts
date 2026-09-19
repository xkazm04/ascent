// Shared OTLP JSON wire shapes and value readers for daily usage and session attempts.


export interface OtlpValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}

export interface OtlpAttr {
  key?: string;
  value?: OtlpValue;
}

export interface OtlpDataPoint {
  asInt?: string | number;
  asDouble?: number;
  timeUnixNano?: string | number;
  attributes?: OtlpAttr[];
}

export interface OtlpMetric {
  name?: string;
  /** `aggregationTemporality`: 1 DELTA, 2 CUMULATIVE (OTLP/JSON may also spell the enum name). */
  sum?: { dataPoints?: OtlpDataPoint[]; aggregationTemporality?: number | string };
  gauge?: { dataPoints?: OtlpDataPoint[] };
}

/**
 * True when a counter's datapoints are RUNNING TOTALS rather than increments.
 *
 * Claude Code's exporter defaults to delta (`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE`,
 * default `delta`) and the connect snippet does not change it, so an absent or unspecified field reads
 * as delta. Every consumer of one export must decode this the same way: adding a running total
 * multiplies it by the export count, and keeping only the latest increment discards all but the last
 * interval. `agent-sessions.temporality.test.ts` pins both paths against both settings.
 */
export function isCumulativeSum(metric: OtlpMetric): boolean {
  const t = metric.sum?.aggregationTemporality;
  return t === 2 || t === "2" || t === "AGGREGATION_TEMPORALITY_CUMULATIVE";
}

export interface OtlpResourceMetrics {
  resource?: { attributes?: OtlpAttr[] };
  scopeMetrics?: { metrics?: OtlpMetric[] }[];
}

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const optionalObject = (value: unknown, check: (value: JsonObject) => boolean): boolean =>
  value == null || (isObject(value) && check(value));
const optionalList = (value: unknown, check: (value: JsonObject) => boolean): boolean =>
  value == null || (Array.isArray(value) && value.every((item) => isObject(item) && check(item)));
const hasAttributes = (value: JsonObject): boolean =>
  optionalList(value.attributes, (attr) =>
    (attr.key == null || typeof attr.key === "string") && optionalObject(attr.value, () => true));
const hasDataPoints = (value: JsonObject): boolean => optionalList(value.dataPoints, hasAttributes);

/** Validate containers consumed by both parsers; unknown OTLP fields remain forward compatible. */
export function hasOtlpMetricStructure(value: unknown): boolean {
  return isObject(value) && optionalList(value.resourceMetrics, (resource) =>
    optionalObject(resource.resource, hasAttributes) &&
    optionalList(resource.scopeMetrics, (scope) => optionalList(scope.metrics, (metric) =>
      (metric.name == null || typeof metric.name === "string") &&
      optionalObject(metric.sum, hasDataPoints) && optionalObject(metric.gauge, hasDataPoints))));
}


/** Flatten OTLP attribute list into a plain string map. */
export function attrMap(attrs: OtlpAttr[] | undefined): Record<string, string> {
  const m: Record<string, string> = {};
  for (const a of attrs ?? []) {
    if (!a?.key || !a.value) continue;
    const v = a.value;
    if (typeof v.stringValue === "string") m[a.key] = v.stringValue;
    else if (v.intValue != null) m[a.key] = String(v.intValue);
    else if (v.doubleValue != null) m[a.key] = String(v.doubleValue);
    else if (v.boolValue != null) m[a.key] = String(v.boolValue);
  }
  return m;
}


export function dpValue(dp: OtlpDataPoint): number {
  if (dp.asInt != null) {
    const n = Number(dp.asInt);
    return Number.isFinite(n) ? n : 0;
  }
  if (dp.asDouble != null) return Number.isFinite(dp.asDouble) ? dp.asDouble : 0;
  return 0;
}
