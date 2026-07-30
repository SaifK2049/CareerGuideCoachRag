import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { recordOperationalEvent } from "../_shared/telemetry.ts";
import { buildGovernmentWorkforceDashboard } from "../_shared/workforce-intelligence.ts";

function uuid(value: unknown): string {
  const candidate = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : "";
}

const consentScopes = new Set([
  "cohort_analytics",
  "individual_guidance",
  "placement_reporting",
  "programme_evaluation",
  "mentor_matching",
]);

Deno.serve(async (request) => {
  const startedAt = Date.now();
  let admin: any = null;
  let userId = "";
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    const client = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) return jsonResponse(request, { error: "Authentication required" }, 401);
    userId = authData.user.id;
    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const limit = await consumeRateLimit(admin, userId, "institution-dashboard", 60, 300);
    if (!limit.allowed) {
      return rateLimitResponse(limit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "organizations");
    if (!["organizations", "dashboard", "my_consents", "set_consent"].includes(action)) {
      return jsonResponse(request, { error: "Unsupported institution action" }, 400);
    }

    if (action === "my_consents") {
      const [
        { data: cohortMemberships, error: cohortMembershipsError },
        { data: organizationMemberships, error: organizationMembershipsError },
        { data: consents, error: consentsError },
      ] = await Promise.all([
        admin.from("organization_cohort_members")
          .select("cohort_id,organization_id,status,joined_at")
          .eq("user_id", userId)
          .in("status", ["active", "completed"]),
        admin.from("organization_memberships")
          .select("organization_id,role,status")
          .eq("user_id", userId)
          .eq("status", "active"),
        admin.from("organization_data_consents")
          .select("organization_id,scopes,status,consent_version,granted_at,expires_at,withdrawn_at,updated_at")
          .eq("user_id", userId),
      ]);
      if (cohortMembershipsError) throw cohortMembershipsError;
      if (organizationMembershipsError) throw organizationMembershipsError;
      if (consentsError) throw consentsError;
      const organizationIds = Array.from(new Set([
        ...(cohortMemberships || []).map((membership: any) => membership.organization_id),
        ...(organizationMemberships || []).map((membership: any) => membership.organization_id),
      ]));
      if (!organizationIds.length) return jsonResponse(request, { consents: [] });
      const cohortIds = (cohortMemberships || []).map((membership: any) => membership.cohort_id);
      const [
        { data: organizations, error: organizationsError },
        { data: cohorts, error: cohortsError },
      ] = await Promise.all([
        admin.from("organizations")
          .select("id,name,organization_type,country_code,region")
          .in("id", organizationIds),
        cohortIds.length
          ? admin.from("organization_cohorts")
            .select("id,organization_id,programme_id,name,status")
            .in("id", cohortIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (organizationsError) throw organizationsError;
      if (cohortsError) throw cohortsError;
      return jsonResponse(request, {
        consents: organizationIds.map((organizationId) => ({
          organization: (organizations || []).find((item: any) => item.id === organizationId) || null,
          cohorts: (cohorts || []).filter((item: any) => item.organization_id === organizationId),
          organization_membership: (organizationMemberships || [])
            .find((item: any) => item.organization_id === organizationId) || null,
          consent: (consents || []).find((item: any) => item.organization_id === organizationId) || null,
        })),
      });
    }

    if (action === "set_consent") {
      const organizationId = uuid(body.organizationId);
      const requestedScopes: string[] = Array.isArray(body.scopes)
        ? Array.from(new Set(body.scopes.map((scope: unknown) => String(scope))))
        : [];
      const grant = body.granted === true;
      if (
        !organizationId ||
        (grant && !requestedScopes.length) ||
        requestedScopes.some((scope) => !consentScopes.has(scope))
      ) {
        return jsonResponse(request, { error: "A valid organization, consent decision, and scope are required" }, 400);
      }
      const [
        { data: cohortMembership },
        { data: organizationMembership },
      ] = await Promise.all([
        admin.from("organization_cohort_members")
          .select("cohort_id")
          .eq("organization_id", organizationId)
          .eq("user_id", userId)
          .in("status", ["active", "completed"])
          .limit(1)
          .maybeSingle(),
        admin.from("organization_memberships")
          .select("organization_id")
          .eq("organization_id", organizationId)
          .eq("user_id", userId)
          .eq("status", "active")
          .maybeSingle(),
      ]);
      if (!cohortMembership && !organizationMembership) {
        return jsonResponse(request, { error: "You are not a participant in this organization" }, 403);
      }
      const now = new Date().toISOString();
      const consent = grant
        ? {
          organization_id: organizationId,
          user_id: userId,
          scopes: requestedScopes,
          status: "active",
          consent_version: "participant-controls-v1",
          granted_at: now,
          expires_at: null,
          withdrawn_at: null,
          updated_at: now,
        }
        : {
          organization_id: organizationId,
          user_id: userId,
          scopes: [],
          status: "withdrawn",
          consent_version: "participant-controls-v1",
          granted_at: now,
          expires_at: null,
          withdrawn_at: now,
          updated_at: now,
        };
      const { data, error } = await admin.from("organization_data_consents")
        .upsert(consent, { onConflict: "organization_id,user_id" })
        .select("organization_id,scopes,status,consent_version,granted_at,expires_at,withdrawn_at,updated_at")
        .single();
      if (error) throw error;
      await recordOperationalEvent(admin, {
        userId,
        operation: "institution_consent",
        outcome: "succeeded",
        latencyMs: Date.now() - startedAt,
        model: "participant-controls-v1",
      });
      return jsonResponse(request, { consent: data });
    }

    if (action === "organizations") {
      const { data, error } = await client.from("organization_memberships")
        .select("organization_id,role,status,organizations(id,name,slug,organization_type,country_code,region)")
        .eq("user_id", userId)
        .eq("status", "active");
      if (error) throw error;
      return jsonResponse(request, { memberships: data || [] });
    }

    const organizationId = uuid(body.organizationId);
    const cohortId = body.cohortId ? uuid(body.cohortId) : null;
    if (!organizationId || (body.cohortId && !cohortId)) {
      return jsonResponse(request, { error: "A valid organization and cohort are required" }, 400);
    }
    const [
      { data: dashboard, error: dashboardError },
      { data: cohorts, error: cohortsError },
      { data: organization, error: organizationError },
      { data: programmes, error: programmesError },
    ] = await Promise.all([
      client.rpc("get_organization_employability_dashboard", {
        p_organization_id: organizationId,
        p_cohort_id: cohortId,
      }),
      client.from("organization_cohorts")
        .select("id,name,status,starts_on,ends_on,programme_id")
        .eq("organization_id", organizationId)
        .order("created_at"),
      client.from("organizations")
        .select("id,name,organization_type,country_code,region,settings")
        .eq("id", organizationId)
        .single(),
      client.from("organization_programmes")
        .select("id,name,programme_type,status,starts_on,ends_on")
        .eq("organization_id", organizationId)
        .order("created_at"),
    ]);
    if (dashboardError) throw dashboardError;
    if (cohortsError) throw cohortsError;
    if (organizationError) throw organizationError;
    if (programmesError) throw programmesError;
    let workforce: Record<string, any> = { available: false };
    if (organization.organization_type === "government") {
      let marketQuery = client.from("labour_market_observations")
        .select("*")
        .eq("status", "published")
        .order("observed_to", { ascending: false })
        .limit(1000);
      if (organization.country_code) marketQuery = marketQuery.eq("country_code", organization.country_code);
      const { data: market, error: marketError } = await marketQuery;
      if (marketError) throw marketError;
      workforce = buildGovernmentWorkforceDashboard(
        organization,
        market || [],
        programmes || [],
        dashboard,
      );
    }
    await recordOperationalEvent(admin, {
      userId,
      operation: "institution_dashboard",
      outcome: "succeeded",
      latencyMs: Date.now() - startedAt,
      model: "aggregate-v1",
    });
    return jsonResponse(request, { dashboard, cohorts: cohorts || [], workforce });
  } catch (error) {
    console.error("institution-dashboard failed");
    await recordOperationalEvent(admin, {
      userId: userId || undefined,
      operation: "institution_dashboard",
      outcome: "failed",
      errorCode: error instanceof Error ? error.message : "INSTITUTION_DASHBOARD_FAILED",
      latencyMs: Date.now() - startedAt,
    });
    return jsonResponse(request, {
      error: "The institutional dashboard could not be loaded.",
      code: "INSTITUTION_DASHBOARD_FAILED",
    }, 500);
  }
});
