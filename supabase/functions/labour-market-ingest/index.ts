import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { recordOperationalEvent } from "../_shared/telemetry.ts";

type Row = Record<string, any>;

const signalTypes = new Set([
  "skill_demand",
  "salary",
  "hiring_trend",
  "industry_growth",
  "technology_adoption",
  "certification_popularity",
  "cost_of_living",
]);
const experienceLevels = new Set([
  "entry", "junior", "mid", "senior", "lead", "executive", "unspecified",
]);

function text(value: unknown, maximum: number): string {
  return String(value || "").trim().slice(0, maximum);
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("INVALID_NUMBER");
  return number;
}

function date(value: unknown): string {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(new Date(result + "T00:00:00Z").getTime())) {
    throw new Error("INVALID_DATE");
  }
  return result;
}

function httpsUrl(value: unknown): string {
  const result = text(value, 2000);
  const parsed = new URL(result);
  if (parsed.protocol !== "https:") throw new Error("INVALID_SOURCE_URL");
  return parsed.toString();
}

function normalizedObservation(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_OBSERVATION");
  const input = value as Row;
  const externalId = text(input.external_id, 240);
  const countryCode = text(input.country_code, 2).toUpperCase();
  const signalType = text(input.signal_type, 40);
  const experienceLevel = text(input.experience_level || "unspecified", 20);
  const observedFrom = date(input.observed_from);
  const observedTo = date(input.observed_to);
  if (!externalId || !/^[A-Z]{2}$/.test(countryCode)) throw new Error("INVALID_ID_OR_COUNTRY");
  if (!signalTypes.has(signalType) || !experienceLevels.has(experienceLevel)) throw new Error("INVALID_DIMENSION");
  if (observedTo < observedFrom) throw new Error("INVALID_COVERAGE_WINDOW");
  const rangeLow = finite(input.range_low);
  const rangeHigh = finite(input.range_high);
  const sampleSize = finite(input.sample_size);
  if (rangeLow !== null && rangeHigh !== null && rangeHigh < rangeLow) throw new Error("INVALID_RANGE");
  if (sampleSize !== null && (!Number.isInteger(sampleSize) || sampleSize < 0)) throw new Error("INVALID_SAMPLE_SIZE");
  const confidence = input.confidence === undefined ? 0.5 : finite(input.confidence);
  if (confidence === null || confidence < 0 || confidence > 1) throw new Error("INVALID_CONFIDENCE");
  return {
    external_id: externalId,
    country_code: countryCode,
    city: text(input.city, 160),
    industry: text(input.industry, 160),
    job_family: text(input.job_family, 200),
    experience_level: experienceLevel,
    signal_type: signalType,
    subject: text(input.subject, 240),
    value_numeric: finite(input.value_numeric),
    value_unit: text(input.value_unit, 80),
    range_low: rangeLow,
    range_high: rangeHigh,
    currency: input.currency ? text(input.currency, 3).toUpperCase() : null,
    sample_size: sampleSize,
    observed_from: observedFrom,
    observed_to: observedTo,
    source_name: text(input.source_name, 240),
    source_url: httpsUrl(input.source_url),
    methodology: text(input.methodology, 4000),
    confidence,
    status: input.status === "draft" ? "draft" : "published",
    updated_at: new Date().toISOString(),
  };
}

Deno.serve(async (request) => {
  const startedAt = Date.now();
  let admin: any = null;
  let userId = "";
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);
  try {
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    const userClient = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return jsonResponse(request, { error: "Authentication required" }, 401);
    userId = authData.user.id;
    if (authData.user.app_metadata?.role !== "admin") {
      return jsonResponse(request, { error: "Administrator access required" }, 403);
    }
    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const rateLimit = await consumeRateLimit(admin, userId, "labour-market-ingest", 4, 300);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }
    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.observations) || !body.observations.length || body.observations.length > 500) {
      return jsonResponse(request, { error: "Provide 1–500 observations" }, 400);
    }
    const observations = body.observations.map(normalizedObservation);
    if (observations.some((item: Row) => !item.job_family || !item.subject || !item.source_name)) {
      return jsonResponse(request, { error: "Job family, subject, and source name are required" }, 400);
    }
    const { data, error } = await admin.from("labour_market_observations")
      .upsert(observations, { onConflict: "source_name,external_id" })
      .select("id,external_id,source_name,status,updated_at");
    if (error) throw error;
    await recordOperationalEvent(admin, {
      userId,
      operation: "labour_market_ingest",
      outcome: "succeeded",
      latencyMs: Date.now() - startedAt,
      model: "validated-source-batch-v1",
    });
    return jsonResponse(request, { accepted: data?.length || 0, observations: data || [] });
  } catch (error) {
    console.error("labour-market-ingest failed");
    await recordOperationalEvent(admin, {
      userId: userId || undefined,
      operation: "labour_market_ingest",
      outcome: "failed",
      errorCode: error instanceof Error ? error.message : "LABOUR_MARKET_INGEST_FAILED",
      latencyMs: Date.now() - startedAt,
    });
    return jsonResponse(request, {
      error: "Labour-market observations could not be ingested.",
      code: error instanceof Error ? error.message : "LABOUR_MARKET_INGEST_FAILED",
    }, 400);
  }
});
