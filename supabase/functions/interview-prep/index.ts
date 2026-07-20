import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

type Question = {
  category: string;
  difficulty: "starter" | "stretch" | "challenge";
  question: string;
  why_it_matters: string;
  answer_framework: string;
  evidence_prompts: string[];
  evidence_labels: string[];
};

class InterviewError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const difficultyValues = new Set(["starter", "stretch", "challenge"]);

function outputText(response: Record<string, any>): string {
  return response.output_text ||
    response.output?.flatMap((item: Record<string, any>) => item.content || [])
      .find((item: Record<string, any>) => item.type === "output_text")?.text || "";
}

function normalizeQuestions(value: unknown, validLabels: Set<string>): Question[] {
  const raw = (value as Record<string, unknown>)?.questions;
  if (!Array.isArray(raw) || raw.length !== 6) {
    throw new InterviewError("INVALID_AI_RESPONSE", 502, "The interview questions could not be verified.");
  }
  return raw.map((entry) => {
    const item = entry as Record<string, unknown>;
    const category = String(item.category || "").trim();
    const difficulty = String(item.difficulty || "");
    const question = String(item.question || "").trim();
    const why = String(item.why_it_matters || "").trim();
    const framework = String(item.answer_framework || "").trim();
    const prompts = Array.isArray(item.evidence_prompts)
      ? item.evidence_prompts.map(String).map((text) => text.trim()).filter(Boolean)
      : [];
    const labels = Array.isArray(item.evidence_labels)
      ? [...new Set(item.evidence_labels.map(String).filter((label) => validLabels.has(label)))]
      : [];
    if (
      !category || category.length > 80 ||
      !difficultyValues.has(difficulty) ||
      !question || question.length > 1000 ||
      !why || why.length > 1000 ||
      !framework || framework.length > 2000 ||
      prompts.length < 1 || prompts.length > 4 ||
      prompts.some((text) => text.length > 500) ||
      labels.length < 1
    ) {
      throw new InterviewError("INVALID_AI_RESPONSE", 502, "The interview questions could not be verified.");
    }
    return {
      category,
      difficulty: difficulty as Question["difficulty"],
      question,
      why_it_matters: why,
      answer_framework: framework,
      evidence_prompts: prompts,
      evidence_labels: labels,
    };
  });
}

