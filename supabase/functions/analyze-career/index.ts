import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

type RagDocument = {
  id: string;
  source_type: "cv" | "job_description" | "knowledge";
  text: string;
  metadata: Record<string, unknown>;
};

type AnalysisPayload = {
  requestId?: string;
  pathId?: string | null;
  targetRole?: string;
  documents?: RagDocument[];
};

class AnalysisError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const confidenceValues = new Set(["strong", "partial", "missing", "uncertain"]);

function openAiApiKey() {
  return Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_AI_KEY") || "";
}

async function openAi(path: string, body: unknown, timeoutMs: number) {
  let response: Response;
  try {
    response = await fetch(`https://api.openai.com/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new AnalysisError("AI_TIMEOUT", 504, "AI analysis timed out. Please try again.");
    }
    throw new AnalysisError("AI_UNAVAILABLE", 503, "AI analysis is temporarily unavailable.");
  }
  if (response.status === 429) {
    const retryAfter = Math.max(1, Number(response.headers.get("retry-after") || 30));
    throw new AnalysisError("AI_RATE_LIMITED", 503, "AI analysis is busy. Please try again shortly.", retryAfter);
  }
  if (!response.ok) {
    throw new AnalysisError("AI_UNAVAILABLE", 503, "AI analysis is temporarily unavailable.");
  }
  return response.json();
}

function validatePayload(payload: AnalysisPayload): {
  requestId: string;
  pathId: string | null;
  targetRole: string;
  documents: RagDocument[];
} {
  const requestId = String(payload.requestId || "");
  const pathId = payload.pathId ? String(payload.pathId) : null;
  const targetRole = String(payload.targetRole || "").trim();
  const documents = payload.documents;
  if (!uuidPattern.test(requestId)) {
    throw new AnalysisError("INVALID_REQUEST", 400, "A valid request ID is required.");
  }
  if (pathId && !uuidPattern.test(pathId)) {
    throw new AnalysisError("INVALID_REQUEST", 400, "A valid career path is required.");
  }
  if (!targetRole || targetRole.length > 200) {
    throw new AnalysisError("INVALID_REQUEST", 400, "A target role is required.");
  }
  if (!Array.isArray(documents) || !documents.length || documents.length > 250) {
    throw new AnalysisError("INVALID_DOCUMENTS", 400, "Provide between 1 and 250 document chunks.");
  }
  const sourceTypes = new Set(["cv", "job_description", "knowledge"]);
  let totalCharacters = 0;
  for (const item of documents) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id ||
      item.id.length > 240 ||
      !sourceTypes.has(item.source_type) ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      item.text.length > 12000 ||
      !item.metadata ||
      typeof item.metadata !== "object" ||
      Array.isArray(item.metadata)
    ) {
      throw new AnalysisError("INVALID_DOCUMENTS", 400, "A document chunk is invalid or too large.");
    }
    totalCharacters += item.text.length;
  }
  if (totalCharacters > 300000) {
    throw new AnalysisError("DOCUMENT_SET_TOO_LARGE", 413, "The combined CV and job evidence is too large.");
  }
  return { requestId, pathId, targetRole, documents };
}

function normalizeAnalysis(value: unknown, validLabels: Set<string>) {
  const result = value as Record<string, unknown>;
  const summary = typeof result?.summary === "string" ? result.summary.trim() : "";
  const rawFindings = Array.isArray(result?.findings) ? result.findings : [];
  if (!summary || summary.length > 20000 || rawFindings.length > 40) {
    throw new AnalysisError("INVALID_AI_RESPONSE", 502, "The analysis response could not be verified.");
  }
  const findings = rawFindings.map((raw) => {
    const item = raw as Record<string, unknown>;
    const skill = typeof item.skill === "string" ? item.skill.trim() : "";
    const confidence = typeof item.confidence === "string" ? item.confidence : "";
    const explanation = typeof item.explanation === "string" ? item.explanation.trim() : "";
    const citations = Array.isArray(item.citations)
      ? [...new Set(item.citations.map(String).filter((label) => validLabels.has(label)))]
      : [];
    if (
      !skill ||
      skill.length > 160 ||
      !confidenceValues.has(confidence) ||
      !explanation ||
      explanation.length > 4000 ||
      citations.length === 0
    ) {
      throw new AnalysisError("INVALID_AI_RESPONSE", 502, "The analysis response could not be verified.");
    }
    return { skill, confidence, explanation, citations };
  });
  if (!findings.length) {
    throw new AnalysisError("INVALID_AI_RESPONSE", 502, "The analysis response did not contain cited findings.");
  }
  return { summary, findings };
}

Deno.serve(async (request) => {
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);

  let requestId = "";
  let userId = "";
  let reserved = false;
  let admin: any = null;
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) {
      throw new AnalysisError("AUTHENTICATION_REQUIRED", 401, "Authentication required.");
    }
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
      throw new AnalysisError("INVALID_SESSION", 401, "Your session is no longer valid.");
    }

    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const rateLimit = await consumeRateLimit(admin, userId, "analyze-career", 5, 300);
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit, {
      ...Object.fromEntries(new Headers(jsonResponse(request, {}).headers).entries()),
    });

    const payload = validatePayload(await request.json() as AnalysisPayload);
    requestId = payload.requestId;

    const { data: existing, error: existingError } = await admin.from("career_analyses")
      .select("id,request_id,path_id,target_role,status,summary,findings,sources,model,created_at,completed_at")
      .eq("user_id", userId)
      .eq("request_id", requestId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === "succeeded") {
      const { data: access } = await userClient.rpc("get_my_account_access");
      return jsonResponse(request, {
        analysis: existing,
        summary: existing.summary,
        findings: existing.findings,
        access: access ? {
          plan_code: access.plan,
          used: access.rag_used,
          quota: access.rag_limit,
          allowed: true,
        } : null,
        replayed: true,
      });
    }

    if (!openAiApiKey()) {
      throw new AnalysisError("AI_NOT_CONFIGURED", 503, "AI analysis is not configured yet.");
    }

    const { data: reservation, error: reservationError } = await admin.rpc("reserve_career_analysis", {
      p_user_id: userId,
      p_request_id: requestId,
      p_path_id: payload.pathId,
      p_target_role: payload.targetRole,
      p_document_count: payload.documents.length,
    });
    if (reservationError) throw reservationError;
    const reservationState = String(reservation?.state || "");
    if (reservationState === "succeeded") {
      const { data: completed } = await admin.from("career_analyses")
        .select("id,request_id,path_id,target_role,status,summary,findings,sources,model,created_at,completed_at")
        .eq("user_id", userId)
        .eq("request_id", requestId)
        .single();
      return jsonResponse(request, {
        analysis: completed,
        summary: completed?.summary,
        findings: completed?.findings,
        access: reservation.access,
        replayed: true,
      });
    }
    if (reservationState === "pending" || reservationState === "user_busy") {
      throw new AnalysisError("ANALYSIS_IN_PROGRESS", 409, "This analysis is already running. Try again shortly.", 10);
    }
    if (reservationState === "quota_exceeded") {
      return jsonResponse(request, {
        error: "Your monthly AI analysis allowance has been used.",
        code: "PLAN_LIMIT_REACHED",
        access: reservation.access,
      }, 402);
    }
    if (reservationState !== "reserved") throw new Error("Analysis reservation failed");
    reserved = true;

    const embeddingResult = await openAi("embeddings", {
      model: "text-embedding-3-small",
      input: payload.documents.map((item) => item.text),
      dimensions: 1536,
    }, 45000);
    if (!Array.isArray(embeddingResult.data) || embeddingResult.data.length !== payload.documents.length) {
      throw new AnalysisError("INVALID_AI_RESPONSE", 502, "The embedding response could not be verified.");
    }

    const chunkRows = payload.documents.map((item, index) => ({
      user_id: userId,
      source_type: item.source_type,
      source_id: String(item.metadata?.source_id || item.id),
      chunk_index: Number(item.metadata?.chunk_index || 0),
      content: item.text,
      metadata: {
        ...item.metadata,
        path_id: item.source_type === "job_description" ? item.metadata?.path_id || null : null,
      },
      embedding: embeddingResult.data[index].embedding,
    }));
    const { error: cleanupError } = await userClient.from("document_chunks").delete().eq("user_id", userId);
    if (cleanupError) throw cleanupError;
    const { error: upsertError } = await userClient.from("document_chunks").upsert(chunkRows, {
      onConflict: "user_id,source_type,source_id,chunk_index",
    });
    if (upsertError) throw upsertError;

    const question = `Assess skill gaps for ${payload.targetRole}. Separate strong, partial, missing, and uncertain evidence.`;
    const queryEmbedding = await openAi("embeddings", {
      model: "text-embedding-3-small",
      input: question,
      dimensions: 1536,
    }, 30000);
    const { data: matches, error: matchError } = await userClient.rpc("match_career_chunks", {
      query_embedding: queryEmbedding.data[0].embedding,
      match_count: 16,
      filter_path: payload.pathId,
    });
    if (matchError) throw matchError;
    if (!Array.isArray(matches) || !matches.length) {
      throw new AnalysisError("NO_RELEVANT_EVIDENCE", 422, "No relevant CV or job evidence could be retrieved.");
    }

    const sources = matches.map((item: Record<string, unknown>, index: number) => {
      const metadata = (item.metadata || {}) as Record<string, unknown>;
      return {
        label: `D${index + 1}`,
        source_type: String(item.source_type || ""),
        source_id: String(item.source_id || ""),
        chunk_index: Number(metadata.chunk_index || 0),
        title: String(metadata.job_title || metadata.file_name || metadata.skill || item.source_type || ""),
        company: String(metadata.company || ""),
        source_url: String(metadata.source_url || ""),
        excerpt: String(item.content || "").slice(0, 700),
        similarity: Number(item.similarity || 0),
      };
    });
    const sourceText = matches.map((item: Record<string, unknown>, index: number) =>
      `[D${index + 1}] ${String(item.source_type || "source")}: ${String(item.content || "")}`
    ).join("\n\n");
    const model = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";
    const response = await openAi("responses", {
      model,
      instructions: "You are a careful career analyst. Use only the supplied sources. Every finding must cite one or more source labels. Treat missing CV evidence as missing or uncertain, never as proof that the user lacks a skill.",
      input: `${question}\n\nSources:\n${sourceText}`,
      text: {
        format: {
          type: "json_schema",
          name: "career_gap_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["summary", "findings"],
            properties: {
              summary: { type: "string" },
              findings: {
                type: "array",
                minItems: 1,
                maxItems: 40,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["skill", "confidence", "explanation", "citations"],
                  properties: {
                    skill: { type: "string" },
                    confidence: { type: "string", enum: ["strong", "partial", "missing", "uncertain"] },
                    explanation: { type: "string" },
                    citations: {
                      type: "array",
                      minItems: 1,
                      items: { type: "string", pattern: "^D[0-9]+$" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }, 75000);
    const outputText = response.output_text ||
      response.output?.flatMap((item: Record<string, unknown>) =>
        Array.isArray(item.content) ? item.content : []
      ).find((item: Record<string, unknown>) => item.type === "output_text")?.text;
    if (typeof outputText !== "string" || !outputText) {
      throw new AnalysisError("INVALID_AI_RESPONSE", 502, "The analysis response did not contain usable output.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new AnalysisError("INVALID_AI_RESPONSE", 502, "The analysis response could not be verified.");
    }
    const normalized = normalizeAnalysis(parsed, new Set(sources.map((source) => source.label)));

    const { data: completed, error: completeError } = await admin.rpc("complete_career_analysis", {
      p_user_id: userId,
      p_request_id: requestId,
      p_summary: normalized.summary,
      p_findings: normalized.findings,
      p_sources: sources,
      p_model: model,
    });
    if (completeError) throw completeError;
    reserved = false;

    await admin.from("audit_events").insert({
      user_id: userId,
      action: "analysis_succeeded",
      entity_type: "career_analysis",
      entity_id: completed.id,
      details: {
        request_id: requestId,
        path_id: payload.pathId,
        document_count: payload.documents.length,
        finding_count: normalized.findings.length,
        model,
      },
    });
    return jsonResponse(request, {
      analysis: completed,
      summary: normalized.summary,
      findings: normalized.findings,
      access: reservation.access,
    });
  } catch (error) {
    let known = error instanceof AnalysisError
      ? error
      : new AnalysisError("ANALYSIS_FAILED", 500, "Analysis failed. Please try again.");
    if (reserved && admin && userId && requestId) {
      const { error: releaseError } = await admin.rpc("fail_career_analysis", {
        p_user_id: userId,
        p_request_id: requestId,
        p_failure_code: known.code,
      });
      if (releaseError) {
        known = new AnalysisError(
          "QUOTA_STATUS_UNCERTAIN",
          500,
          "Analysis failed and the usage allowance could not be confirmed. Please contact beta support.",
        );
      }
    }
    console.error("analyze-career failed", { requestId, code: known.code });
    return jsonResponse(request, {
      error: known.message,
      code: known.code,
      retry_after_seconds: known.retryAfter,
    }, known.status, known.retryAfter ? { "Retry-After": String(known.retryAfter) } : {});
  }
});
