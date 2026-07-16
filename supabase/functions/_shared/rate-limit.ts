type RpcError = { message?: string } | null;

type RpcClient = {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: RpcError }>;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: string;
};

export async function consumeRateLimit(
  client: RpcClient,
  userId: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitDecision> {
  const { data, error } = await client.rpc("consume_rate_limit", {
    p_user_id: userId,
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(error.message || "Rate-limit check failed");

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new Error("Rate-limit check returned no decision");

  return {
    allowed: Boolean(row.allowed),
    limit,
    remaining: Number(row.remaining || 0),
    retryAfterSeconds: Number(row.retry_after_seconds || 1),
    resetAt: String(row.reset_at || ""),
  };
}

export function rateLimitResponse(
  decision: RateLimitDecision,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify({
    error: "Too many requests. Try again shortly.",
    code: "RATE_LIMITED",
    retry_after_seconds: decision.retryAfterSeconds,
  }), {
    status: 429,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Retry-After": String(decision.retryAfterSeconds),
      "X-RateLimit-Limit": String(decision.limit),
      "X-RateLimit-Remaining": String(decision.remaining),
      "X-RateLimit-Reset": String(Math.floor(new Date(decision.resetAt).getTime() / 1000)),
    },
  });
}
