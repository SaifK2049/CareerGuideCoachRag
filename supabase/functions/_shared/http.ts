const localOrigins = [
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4173",
  "http://localhost:3000",
  "http://localhost:4173",
];

function allowedOrigins(): Set<string> {
  const configured = [
    Deno.env.get("ALLOWED_ORIGINS") || "",
    Deno.env.get("APP_URL") || "",
  ].join(",");
  return new Set(
    configured.split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean)
      .concat(localOrigins),
  );
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = (request.headers.get("Origin") || "").replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins().has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function handleCors(request: Request): Response | null {
  const origin = (request.headers.get("Origin") || "").replace(/\/$/, "");
  const headers = corsHeaders(request);
  if (origin && !allowedOrigins().has(origin)) {
    return new Response(JSON.stringify({
      error: "This origin is not allowed",
      code: "ORIGIN_NOT_ALLOWED",
    }), {
      status: 403,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  return null;
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}
