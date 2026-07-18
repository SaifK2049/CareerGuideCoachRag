import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

Deno.serve(async (request) => {
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return jsonResponse(request, { error: "Authentication required" }, 401);
    const userClient = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: userData, error: authError } = await userClient.auth.getUser(
      authorization.replace("Bearer ", ""),
    );
    if (authError || !userData.user) {
      return jsonResponse(request, { error: "Your session is no longer valid" }, 401);
    }
    const admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const rateLimit = await consumeRateLimit(admin, userData.user.id, "export-account", 5, 3600);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }

    const userId = userData.user.id;
    const queries = await Promise.all([
      userClient.from("career_profiles").select("*").eq("user_id", userId).maybeSingle(),
      userClient.from("career_paths").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("job_descriptions").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("knowledge_evidence").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("career_analyses").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("audit_events").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("beta_feedback").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("analysis_finding_feedback").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("action_plan_items").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("analysis_evidence_links").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("cv_guidance").select("*").eq("user_id", userId).order("created_at"),
      userClient.from("shared_reports").select("id,path_id,analysis_id,expires_at,revoked_at,created_at").eq("user_id", userId).order("created_at"),
      admin.storage.from("private-cvs").list(userId, { limit: 100 }),
    ]);
    const error = queries.find((result) => result.error)?.error;
    if (error) throw error;

    return jsonResponse(request, {
      schema_version: "1.0",
      product: "Masari",
      exported_at: new Date().toISOString(),
      account: {
        id: userId,
        email: userData.user.email,
        created_at: userData.user.created_at,
      },
      profile: queries[0].data,
      career_paths: queries[1].data || [],
      job_descriptions: queries[2].data || [],
      knowledge_evidence: queries[3].data || [],
      career_analyses: queries[4].data || [],
      audit_events: queries[5].data || [],
      beta_feedback: queries[6].data || [],
      analysis_finding_feedback: queries[7].data || [],
      action_plan_items: queries[8].data || [],
      analysis_evidence_links: queries[9].data || [],
      cv_guidance: queries[10].data || [],
      shared_reports: queries[11].data || [],
      stored_cv_files: (queries[12].data || []).map((file) => ({
        name: file.name,
        created_at: file.created_at,
        updated_at: file.updated_at,
        metadata: file.metadata,
      })),
      note: "The extracted CV text is included in profile.cv_text. Binary PDF files remain in private storage and are not embedded in this JSON export.",
    }, 200, {
      "Content-Disposition": 'attachment; filename="masari-account-export.json"',
    });
  } catch (_error) {
    console.error("export-account failed");
    return jsonResponse(request, {
      error: "Your account export could not be created. Please try again.",
      code: "EXPORT_FAILED",
    }, 500);
  }
});
