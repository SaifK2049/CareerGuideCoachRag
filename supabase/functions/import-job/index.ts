import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { recordOperationalEvent } from "../_shared/telemetry.ts";

const approvedHosts = [
  "greenhouse.io", "lever.co", "workdayjobs.com", "myworkdayjobs.com",
  "linkedin.com", "indeed.com", "smartrecruiters.com", "ashbyhq.com",
];

function outputText(response: Record<string, any>): string {
  return response.output_text ||
    response.output?.flatMap((item: Record<string, any>) => Array.isArray(item.content) ? item.content : [])
      .find((item: Record<string, any>) => item.type === "output_text")?.text || "";
}

function approvedUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (!approvedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return null;
    return url;
  } catch (_error) {
    return null;
  }
}

Deno.serve(async (request) => {
  const startedAt = Date.now();
  let admin: any = null;
  let userId = "";
  let telemetryModel = "";
  let telemetryUsage: Record<string, number> = {};
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
    userId = userData.user.id;
    const body = await request.json();
    const url = approvedUrl(String(body.url || ""));
    if (!url) {
      return jsonResponse(request, {
        error: "Use an HTTPS job link from LinkedIn, Indeed, Greenhouse, Lever, Workday, SmartRecruiters, or Ashby.",
      }, 400);
    }
    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const rateLimit = await consumeRateLimit(admin, userData.user.id, "import-job", 10, 300);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }
    const openAiKey = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_AI_KEY") || "";
    if (!openAiKey) {
      return jsonResponse(request, { error: "AI job import is not configured", code: "AI_NOT_CONFIGURED" }, 503);
    }
    const page = await fetch(url, {
      redirect: "error",
      headers: { "User-Agent": "Orynta Job Import/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!page.ok) return jsonResponse(request, { error: "The job page could not be retrieved. Paste the description instead." }, 422);
    const contentLength = Number(page.headers.get("content-length") || 0);
    if (contentLength > 1_000_000) return jsonResponse(request, { error: "The job page is too large to import." }, 413);
    const html = (await page.text()).slice(0, 1_000_000);
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80000);
    if (text.length < 200) return jsonResponse(request, { error: "No readable job description was found. Paste it instead." }, 422);
    const model = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";
    telemetryModel = model;
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: "Extract only the job listing fields present in the supplied page. Do not invent missing values. Keep the full useful responsibilities and requirements in description.",
        input: text,
        text: {
          format: {
            type: "json_schema",
            name: "job_import",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["title", "company", "location", "description"],
              properties: {
                title: { type: "string" },
                company: { type: "string" },
                location: { type: "string" },
                description: { type: "string" },
              },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!aiResponse.ok) throw new Error("OpenAI request failed");
    const aiData = await aiResponse.json();
    telemetryUsage = aiData.usage || {};
    const job = JSON.parse(outputText(aiData) || "{}");
    if (!job.title || !job.description) throw new Error("Invalid job import");
    await recordOperationalEvent(admin, {
      userId, operation: "import_job", outcome: "succeeded", latencyMs: Date.now() - startedAt,
      model: telemetryModel, inputTokens: telemetryUsage.input_tokens, outputTokens: telemetryUsage.output_tokens,
    });
    return jsonResponse(request, {
      job: {
        title: String(job.title).slice(0, 200),
        company: String(job.company || "").slice(0, 200),
        location: String(job.location || "").slice(0, 200),
        description: String(job.description).slice(0, 100000),
        sourceUrl: url.href,
      },
    });
  } catch (error) {
    console.error("import-job failed");
    await recordOperationalEvent(admin, {
      userId: userId || undefined, operation: "import_job", outcome: "failed",
      errorCode: error instanceof Error ? error.message : "IMPORT_JOB_FAILED", latencyMs: Date.now() - startedAt,
      model: telemetryModel,
    });
    return jsonResponse(request, { error: "The job could not be imported. Paste the description instead." }, 500);
  }
});
