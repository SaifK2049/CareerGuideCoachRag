import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { buildCareerIntelligence } from "../_shared/career-intelligence.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { recordOperationalEvent } from "../_shared/telemetry.ts";

type Row = Record<string, any>;

async function currentSnapshot(client: any): Promise<Row> {
  const { data, error } = await client.rpc("get_career_operating_system_snapshot");
  if (error) throw error;
  return data || {};
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
    const userClient = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) {
      return jsonResponse(request, { error: "Authentication required" }, 401);
    }
    userId = authData.user.id;

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "refresh");
    if (!["refresh", "snapshot"].includes(action)) {
      return jsonResponse(request, { error: "Unsupported career intelligence action" }, 400);
    }
    if (action === "snapshot") {
      return jsonResponse(request, { snapshot: await currentSnapshot(userClient) });
    }

    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const rateLimit = await consumeRateLimit(admin, userId, "career-intelligence", 6, 300);
    if (!rateLimit.allowed) {
      return rateLimitResponse(
        rateLimit,
        Object.fromEntries(jsonResponse(request, {}).headers.entries()),
      );
    }

    const { data: graphSync, error: graphError } = await userClient.rpc(
      "sync_career_knowledge_graph",
    );
    if (graphError) throw graphError;

    const [
      profileResult,
      pathsResult,
      jobsResult,
      knowledgeResult,
      analysisResult,
      interviewResult,
      actionsResult,
      graphNodesResult,
      existingTwinResult,
      taxonomyNodesResult,
      taxonomyEdgesResult,
      marketResult,
      portfolioResult,
      credentialsResult,
      companyProfilesResult,
    ] = await Promise.all([
      userClient.from("career_profiles").select("*").eq("user_id", userId).maybeSingle(),
      userClient.from("career_paths").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("job_descriptions").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("knowledge_evidence").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("career_analyses")
        .select("id,path_id,target_role,summary,findings,sources,status,completed_at")
        .eq("user_id", userId)
        .eq("status", "succeeded")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      userClient.from("interview_practice_sessions")
        .select("id,job_id,title,company,status,answered_count,earned_xp,assessment_status,assessment,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(50),
      userClient.from("action_plan_items").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("career_graph_nodes")
        .select("id,node_type,canonical_key,label,confidence")
        .eq("user_id", userId),
      userClient.from("career_twins")
        .select("input_fingerprint,graph_version")
        .eq("user_id", userId)
        .maybeSingle(),
      userClient.from("career_taxonomy_nodes")
        .select("id,taxonomy,external_id,node_type,preferred_label,aliases,description,metadata,updated_at")
        .limit(2000),
      userClient.from("career_taxonomy_edges")
        .select("id,from_node_id,to_node_id,relationship,weight,metadata")
        .limit(5000),
      userClient.from("labour_market_observations")
        .select("*")
        .eq("status", "published")
        .order("observed_to", { ascending: false })
        .limit(500),
      userClient.from("portfolio_assets")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(100),
      userClient.from("career_credentials")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(100),
      userClient.from("company_profiles")
        .select("id,canonical_name,industries,status,updated_at")
        .eq("status", "published")
        .limit(500),
    ]);

    for (const result of [
      profileResult,
      pathsResult,
      jobsResult,
      knowledgeResult,
      analysisResult,
      interviewResult,
      actionsResult,
      graphNodesResult,
      existingTwinResult,
      taxonomyNodesResult,
      taxonomyEdgesResult,
      marketResult,
      portfolioResult,
      credentialsResult,
      companyProfilesResult,
    ]) {
      if (result.error) throw result.error;
    }

    const intelligence = await buildCareerIntelligence({
      profile: profileResult.data,
      paths: pathsResult.data || [],
      jobs: jobsResult.data || [],
      knowledge: knowledgeResult.data || [],
      latestAnalysis: analysisResult.data,
      interviewSessions: interviewResult.data || [],
      actionPlanItems: actionsResult.data || [],
      graphNodes: graphNodesResult.data || [],
      taxonomyNodes: taxonomyNodesResult.data || [],
      taxonomyEdges: taxonomyEdgesResult.data || [],
      market: marketResult.data || [],
      portfolio: portfolioResult.data || [],
      credentials: credentialsResult.data || [],
      companyProfiles: companyProfilesResult.data || [],
    });

    if (existingTwinResult.data?.input_fingerprint === intelligence.fingerprint) {
      await recordOperationalEvent(admin, {
        userId,
        operation: "career_intelligence",
        outcome: "succeeded",
        latencyMs: Date.now() - startedAt,
        model: intelligence.twin.model,
      });
      return jsonResponse(request, {
        snapshot: await currentSnapshot(userClient),
        graph: graphSync,
        replayed: true,
      });
    }

    const graphVersion = Number(existingTwinResult.data?.graph_version || 0) + 1;
    const refreshedAt = new Date().toISOString();
    const twinRow = {
      user_id: userId,
      ...intelligence.twin,
      graph_version: graphVersion,
      refreshed_at: refreshedAt,
      updated_at: refreshedAt,
    };
    const { error: twinError } = await userClient.from("career_twins")
      .upsert(twinRow, { onConflict: "user_id" });
    if (twinError) throw twinError;

    const { error: snapshotError } = await userClient.from("career_twin_snapshots").insert({
      user_id: userId,
      graph_version: graphVersion,
      snapshot: intelligence.twin,
      evidence_refs: intelligence.twin.evidence_refs,
      reason: existingTwinResult.data ? "refresh" : "initial",
    });
    if (snapshotError) throw snapshotError;

    const { error: supersedeError } = await userClient.from("career_recommendations")
      .update({ state: "superseded", updated_at: refreshedAt })
      .eq("user_id", userId)
      .eq("state", "active");
    if (supersedeError) throw supersedeError;

    if (intelligence.recommendations.length) {
      const recommendationRows = intelligence.recommendations.map((recommendation) => ({
        user_id: userId,
        ...recommendation,
      }));
      const { error: recommendationError } = await userClient
        .from("career_recommendations")
        .insert(recommendationRows);
      if (recommendationError) throw recommendationError;
    }

    await recordOperationalEvent(admin, {
      userId,
      operation: "career_intelligence",
      outcome: "succeeded",
      latencyMs: Date.now() - startedAt,
      model: intelligence.twin.model,
    });
    return jsonResponse(request, {
      snapshot: await currentSnapshot(userClient),
      graph: graphSync,
      replayed: false,
    });
  } catch (error) {
    const errorCode = error instanceof Error
      ? error.message
      : String((error as any)?.code || "CAREER_INTELLIGENCE_FAILED");
    console.error(
      "career-intelligence failed",
      errorCode,
      String((error as any)?.message || "").slice(0, 300),
    );
    await recordOperationalEvent(admin, {
      userId: userId || undefined,
      operation: "career_intelligence",
      outcome: "failed",
      errorCode,
      latencyMs: Date.now() - startedAt,
    });
    return jsonResponse(request, {
      error: "Your Career Twin could not be refreshed.",
      code: "CAREER_INTELLIGENCE_FAILED",
    }, 500);
  }
});
