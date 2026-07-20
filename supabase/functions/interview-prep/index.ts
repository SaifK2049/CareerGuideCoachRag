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

type InterviewAssessment = {
  score: number;
  verdict: "developing" | "solid" | "strong";
  summary: string;
  strengths: Array<{ title: string; detail: string; question_indexes: number[] }>;
  improvements: Array<{ title: string; detail: string; question_indexes: number[] }>;
  next_practice: { focus: string; exercise: string };
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

function normalizeAssessment(value: unknown, questionCount: number): InterviewAssessment {
  const result = value as Record<string, unknown>;
  const score = Number(result?.score);
  const verdict = String(result?.verdict || "");
  const summary = String(result?.summary || "").trim();
  const normalizePoints = (input: unknown) => Array.isArray(input) ? input.map((entry) => {
    const item = entry as Record<string, unknown>;
    const title = String(item.title || "").trim();
    const detail = String(item.detail || "").trim();
    const indexes = Array.isArray(item.question_indexes)
      ? [...new Set(item.question_indexes.map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < questionCount))]
      : [];
    if (!title || title.length > 160 || !detail || detail.length > 1200 || !indexes.length) {
      throw new InterviewError("INVALID_AI_RESPONSE", 502, "The interview feedback could not be verified.");
    }
    return { title, detail, question_indexes: indexes };
  }) : [];
  const strengths = normalizePoints(result?.strengths);
  const improvements = normalizePoints(result?.improvements);
  const next = result?.next_practice as Record<string, unknown> | undefined;
  const focus = String(next?.focus || "").trim();
  const exercise = String(next?.exercise || "").trim();
  if (
    !Number.isInteger(score) || score < 0 || score > 100 ||
    !["developing", "solid", "strong"].includes(verdict) ||
    !summary || summary.length > 2000 ||
    strengths.length < 2 || strengths.length > 4 ||
    improvements.length < 2 || improvements.length > 4 ||
    !focus || focus.length > 500 || !exercise || exercise.length > 1000
  ) {
    throw new InterviewError("INVALID_AI_RESPONSE", 502, "The interview feedback could not be verified.");
  }
  return {
    score,
    verdict: verdict as InterviewAssessment["verdict"],
    summary,
    strengths,
    improvements,
    next_practice: { focus, exercise },
  };
}

