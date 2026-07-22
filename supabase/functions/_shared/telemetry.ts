type TelemetryClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
  };
};

export type OperationalTelemetry = {
  userId?: string;
  operation: string;
  outcome: "succeeded" | "failed";
  errorCode?: string;
  latencyMs: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
};

export function telemetryErrorCode(value: unknown, fallback = "OPERATION_FAILED"): string {
  const candidate = typeof value === "string"
    ? value
    : value && typeof value === "object" && "code" in value
    ? String((value as { code?: unknown }).code || "")
    : "";
  const normalized = candidate.toUpperCase().replace(/[^A-Z0-9_:-]/g, "_").slice(0, 80);
  return normalized || fallback;
}

export async function recordOperationalEvent(
  client: TelemetryClient | null,
  event: OperationalTelemetry,
): Promise<void> {
  if (!client) return;
  try {
    const { error } = await client.from("operational_events").insert({
      user_id: event.userId || null,
      operation: event.operation,
      outcome: event.outcome,
      error_code: event.outcome === "failed" ? telemetryErrorCode(event.errorCode) : null,
      latency_ms: Math.max(0, Math.min(3600000, Math.round(event.latencyMs))),
      model: String(event.model || "").slice(0, 120),
      input_tokens: Number.isFinite(event.inputTokens) ? Math.max(0, Math.round(event.inputTokens!)) : null,
      output_tokens: Number.isFinite(event.outputTokens) ? Math.max(0, Math.round(event.outputTokens!)) : null,
    });
    if (error) console.error("operational telemetry insert failed");
  } catch {
    console.error("operational telemetry unavailable");
  }
}
