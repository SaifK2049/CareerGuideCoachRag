import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

type Operation = "overview" | "users" | "feedback" | "system" | "export";
type ExportDataset = "users" | "feedback" | "feature_usage" | "operational_health";

type RequestBody = {
  operation?: Operation;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  plan?: string;
  onboarding?: string;
  category?: string;
  dataset?: ExportDataset;
};

function dateRange(body: RequestBody): { from: string; to: string } {
  const to = body.to ? new Date(body.to) : new Date();
  const from = body.from ? new Date(body.from) : new Date(to.getTime() - 30 * 86400000);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error("INVALID_RANGE");
  }
  if (to.getTime() - from.getTime() > 400 * 86400000) throw new Error("INVALID_RANGE");
  return { from: from.toISOString(), to: to.toISOString() };
}

function safeText(value: unknown, maximum = 200): string {
  return String(value || "").trim().slice(0, maximum);
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows: Record<string, unknown>[], columns: string[]): string {
  return [columns.map(csvCell).join(",")]
    .concat(rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")))
    .join("\r\n") + "\r\n";
}

async function allRows(
  admin: any,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.rpc(functionName, {
      ...parameters,
      p_limit: 100,
      p_offset: offset,
    });
    if (error) throw error;
    const batch = Array.isArray(data) ? data as Record<string, unknown>[] : [];
    rows.push(...batch);
    if (batch.length < 100) break;
    if (rows.length >= 50000) throw new Error("EXPORT_TOO_LARGE");
  }
  return rows;
}

Deno.serve(async (request) => {
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return jsonResponse(request, { error: "Authentication required", code: "AUTHENTICATION_REQUIRED" }, 401);

    const userClient = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: userData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !userData.user) {
      return jsonResponse(request, { error: "Your session is no longer valid", code: "INVALID_SESSION" }, 401);
    }
    if (userData.user.app_metadata?.role !== "admin") {
      return jsonResponse(request, { error: "Administrator access is required", code: "ADMIN_REQUIRED" }, 403);
    }

    const admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const rateLimit = await consumeRateLimit(admin, userData.user.id, "admin-analytics", 120, 60);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }

    const body = await request.json() as RequestBody;
    const operation = body.operation || "overview";
    const allowed: Operation[] = ["overview", "users", "feedback", "system", "export"];
    if (!allowed.includes(operation)) {
      return jsonResponse(request, { error: "Unknown analytics operation", code: "INVALID_OPERATION" }, 400);
    }
    const range = dateRange(body);

    if (operation === "overview" || operation === "system") {
      const functionName = operation === "overview" ? "admin_analytics_overview" : "admin_analytics_system";
      const { data, error } = await admin.rpc(functionName, { p_from: range.from, p_to: range.to });
      if (error) throw error;
      return jsonResponse(request, { data });
    }

    if (operation === "users" || operation === "feedback") {
      const page = Math.max(1, Math.floor(Number(body.page) || 1));
      const pageSize = Math.min(100, Math.max(10, Math.floor(Number(body.pageSize) || 25)));
      const common = {
        p_from: range.from,
        p_to: range.to,
        p_search: safeText(body.search),
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
      };
      const parameters = operation === "users"
        ? { ...common, p_plan: safeText(body.plan, 20), p_onboarding: safeText(body.onboarding, 20) }
        : { ...common, p_category: safeText(body.category, 20) };
      const { data, error } = await admin.rpc(`admin_analytics_${operation}`, parameters);
      if (error) throw error;
      const items = Array.isArray(data) ? data : [];
      return jsonResponse(request, {
        items,
        page,
        page_size: pageSize,
        total: Number(items[0]?.total_count || 0),
      });
    }

    const dataset = body.dataset;
    const exportDatasets: ExportDataset[] = ["users", "feedback", "feature_usage", "operational_health"];
    if (!dataset || !exportDatasets.includes(dataset)) {
      return jsonResponse(request, { error: "Unknown export dataset", code: "INVALID_EXPORT" }, 400);
    }

    let rows: Record<string, unknown>[] = [];
    let columns: string[] = [];
    if (dataset === "users") {
      rows = await allRows(admin, "admin_analytics_users", {
        p_from: range.from,
        p_to: range.to,
        p_search: safeText(body.search),
        p_plan: safeText(body.plan, 20),
        p_onboarding: safeText(body.onboarding, 20),
      });
      columns = [
        "user_id", "email", "display_name", "country", "experience_level", "created_at",
        "last_sign_in_at", "last_active_at", "onboarding_complete", "plan_code",
        "subscription_status", "path_count", "job_count", "evidence_count", "analysis_count",
        "application_count", "action_count", "interview_count",
      ];
    } else if (dataset === "feedback") {
      rows = await allRows(admin, "admin_analytics_feedback", {
        p_from: range.from,
        p_to: range.to,
        p_search: safeText(body.search),
        p_category: safeText(body.category, 20),
      });
      columns = ["id", "user_id", "email", "category", "message", "view_name", "app_version", "created_at"];
    } else {
      const functionName = dataset === "feature_usage" ? "admin_analytics_overview" : "admin_analytics_system";
      const { data, error } = await admin.rpc(functionName, { p_from: range.from, p_to: range.to });
      if (error) throw error;
      rows = dataset === "feature_usage" ? data?.features || [] : data?.operations || [];
      columns = dataset === "feature_usage"
        ? ["workflow", "users", "completed", "failed"]
        : ["operation", "succeeded", "failed", "success_rate", "p50_latency_ms", "p95_latency_ms", "input_tokens", "output_tokens"];
    }

    const output = csv(rows, columns);
    if (new TextEncoder().encode(output).byteLength > 25 * 1024 * 1024) {
      return jsonResponse(request, { error: "Export exceeds 25 MB. Narrow the date range.", code: "EXPORT_TOO_LARGE" }, 413);
    }
    const headers = Object.fromEntries(jsonResponse(request, {}).headers.entries());
    return new Response(output, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="masari-${dataset}-${range.from.slice(0, 10)}-${range.to.slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "INVALID_RANGE") {
      return jsonResponse(request, { error: "Choose a valid range of no more than 400 days", code }, 400);
    }
    if (code === "EXPORT_TOO_LARGE") {
      return jsonResponse(request, { error: "Export is too large. Narrow the date range.", code }, 413);
    }
    console.error("admin-analytics failed");
    return jsonResponse(request, { error: "Analytics could not be loaded", code: "ANALYTICS_FAILED" }, 500);
  }
});