Deno.serve(async (request) => {
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);

  let admin: any = null;
  let userId = "";
  let reserved = false;
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new InterviewError("AUTHENTICATION_REQUIRED", 401, "Authentication required.");

    const userClient = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: userData, error: authError } = await userClient.auth.getUser(
      authorization.replace("Bearer ", ""),
    );
    userId = userData.user?.id || "";
    if (authError || !userId) {
      throw new InterviewError("INVALID_SESSION", 401, "Your session is no longer valid.");
    }

    const payload = await request.json() as { jobId?: string };
    const jobId = String(payload.jobId || "");
    if (!uuidPattern.test(jobId)) {
      throw new InterviewError("INVALID_REQUEST", 400, "Choose a valid job to practise.");
    }

    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const rateLimit = await consumeRateLimit(admin, userId, "interview-prep", 4, 600);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }

    const [{ data: job, error: jobError }, { data: profile, error: profileError }, { data: evidence, error: evidenceError }, { data: access, error: accessError }, { data: usage, error: usageError }] =
      await Promise.all([
        userClient.from("job_descriptions")
          .select("id,path_id,title,company,description")
          .eq("id", jobId)
          .single(),
        userClient.from("career_profiles")
          .select("cv_text,experience_level,career_goal")
          .eq("user_id", userId)
          .maybeSingle(),
        userClient.from("knowledge_evidence")
          .select("skill,title,evidence,confidence")
          .order("created_at", { ascending: false })
          .limit(12),
        userClient.rpc("get_my_account_access"),
        userClient.from("feature_usage_monthly")
          .select("usage_count")
          .eq("feature_key", "interview_prep")
          .eq("period_start", new Date().toISOString().slice(0, 7) + "-01")
          .maybeSingle(),
      ]);
    if (jobError || profileError || evidenceError || accessError || usageError) {
      throw new InterviewError("CONTEXT_UNAVAILABLE", 500, "Your interview context could not be loaded.");
    }

    const feature = access?.features?.interview_prep;
    const used = Number(usage?.usage_count || 0);
    const quota = feature?.quota === null ? null : Number(feature?.quota || 0);
    if (!feature?.enabled || (quota !== null && used >= quota)) {
      return jsonResponse(request, {
        error: "Your monthly interview practice allowance has been used.",
        code: "PLAN_LIMIT_REACHED",
        access: { plan_code: access?.plan || "free", used, quota, allowed: false },
      }, 402);
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_AI_KEY") || "";
    if (!apiKey) {
      throw new InterviewError("AI_NOT_CONFIGURED", 503, "AI interview preparation is not configured yet.");
    }

    const { data: reservation, error: reservationError } = await userClient.rpc("reserve_interview_prep");
    if (reservationError) throw reservationError;
    const reservationRow = Array.isArray(reservation) ? reservation[0] : reservation;
    if (!reservationRow?.allowed) {
      return jsonResponse(request, {
        error: "Your monthly interview practice allowance has been used.",
        code: "PLAN_LIMIT_REACHED",
        access: reservationRow,
      }, 402);
    }
    reserved = true;

    const sources = [
      { label: "J1", type: "job", title: `${job.title} at ${job.company || "target company"}`, text: String(job.description || "").slice(0, 16000) },
      ...(String(profile?.cv_text || "").trim()
        ? [{ label: "CV1", type: "cv", title: "Current CV", text: String(profile?.cv_text || "").slice(0, 30000) }]
        : []),
      ...(evidence || []).map((item: Record<string, unknown>, index: number) => ({
        label: `E${index + 1}`,
        type: "evidence",
        title: String(item.title || item.skill || "Knowledge evidence"),
        text: `${String(item.skill || "")}: ${String(item.evidence || "")}`.slice(0, 2500),
      })),
    ].filter((source) => source.text.trim());
    if (!sources.some((source) => source.label === "J1")) {
      throw new InterviewError("JOB_DESCRIPTION_REQUIRED", 422, "Add the job description before generating practice.");
    }

    const model = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";
    let aiResponse: Response;
    try {
      aiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          instructions: "You are an exacting interview coach. Create realistic questions for the target job using only the labelled context. Cover role expertise, evidence, behavioural judgement, and one thoughtful challenge. Never invent candidate experience. Each question must cite at least one context label and give a concise answer framework that helps the candidate structure their own truthful answer.",
          input: [
            `Candidate level: ${String(profile?.experience_level || "unspecified")}`,
            `Career goal: ${String(profile?.career_goal || "unspecified")}`,
            ...sources.map((source) => `[${source.label}] ${source.title}\n${source.text}`),
          ].join("\n\n"),
          text: {
            format: {
              type: "json_schema",
              name: "interview_practice_set",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["questions"],
                properties: {
                  questions: {
                    type: "array",
                    minItems: 6,
                    maxItems: 6,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["category", "difficulty", "question", "why_it_matters", "answer_framework", "evidence_prompts", "evidence_labels"],
                      properties: {
                        category: { type: "string" },
                        difficulty: { type: "string", enum: ["starter", "stretch", "challenge"] },
                        question: { type: "string" },
                        why_it_matters: { type: "string" },
                        answer_framework: { type: "string" },
                        evidence_prompts: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
                        evidence_labels: { type: "array", minItems: 1, items: { type: "string", pattern: "^(J1|CV1|E[0-9]+)$" } },
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
    } catch {
      throw new InterviewError("AI_UNAVAILABLE", 503, "Interview preparation is temporarily unavailable.");
    }
    if (!aiResponse.ok) {
      throw new InterviewError("AI_UNAVAILABLE", 503, "Interview preparation is temporarily unavailable.");
    }
    const aiResult = await aiResponse.json() as Record<string, any>;
    const text = outputText(aiResult);
    if (!text) throw new InterviewError("AI_REFUSED", 422, "Questions could not be created from this job context.");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new InterviewError("INVALID_AI_RESPONSE", 502, "The interview questions could not be verified.");
    }
    const questions = normalizeQuestions(parsed, new Set(sources.map((source) => source.label)));

    const { data: practice, error: insertError } = await admin.from("interview_practice_sessions")
      .insert({
        user_id: userId,
        path_id: job.path_id,
        job_id: job.id,
        title: job.title,
        company: job.company || "",
        questions,
        source_context: sources.map(({ label, type, title }) => ({ label, type, title })),
        model,
      })
      .select("*")
      .single();
    if (insertError) throw insertError;
    reserved = false;

    console.log(JSON.stringify({
      event: "interview_practice_created",
      session_id: practice.id,
      question_count: questions.length,
      timestamp: new Date().toISOString(),
    }));
    return jsonResponse(request, {
      practice,
      access: {
        plan_code: reservationRow.plan_code,
        used: reservationRow.used,
        quota: reservationRow.quota,
        allowed: true,
      },
    });
  } catch (error) {
    if (reserved && admin && userId) {
      const { error: refundError } = await admin.rpc("refund_interview_prep", { p_user_id: userId });
      if (refundError) console.error(JSON.stringify({ event: "interview_practice_refund_failed" }));
    }
    const known = error instanceof InterviewError;
    console.error(JSON.stringify({
      event: "interview_practice_failed",
      code: known ? error.code : "INTERVIEW_PREP_FAILED",
      timestamp: new Date().toISOString(),
    }));
    return jsonResponse(request, {
      error: known ? error.message : "Interview practice could not be created. Please try again.",
      code: known ? error.code : "INTERVIEW_PREP_FAILED",
    }, known ? error.status : 500);
  }
});
