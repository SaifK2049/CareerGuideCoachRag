import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import {
  buildReadinessAssessment,
  buildSimulation,
  type SimulationRequest,
} from "../_shared/career-planning.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { recordOperationalEvent } from "../_shared/telemetry.ts";

type Row = Record<string, any>;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validRequest(value: unknown): value is SimulationRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Row;
  if (!["skill", "certification", "mobility", "learning_period", "projects"].includes(request.type)) {
    return false;
  }
  if (typeof request.subject !== "string" || !request.subject.trim() || request.subject.length > 240) {
    return false;
  }
  if (request.destination && !/^[A-Z]{2}$/.test(String(request.destination))) return false;
  if (request.months && (!Number.isInteger(request.months) || request.months < 1 || request.months > 36)) return false;
  if (request.projectCount && (!Number.isInteger(request.projectCount) || request.projectCount < 1 || request.projectCount > 12)) return false;
  if (request.weeklyHours && (!Number.isFinite(request.weeklyHours) || request.weeklyHours < 1 || request.weeklyHours > 80)) return false;
  return true;
}

Deno.serve(async (request) => {
  const startedAt = Date.now();
  let admin: any = null;
  let userId = "";
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed" }, 405);
  }

  try {
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    const client = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) {
      return jsonResponse(request, { error: "Authentication required" }, 401);
    }
    userId = authData.user.id;
    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const rateLimit = await consumeRateLimit(admin, userId, "career-planning", 12, 300);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "readiness");
    if (!["readiness", "simulate"].includes(action)) {
      return jsonResponse(request, { error: "Unsupported planning action" }, 400);
    }
    if (action === "simulate" && !validRequest(body.scenario)) {
      return jsonResponse(request, { error: "A valid simulation scenario is required" }, 400);
    }

    const [
      twinResult,
      jobsResult,
      knowledgeResult,
      analysesResult,
      interviewsResult,
      actionsResult,
      portfolioResult,
      credentialsResult,
      marketResult,
      mobilityProfilesResult,
    ] = await Promise.all([
      client.from("career_twins").select("*").eq("user_id", userId).maybeSingle(),
      client.from("job_descriptions").select("*").eq("user_id", userId).limit(200),
      client.from("knowledge_evidence").select("*").eq("user_id", userId).limit(300),
      client.from("career_analyses").select("id,status,findings,sources,completed_at").eq("user_id", userId).order("completed_at", { ascending: false }).limit(20),
      client.from("interview_practice_sessions").select("id,title,status,assessment,assessment_status").eq("user_id", userId).limit(100),
      client.from("action_plan_items").select("*").eq("user_id", userId).limit(300),
      client.from("portfolio_assets").select("*").eq("user_id", userId).limit(100),
      client.from("career_credentials").select("*").eq("user_id", userId).limit(100),
      client.from("labour_market_observations").select("*").eq("status", "published").order("observed_to", { ascending: false }).limit(500),
      client.from("mobility_destination_profiles").select("*").eq("status", "published").order("country_name"),
    ]);
    for (const result of [
      twinResult, jobsResult, knowledgeResult, analysesResult, interviewsResult,
      actionsResult, portfolioResult, credentialsResult, marketResult, mobilityProfilesResult,
    ]) {
      if (result.error) throw result.error;
    }
    if (!twinResult.data) {
      return jsonResponse(request, {
        error: "Refresh the Career Twin before running planning intelligence.",
        code: "CAREER_TWIN_REQUIRED",
      }, 409);
    }

    const input = {
      twin: twinResult.data,
      jobs: jobsResult.data || [],
      knowledge: knowledgeResult.data || [],
      analyses: analysesResult.data || [],
      interviews: interviewsResult.data || [],
      actions: actionsResult.data || [],
      portfolio: portfolioResult.data || [],
      credentials: credentialsResult.data || [],
      market: marketResult.data || [],
      mobilityProfiles: mobilityProfilesResult.data || [],
    };
    const readiness = buildReadinessAssessment(input);
    const { data: readinessRow, error: readinessError } = await client
      .from("career_readiness_assessments")
      .insert({ user_id: userId, twin_id: twinResult.data.id, ...readiness })
      .select("*")
      .single();
    if (readinessError) throw readinessError;

    if (action === "readiness") {
      await recordOperationalEvent(admin, {
        userId, operation: "career_planning", outcome: "succeeded",
        latencyMs: Date.now() - startedAt, model: readiness.methodology_version,
      });
      return jsonResponse(request, { readiness: readinessRow });
    }

    const scenario = body.scenario as SimulationRequest;
    const fingerprint = await sha256(JSON.stringify({
      twin_fingerprint: twinResult.data.input_fingerprint,
      scenario,
    }));
    const { data: replay } = await client.from("career_simulations")
      .select("*")
      .eq("user_id", userId)
      .eq("request_fingerprint", fingerprint)
      .maybeSingle();
    if (replay) {
      return jsonResponse(request, { readiness: readinessRow, simulation: replay, replayed: true });
    }

    const simulation = buildSimulation(input, scenario, readiness);
    const { data: simulationRow, error: simulationError } = await client
      .from("career_simulations")
      .insert({
        user_id: userId,
        twin_id: twinResult.data.id,
        scenario_type: scenario.type,
        request_fingerprint: fingerprint,
        ...simulation,
      })
      .select("*")
      .single();
    if (simulationError) throw simulationError;

    const weeklyHours = Number(scenario.weeklyHours || 6);
    const totalHours = simulation.roadmap.reduce((sum: number, item: Row) => sum + Number(item.estimated_hours || 0), 0);
    const forecast = new Date(Date.now() + Math.ceil(totalHours / weeklyHours) * 7 * 86400000);
    const { data: roadmap, error: roadmapError } = await client.from("learning_roadmaps")
      .insert({
        user_id: userId,
        simulation_id: simulationRow.id,
        title: `${scenario.subject} career roadmap`,
        title_ar: `خارطة طريق مهنية لـ ${scenario.subject}`,
        goal: `Complete the ${scenario.type.replaceAll("_", " ")} scenario for ${scenario.subject}.`,
        goal_ar: `أكمل سيناريو ${scenario.type.replaceAll("_", " ")} لـ ${scenario.subject}.`,
        status: "active",
        weekly_hours: weeklyHours,
        forecast_completion: forecast.toISOString().slice(0, 10),
        evidence_refs: simulation.evidence_refs,
      })
      .select("*")
      .single();
    if (roadmapError) throw roadmapError;
    const { error: milestonesError } = await client.from("learning_roadmap_milestones").insert(
      simulation.roadmap.map((milestone: Row) => ({
        roadmap_id: roadmap.id,
        user_id: userId,
        sequence: milestone.sequence,
        title: milestone.title,
        title_ar: milestone.title_ar,
        milestone_type: milestone.type,
        estimated_hours: milestone.estimated_hours,
        resources: milestone.resources || [],
        verification_criteria: milestone.verification_criteria,
        verification_criteria_ar: milestone.verification_criteria_ar,
        impact: simulation.projection.match_score,
      })),
    );
    if (milestonesError) throw milestonesError;

    await recordOperationalEvent(admin, {
      userId, operation: "career_planning", outcome: "succeeded",
      latencyMs: Date.now() - startedAt, model: simulation.model,
    });
    return jsonResponse(request, {
      readiness: readinessRow,
      simulation: simulationRow,
      roadmap,
      replayed: false,
    });
  } catch (error) {
    console.error("career-planning failed");
    await recordOperationalEvent(admin, {
      userId: userId || undefined,
      operation: "career_planning",
      outcome: "failed",
      errorCode: error instanceof Error ? error.message : "CAREER_PLANNING_FAILED",
      latencyMs: Date.now() - startedAt,
    });
    return jsonResponse(request, {
      error: "Career planning could not be completed.",
      code: "CAREER_PLANNING_FAILED",
    }, 500);
  }
});
