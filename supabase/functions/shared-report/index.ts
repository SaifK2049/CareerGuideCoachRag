import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { handleCors, jsonResponse } from "../_shared/http.ts";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);
  try {
    const { token } = await request.json();
    const rawToken = String(token || "");
    if (!/^[a-f0-9]{64}$/.test(rawToken)) return jsonResponse(request, { error: "Report not found" }, 404);
    const admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const reportResult = await admin.from("shared_reports")
      .select("id,user_id,path_id,analysis_id,expires_at")
      .eq("token_hash", await sha256(rawToken))
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (reportResult.error || !reportResult.data) return jsonResponse(request, { error: "Report not found or expired" }, 404);
    const report = reportResult.data;
    const [pathResult, analysisResult, actionsResult] = await Promise.all([
      admin.from("career_paths").select("name,target,description").eq("id", report.path_id).eq("user_id", report.user_id).single(),
      admin.from("career_analyses").select("summary,findings,completed_at").eq("id", report.analysis_id).eq("user_id", report.user_id).single(),
      admin.from("action_plan_items").select("title,skill,description,status,priority,target_date")
        .eq("path_id", report.path_id).eq("user_id", report.user_id).order("created_at"),
    ]);
    if (pathResult.error || analysisResult.error || actionsResult.error) throw new Error("Report data unavailable");
    return jsonResponse(request, {
      report: {
        path: pathResult.data,
        analysis: analysisResult.data,
        actions: actionsResult.data || [],
        expiresAt: report.expires_at,
      },
    });
  } catch (_error) {
    return jsonResponse(request, { error: "Report not found or expired" }, 404);
  }
});
