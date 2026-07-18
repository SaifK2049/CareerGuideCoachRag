import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function outputText(response: Record<string, any>): string {
  return response.output_text ||
    response.output?.flatMap((item: Record<string, any>) => Array.isArray(item.content) ? item.content : [])
      .find((item: Record<string, any>) => item.type === "output_text")?.text || "";
}

Deno.serve(async (request) => {
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);
  try {
    const authorization = request.headers.get("Authorization") || "";
    const userClient = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: userData, error: authError } = await userClient.auth.getUser(authorization.replace("Bearer ", ""));
    if (authError || !userData.user) return jsonResponse(request, { error: "Authentication required" }, 401);
    const { jobId } = await request.json();
    if (!uuidPattern.test(String(jobId || ""))) return jsonResponse(request, { error: "Choose a valid job" }, 400);
    const admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const rateLimit = await consumeRateLimit(admin, userData.user.id, "cv-guidance", 3, 300);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }
    const openAiKey = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_AI_KEY") || "";
    if (!openAiKey) {
      return jsonResponse(request, { error: "AI guidance is not configured", code: "AI_NOT_CONFIGURED" }, 503);
    }
    const [profileResult, jobResult] = await Promise.all([
      userClient.from("career_profiles").select("cv_text").eq("user_id", userData.user.id).maybeSingle(),
      userClient.from("job_descriptions").select("id,path_id,title,company,description")
        .eq("user_id", userData.user.id).eq("id", jobId).maybeSingle(),
    ]);
    if (profileResult.error || jobResult.error) throw profileResult.error || jobResult.error;
    if (!profileResult.data?.cv_text) return jsonResponse(request, { error: "Add your CV before requesting guidance" }, 422);
    if (!jobResult.data) return jsonResponse(request, { error: "The selected job was not found" }, 404);

    const model = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: "You are a careful CV coach. Use only the supplied CV and job description. Never invent experience, skills, employers, dates, metrics, or qualifications. Suggestions must preserve truth and clearly say when evidence is missing.",
        input: `Job: ${jobResult.data.title} at ${jobResult.data.company || "the target company"}\n\nJob description:\n${jobResult.data.description.slice(0, 40000)}\n\nCurrent CV:\n${profileResult.data.cv_text.slice(0, 60000)}`,
        text: {
          format: {
            type: "json_schema",
            name: "cv_guidance",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["summary", "suggestions"],
              properties: {
                summary: { type: "string" },
                suggestions: {
                  type: "array",
                  maxItems: 12,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["section", "issue", "recommendation", "evidence_status"],
                    properties: {
                      section: { type: "string" },
                      issue: { type: "string" },
                      recommendation: { type: "string" },
                      evidence_status: { type: "string", enum: ["supported", "needs_user_evidence"] },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!aiResponse.ok) throw new Error("OpenAI request failed");
    const aiData = await aiResponse.json();
    const output = JSON.parse(outputText(aiData) || "{}");
    if (!output.summary || !Array.isArray(output.suggestions)) throw new Error("Invalid guidance response");
    const insert = await admin.from("cv_guidance").insert({
      user_id: userData.user.id,
      path_id: jobResult.data.path_id,
      job_id: jobResult.data.id,
      summary: String(output.summary).slice(0, 20000),
      suggestions: output.suggestions.slice(0, 12),
      model,
    }).select().single();
    if (insert.error) throw insert.error;
    return jsonResponse(request, { guidance: insert.data });
  } catch (_error) {
    console.error("cv-guidance failed");
    return jsonResponse(request, { error: "CV guidance could not be created. Please try again." }, 500);
  }
});