async function assessInterview(
  request: Request,
  userClient: any,
  admin: any,
  userId: string,
  sessionId: string,
) {
  if (!uuidPattern.test(sessionId)) {
    throw new InterviewError("INVALID_REQUEST", 400, "Choose a valid completed practice round.");
  }
  const apiKey = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_AI_KEY") || "";
  if (!apiKey) throw new InterviewError("AI_NOT_CONFIGURED", 503, "AI interview feedback is not configured yet.");

  const { data: reservation, error: reservationError } = await userClient.rpc("reserve_interview_assessment", {
    p_session_id: sessionId,
  });
  if (reservationError) throw new InterviewError("ASSESSMENT_NOT_READY", 422, reservationError.message);
  const state = String(reservation?.state || "");
  if (state === "succeeded") {
    return jsonResponse(request, { assessment: reservation.assessment, replayed: true });
  }
  if (state === "pending") {
    throw new InterviewError("ASSESSMENT_IN_PROGRESS", 409, "Your round feedback is already being prepared.");
  }
  if (state !== "reserved") throw new InterviewError("ASSESSMENT_NOT_READY", 422, "Complete every answer before requesting feedback.");

  try {
    const [{ data: practice, error: practiceError }, { data: answers, error: answersError }] = await Promise.all([
      userClient.from("interview_practice_sessions")
        .select("id,title,company,questions,status,answered_count")
        .eq("id", sessionId)
        .single(),
      userClient.from("interview_practice_answers")
        .select("question_index,answer_text,self_rating")
        .eq("session_id", sessionId)
        .order("question_index"),
    ]);
    if (practiceError || answersError || !practice) throw new InterviewError("CONTEXT_UNAVAILABLE", 500, "The completed round could not be loaded.");
    const questions = Array.isArray(practice.questions) ? practice.questions : [];
    if (!questions.length || !Array.isArray(answers) || answers.length !== questions.length) {
      throw new InterviewError("ASSESSMENT_NOT_READY", 422, "Complete every answer before requesting feedback.");
    }

    const model = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";
    const transcript = questions.map((question: Record<string, unknown>, index: number) => {
      const answer = answers.find((item: Record<string, unknown>) => Number(item.question_index) === index);
      return `Question ${index + 1}: ${String(question.question || "")}\nAnswer: ${String(answer?.answer_text || "")}\nSelf-rating: ${Number(answer?.self_rating || 0)}/5`;
    }).join("\n\n");
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
        model,
        instructions: "You are a rigorous but constructive interview coach. Evaluate only the content of the six written or transcribed answers: relevance, specificity, evidence, structure, judgement, and reflection. Do not infer voice delivery, accent, fluency, personality, protected traits, or hiring likelihood. Treat the score as a practice-quality score, not a probability of employment. Cite question indexes for every strength and improvement. Give specific, actionable feedback without inventing candidate experience.",
        input: `Role: ${String(practice.title || "Target role")} at ${String(practice.company || "target company")}\n\n${transcript}`,
        text: {
          format: {
            type: "json_schema",
            name: "interview_round_assessment",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["score", "verdict", "summary", "strengths", "improvements", "next_practice"],
              properties: {
                score: { type: "integer", minimum: 0, maximum: 100 },
                verdict: { type: "string", enum: ["developing", "solid", "strong"] },
                summary: { type: "string" },
                strengths: {
                  type: "array", minItems: 2, maxItems: 4,
                  items: {
                    type: "object", additionalProperties: false,
                    required: ["title", "detail", "question_indexes"],
                    properties: {
                      title: { type: "string" }, detail: { type: "string" },
                      question_indexes: { type: "array", minItems: 1, items: { type: "integer", minimum: 0, maximum: 5 } },
                    },
                  },
                },
                improvements: {
                  type: "array", minItems: 2, maxItems: 4,
                  items: {
                    type: "object", additionalProperties: false,
                    required: ["title", "detail", "question_indexes"],
                    properties: {
                      title: { type: "string" }, detail: { type: "string" },
                      question_indexes: { type: "array", minItems: 1, items: { type: "integer", minimum: 0, maximum: 5 } },
                    },
                  },
                },
                next_practice: {
                  type: "object", additionalProperties: false,
                  required: ["focus", "exercise"],
                  properties: { focus: { type: "string" }, exercise: { type: "string" } },
                },
              },
            },
          },
        },
        }),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new InterviewError("AI_UNAVAILABLE", 503, "Interview feedback is temporarily unavailable.");
    }
    if (!response.ok) throw new InterviewError("AI_UNAVAILABLE", 503, "Interview feedback is temporarily unavailable.");
    const result = await response.json() as Record<string, any>;
    const text = outputText(result);
    if (!text) throw new InterviewError("AI_REFUSED", 422, "Feedback could not be created from these answers.");
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { throw new InterviewError("INVALID_AI_RESPONSE", 502, "The interview feedback could not be verified."); }
    const assessment = normalizeAssessment(parsed, questions.length);
    const { data: completed, error: completeError } = await admin.rpc("complete_interview_assessment", {
      p_user_id: userId,
      p_session_id: sessionId,
      p_assessment: assessment,
      p_model: model,
    });
    if (completeError || !completed) throw new InterviewError("ASSESSMENT_SAVE_FAILED", 500, "The interview feedback could not be saved.");
    console.log(JSON.stringify({ event: "interview_assessment_completed", session_id: sessionId, score: assessment.score, timestamp: new Date().toISOString() }));
    return jsonResponse(request, { assessment, practice: completed });
  } catch (error) {
    const code = error instanceof InterviewError ? error.code : "ASSESSMENT_FAILED";
    const { error: failError } = await admin.rpc("fail_interview_assessment", {
      p_user_id: userId,
      p_session_id: sessionId,
      p_failure_code: code,
    });
    if (failError) console.error(JSON.stringify({ event: "interview_assessment_fail_state_failed" }));
    throw error;
  }
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

    const payload = await request.json() as { action?: string; jobId?: string; sessionId?: string };
    const action = String(payload.action || "generate");
    if (!new Set(["generate", "assess"]).has(action)) {
      throw new InterviewError("INVALID_REQUEST", 400, "This interview action is not supported.");
    }
    const sessionId = String(payload.sessionId || "");
    const jobId = String(payload.jobId || "");
    if (action === "generate" && !uuidPattern.test(jobId)) {
      throw new InterviewError("INVALID_REQUEST", 400, "Choose a valid job to practise.");
    }

    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const rateLimit = await consumeRateLimit(admin, userId, action === "assess" ? "interview-assessment" : "interview-prep", action === "assess" ? 6 : 4, 600);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }
    if (action === "assess") return await assessInterview(request, userClient, admin, userId, sessionId);

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
