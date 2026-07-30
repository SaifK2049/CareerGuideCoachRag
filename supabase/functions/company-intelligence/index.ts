import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { buildCompanyBrief } from "../_shared/company-intelligence.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { recordOperationalEvent } from "../_shared/telemetry.ts";

function canonical(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
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
    const client = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) return jsonResponse(request, { error: "Authentication required" }, 401);
    userId = authData.user.id;
    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const limit = await consumeRateLimit(admin, userId, "company-intelligence", 20, 300);
    if (!limit.allowed) {
      return rateLimitResponse(limit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }
    const body = await request.json().catch(() => ({}));
    const jobId = String(body.jobId || "");
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
      return jsonResponse(request, { error: "A valid saved job is required" }, 400);
    }
    const [jobResult, profilesResult] = await Promise.all([
      client.from("job_descriptions").select("*").eq("id", jobId).eq("user_id", userId).single(),
      client.from("company_profiles").select("*").eq("status", "published").limit(500),
    ]);
    if (jobResult.error) throw jobResult.error;
    if (profilesResult.error) throw profilesResult.error;
    const job = jobResult.data;
    if (!String(job.company || "").trim()) {
      return jsonResponse(request, { error: "Add the company name to this saved job first" }, 409);
    }
    const profile = (profilesResult.data || []).find((item: any) =>
      canonical(item.canonical_name) === canonical(job.company)
    ) || null;
    const marketFilters = [
      String(job.title || "").replace(/[%_,()]/g, "").trim()
        ? `job_family.ilike.%${String(job.title).replace(/[%_,()]/g, "").trim()}%`
        : "",
      String(profile?.industries?.[0] || "").replace(/[%_,()]/g, "").trim()
        ? `industry.ilike.%${String(profile.industries[0]).replace(/[%_,()]/g, "").trim()}%`
        : "",
    ].filter(Boolean);
    let marketQuery = client.from("labour_market_observations")
      .select("*")
      .eq("status", "published")
      .order("observed_to", { ascending: false })
      .limit(50);
    if (marketFilters.length) marketQuery = marketQuery.or(marketFilters.join(","));
    const marketResult = await marketQuery;
    if (marketResult.error) throw marketResult.error;
    const brief = buildCompanyBrief(job, profile, marketResult.data || []);
    const { data, error } = await client.from("company_intelligence_briefs").upsert({
      user_id: userId,
      job_id: job.id,
      ...brief,
    }, { onConflict: "user_id,job_id" }).select("*").single();
    if (error) throw error;
    await recordOperationalEvent(admin, {
      userId,
      operation: "company_intelligence",
      outcome: "succeeded",
      latencyMs: Date.now() - startedAt,
      model: "company-evidence-v1",
    });
    return jsonResponse(request, { brief: data });
  } catch (error) {
    console.error("company-intelligence failed");
    await recordOperationalEvent(admin, {
      userId: userId || undefined,
      operation: "company_intelligence",
      outcome: "failed",
      errorCode: error instanceof Error ? error.message : "COMPANY_INTELLIGENCE_FAILED",
      latencyMs: Date.now() - startedAt,
    });
    return jsonResponse(request, {
      error: "The company briefing could not be generated.",
      code: "COMPANY_INTELLIGENCE_FAILED",
    }, 500);
  }
});
