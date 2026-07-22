import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { recordOperationalEvent } from "../_shared/telemetry.ts";

class TranscriptionError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

const maxAudioBytes = 10 * 1024 * 1024;
const supportedTypes = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/mpga", "audio/m4a"];

Deno.serve(async (request) => {
  const startedAt = Date.now();
  let admin: any = null;
  let telemetryUserId = "";
  let telemetryModel = "";
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new TranscriptionError("AUTHENTICATION_REQUIRED", 401, "Authentication required.");
    const declaredSize = Number(request.headers.get("content-length") || 0);
    if (declaredSize > maxAudioBytes + 1024 * 1024) {
      throw new TranscriptionError("AUDIO_TOO_LARGE", 413, "Keep recordings under two minutes and 10 MB.");
    }

    const userClient = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: userData, error: authError } = await userClient.auth.getUser(
      authorization.replace("Bearer ", ""),
    );
    const userId = userData.user?.id || "";
    telemetryUserId = userId;
    if (authError || !userId) throw new TranscriptionError("INVALID_SESSION", 401, "Your session is no longer valid.");

    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const rateLimit = await consumeRateLimit(admin, userId, "interview-transcribe", 20, 600);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }

    const { data: access, error: accessError } = await userClient.rpc("get_my_account_access");
    if (accessError) throw new TranscriptionError("ACCESS_UNAVAILABLE", 500, "Your plan could not be verified.");
    if (access?.plan !== "premium" || !access?.features?.interview_voice?.enabled) {
      throw new TranscriptionError("PREMIUM_REQUIRED", 402, "Microphone practice is available with Masari Premium.");
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_AI_KEY") || "";
    if (!apiKey) throw new TranscriptionError("AI_NOT_CONFIGURED", 503, "Voice transcription is not configured yet.");

    let form: FormData;
    try { form = await request.formData(); }
    catch { throw new TranscriptionError("INVALID_AUDIO", 400, "The recording could not be read."); }
    const audio = form.get("audio");
    const question = String(form.get("question") || "").trim().slice(0, 1000);
    if (!(audio instanceof File) || audio.size < 1000 || audio.size > maxAudioBytes) {
      throw new TranscriptionError("INVALID_AUDIO", 400, "Record between one second and two minutes of audio.");
    }
    const mediaType = audio.type.toLowerCase().split(";")[0];
    if (!supportedTypes.includes(mediaType)) {
      throw new TranscriptionError("UNSUPPORTED_AUDIO", 415, "This browser's recording format is not supported.");
    }

    const openAiForm = new FormData();
    openAiForm.append("file", audio, audio.name || (mediaType.includes("mp4") ? "answer.m4a" : "answer.webm"));
    telemetryModel = Deno.env.get("OPENAI_TRANSCRIPTION_MODEL") || "gpt-4o-mini-transcribe";
    openAiForm.append("model", telemetryModel);
    openAiForm.append("response_format", "json");
    openAiForm.append("prompt", `Transcribe this interview-practice answer faithfully with punctuation. Preserve technical terms and do not add content.${question ? ` The interview question is: ${question}` : ""}`);

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: openAiForm,
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      throw new TranscriptionError("TRANSCRIPTION_UNAVAILABLE", 503, "Voice transcription is temporarily unavailable.");
    }
    if (!response.ok) throw new TranscriptionError("TRANSCRIPTION_UNAVAILABLE", 503, "Voice transcription is temporarily unavailable.");
    const result = await response.json() as { text?: unknown };
    const transcript = String(result.text || "").trim();
    if (!transcript) throw new TranscriptionError("EMPTY_TRANSCRIPT", 422, "No speech could be recognised. Try again closer to the microphone.");
    if (transcript.length > 8000) throw new TranscriptionError("TRANSCRIPT_TOO_LONG", 413, "The transcript is too long for one answer.");

    console.log(JSON.stringify({ event: "interview_audio_transcribed", audio_bytes: audio.size, transcript_characters: transcript.length, timestamp: new Date().toISOString() }));
    await recordOperationalEvent(admin, {
      userId: telemetryUserId, operation: "interview_transcribe", outcome: "succeeded",
      latencyMs: Date.now() - startedAt, model: telemetryModel,
    });
    return jsonResponse(request, { transcript });
  } catch (error) {
    const known = error instanceof TranscriptionError;
    console.error(JSON.stringify({ event: "interview_transcription_failed", code: known ? error.code : "TRANSCRIPTION_FAILED", timestamp: new Date().toISOString() }));
    await recordOperationalEvent(admin, {
      userId: telemetryUserId || undefined, operation: "interview_transcribe", outcome: "failed",
      errorCode: known ? error.code : "TRANSCRIPTION_FAILED", latencyMs: Date.now() - startedAt,
      model: telemetryModel,
    });
    return jsonResponse(request, {
      error: known ? error.message : "The recording could not be transcribed. Please try again.",
      code: known ? error.code : "TRANSCRIPTION_FAILED",
    }, known ? error.status : 500);
  }
});
