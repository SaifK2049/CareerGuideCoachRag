import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { recordOperationalEvent } from "../_shared/telemetry.ts";

type Row = Record<string, any>;

class VideoCoachError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function outputText(response: Row): string {
  return response.output_text ||
    response.output?.flatMap((item: Row) => item.content || [])
      .find((item: Row) => item.type === "output_text")?.text || "";
}

function fillerWords(transcript: string): Row {
  const normalized = transcript.toLowerCase();
  const phrases = ["um", "uh", "like", "you know", "basically", "actually"];
  return Object.fromEntries(phrases.map((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [phrase, (normalized.match(new RegExp(`\\b${escaped}\\b`, "g")) || []).length];
  }));
}

function normalizeReport(value: unknown): Row {
  const report = value as Row;
  const dimensions = [
    "gaze_alignment", "posture_stability", "gesture_use",
    "confidence_presentation", "answer_structure", "technical_depth",
  ];
  for (const dimension of dimensions) {
    const item = report?.[dimension];
    if (
      !item || typeof item !== "object" ||
      !String(item.observation || "").trim() ||
      !String(item.coaching || "").trim() ||
      !Number.isFinite(Number(item.confidence)) ||
      Number(item.confidence) < 0 || Number(item.confidence) > 1
    ) {
      throw new VideoCoachError("INVALID_AI_RESPONSE", 502, "The video coaching report could not be verified.");
    }
  }
  if (
    !String(report.summary || "").trim() ||
    !String(report.next_exercise || "").trim() ||
    !Array.isArray(report.strengths) ||
    !Array.isArray(report.improvements) ||
    report.strengths.length < 1 ||
    report.improvements.length < 1
  ) {
    throw new VideoCoachError("INVALID_AI_RESPONSE", 502, "The video coaching report could not be verified.");
  }
  return report;
}

