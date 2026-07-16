import { createClient } from "npm:@supabase/supabase-js@2.52.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

type RagDocument = {
  id: string;
  source_type: "cv" | "job_description" | "knowledge";
  text: string;
  metadata: Record<string, unknown>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function openAi(path: string, body: unknown) {
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  return response.json();
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Authentication required" }, 401);
    if (!Deno.env.get("OPENAI_API_KEY")) return json({ error: "AI service is not configured" }, 503);

    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: userData, error: authError } = await client.auth.getUser(authorization.replace("Bearer ", ""));
    const userId = userData.user?.id;
    if (authError || !userId) return json({ error: "Invalid session" }, 401);

    const payload = await request.json();
    const documents = (payload.documents || []) as RagDocument[];
    if (!Array.isArray(documents) || !documents.length || documents.length > 250) {
      return json({ error: "Provide between 1 and 250 document chunks" }, 400);
    }
    if (documents.some((item) => !item.id || !item.text || item.text.length > 12000)) {
      return json({ error: "A document chunk is invalid or too large" }, 400);
    }

    const embeddingResult = await openAi("embeddings", {
      model: "text-embedding-3-small",
      input: documents.map((item) => item.text),
      dimensions: 1536,
    });
    const rows = documents.map((item, index) => ({
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
    const { error: cleanupError } = await client.from("document_chunks").delete().eq("user_id", userId);
    if (cleanupError) throw cleanupError;
    const { error: upsertError } = await client.from("document_chunks").upsert(rows, {
      onConflict: "user_id,source_type,source_id,chunk_index",
    });
    if (upsertError) throw upsertError;

    const question = `Assess skill gaps for ${payload.targetRole || "the target role"}. Separate strong, partial, missing, and uncertain evidence.`;
    const queryEmbedding = await openAi("embeddings", {
      model: "text-embedding-3-small",
      input: question,
      dimensions: 1536,
    });
    const { data: matches, error: matchError } = await client.rpc("match_career_chunks", {
      query_embedding: queryEmbedding.data[0].embedding,
      match_count: 16,
      filter_path: payload.pathId || null,
    });
    if (matchError) throw matchError;

    const sources = (matches || []).map((item: Record<string, unknown>, index: number) =>
      `[D${index + 1}] ${item.source_type}: ${item.content}`
    ).join("\n\n");
    const response = await openAi("responses", {
      model: Deno.env.get("OPENAI_MODEL") || "gpt-5-mini",
      instructions: "You are a careful career analyst. Use only the supplied sources. Every explanation must cite one or more source labels. Mark unsupported conclusions uncertain.",
      input: `${question}\n\nSources:\n${sources}`,
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
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["skill", "confidence", "explanation", "citations"],
                  properties: {
                    skill: { type: "string" },
                    confidence: { type: "string", enum: ["strong", "partial", "missing", "uncertain"] },
                    explanation: { type: "string" },
                    citations: { type: "array", items: { type: "string", pattern: "^D[0-9]+$" } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const outputText = response.output?.flatMap((item: Record<string, unknown>) =>
      Array.isArray(item.content) ? item.content : []
    ).find((item: Record<string, unknown>) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("AI response did not contain an analysis");

    await client.from("audit_events").insert({
      user_id: userId,
      action: "analyzed",
      entity_type: "career_path",
      entity_id: payload.pathId || null,
      details: { document_count: documents.length },
    });
    return json(JSON.parse(outputText));
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Analysis failed" }, 500);
  }
});
