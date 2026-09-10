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
  sum?: { dataPoints?: OtlpDataPoint[] };
  gauge?: { dataPoints?: OtlpDataPoint[] };
}

export interface OtlpResourceMetrics {
  resource?: { attributes?: OtlpAttr[] };
  scopeMetrics?: { metrics?: OtlpMetric[] }[];
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