Deno.serve(async (request) => {
  const startedAt = Date.now();
  let admin: any = null;
  let userId = "";
  let model = "";
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);
  try {
    const declaredSize = Number(request.headers.get("content-length") || 0);
    if (declaredSize > 6 * 1024 * 1024) {
      throw new VideoCoachError("VIDEO_SAMPLES_TOO_LARGE", 413, "Keep the sampled video frames under 6 MB.");
    }
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    const client = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) throw new VideoCoachError("AUTHENTICATION_REQUIRED", 401, "Authentication required.");
    userId = authData.user.id;
    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const limit = await consumeRateLimit(admin, userId, "interview-video-assess", 6, 600);
    if (!limit.allowed) {
      return rateLimitResponse(limit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }
    const { data: access, error: accessError } = await client.rpc("get_my_account_access");
    if (accessError) throw new VideoCoachError("ACCESS_UNAVAILABLE", 500, "Your plan could not be verified.");
    if (access?.plan !== "premium") {
      throw new VideoCoachError("PREMIUM_REQUIRED", 402, "Video interview coaching is available with Orynta Premium.");
    }
    const body = await request.json().catch(() => ({}));
    const sessionId = String(body.sessionId || "");
    const questionIndex = Number(body.questionIndex);
    const durationSeconds = Math.round(Number(body.durationSeconds));
    const transcript = String(body.transcript || "").trim();
    const frames: string[] = Array.isArray(body.frames) ? body.frames.map(String) : [];
    if (
      !uuidPattern.test(sessionId) ||
      !Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex > 20 ||
      !Number.isInteger(durationSeconds) || durationSeconds < 3 || durationSeconds > 180 ||
      !transcript || transcript.length > 8000 ||
      frames.length < 1 || frames.length > 8 ||
      frames.some((frame) => !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(frame) || frame.length > 550000)
    ) {
      throw new VideoCoachError("INVALID_VIDEO_SAMPLES", 400, "The transcript or sampled video frames are invalid.");
    }
    const { data: practice, error: practiceError } = await client.from("interview_practice_sessions")
      .select("id,user_id,title,company,questions")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single();
    if (practiceError || !practice) throw new VideoCoachError("PRACTICE_NOT_FOUND", 404, "The interview practice round was not found.");
    const questions = Array.isArray(practice.questions) ? practice.questions : [];
    const question = questions[questionIndex];
    if (!question) throw new VideoCoachError("QUESTION_NOT_FOUND", 404, "The interview question was not found.");

    const apiKey = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_AI_KEY") || "";
    if (!apiKey) throw new VideoCoachError("AI_NOT_CONFIGURED", 503, "Video interview coaching is not configured yet.");
    model = Deno.env.get("OPENAI_VISION_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";
    const words = transcript.split(/\s+/).filter(Boolean).length;
    const pace = Math.round(words / durationSeconds * 60 * 10) / 10;
    const fillers = fillerWords(transcript);
    const prompt = `Role: ${practice.title || "Target role"} at ${practice.company || "target company"}
Question: ${String(question.question || "")}
Transcript: ${transcript}
Duration: ${durationSeconds} seconds
Calculated speaking pace: ${pace} words per minute
Calculated filler words: ${JSON.stringify(fillers)}

Assess only observable presentation mechanics in the sampled frames and the supplied transcript. "Gaze alignment" means apparent orientation toward the camera, not literal eye contact. "Confidence presentation" means observable delivery signals such as steadiness, pace, and answer structure; do not infer mental state, personality, competence, disability, health, ethnicity, age, gender, attractiveness, emotion, accent quality, or hiring likelihood. Do not perform facial recognition. Acknowledge uncertainty because these are sparse frames. Evaluate technical depth only from the transcript.`;
    let aiResponse: Response;
    try {
      aiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          instructions: "You are a privacy-conscious interview presentation coach. Follow the scope and safety boundaries exactly. Give concrete, kind, evidence-linked coaching.",
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              ...frames.map((frame) => ({ type: "input_image", image_url: frame })),
            ],
          }],
          text: {
            format: {
              type: "json_schema",
              name: "video_interview_coaching",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: [
                  "summary", "strengths", "improvements", "gaze_alignment",
                  "posture_stability", "gesture_use", "confidence_presentation",
                  "answer_structure", "technical_depth", "next_exercise",
                ],
                properties: {
                  summary: { type: "string" },
                  strengths: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
                  improvements: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
                  gaze_alignment: { "$ref": "#/$defs/dimension" },
                  posture_stability: { "$ref": "#/$defs/dimension" },
                  gesture_use: { "$ref": "#/$defs/dimension" },
                  confidence_presentation: { "$ref": "#/$defs/dimension" },
                  answer_structure: { "$ref": "#/$defs/dimension" },
                  technical_depth: { "$ref": "#/$defs/dimension" },
                  next_exercise: { type: "string" },
                },
                "$defs": {
                  dimension: {
                    type: "object",
                    additionalProperties: false,
                    required: ["observation", "coaching", "confidence"],
                    properties: {
                      observation: { type: "string" },
                      coaching: { type: "string" },
                      confidence: { type: "number", minimum: 0, maximum: 1 },
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
      throw new VideoCoachError("AI_UNAVAILABLE", 503, "Video coaching is temporarily unavailable.");
    }
    if (!aiResponse.ok) throw new VideoCoachError("AI_UNAVAILABLE", 503, "Video coaching is temporarily unavailable.");
    const ai = await aiResponse.json() as Row;
    const raw = outputText(ai);
    if (!raw) throw new VideoCoachError("AI_REFUSED", 422, "The video samples could not be assessed.");
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new VideoCoachError("INVALID_AI_RESPONSE", 502, "The video coaching report could not be verified."); }
    const report = normalizeReport(parsed);
    const { data, error } = await client.from("interview_video_assessments").upsert({
      user_id: userId,
      session_id: sessionId,
      question_index: questionIndex,
      duration_seconds: durationSeconds,
      transcript,
      pace_words_per_minute: pace,
      filler_words: fillers,
      frame_count: frames.length,
      report,
      evidence_refs: [
        { type: "interview_practice_session", id: sessionId },
        { type: "interview_question", id: `${sessionId}:${questionIndex}` },
        { type: "transcript", id: `${sessionId}:${questionIndex}:video` },
      ],
      model,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,session_id,question_index" }).select("*").single();
    if (error) throw error;
    await recordOperationalEvent(admin, {
      userId,
      operation: "interview_video_assess",
      outcome: "succeeded",
      latencyMs: Date.now() - startedAt,
      model,
    });
    return jsonResponse(request, { assessment: data });
  } catch (error) {
    const known = error instanceof VideoCoachError;
    await recordOperationalEvent(admin, {
      userId: userId || undefined,
      operation: "interview_video_assess",
      outcome: "failed",
      errorCode: known ? error.code : "INTERVIEW_VIDEO_ASSESS_FAILED",
      latencyMs: Date.now() - startedAt,
      model,
    });
    return jsonResponse(request, {
      error: known ? error.message : "The video coaching report could not be created.",
      code: known ? error.code : "INTERVIEW_VIDEO_ASSESS_FAILED",
    }, known ? error.status : 500);
  }
});
