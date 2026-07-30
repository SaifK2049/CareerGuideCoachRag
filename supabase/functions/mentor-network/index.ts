import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { buildMentorMatches } from "../_shared/mentor-matching.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { recordOperationalEvent } from "../_shared/telemetry.ts";

type Row = Record<string, any>;

function textList(value: unknown, maximum = 30): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, maximum);
}

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
    const limit = await consumeRateLimit(admin, userId, "mentor-network", 20, 300);
    if (!limit.allowed) {
      return rateLimitResponse(limit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "matches");
    if (!["refresh", "matches", "request", "profile"].includes(action)) {
      return jsonResponse(request, { error: "Unsupported mentor action" }, 400);
    }

    if (action === "profile") {
      const profile = body.profile as Row || {};
      const mentorType = String(profile.mentorType || "");
      const headline = String(profile.headline || "").trim();
      const biography = String(profile.biography || "").trim();
      const acceptingMentees = profile.acceptingMentees === true;
      const capacity = Number(profile.maximumActiveMentees || 3);
      if (
        !["alumni", "industry_professional", "recruiter", "career_coach"].includes(mentorType) ||
        headline.length < 2 || headline.length > 240 ||
        biography.length > 4000 ||
        !Number.isInteger(capacity) || capacity < 1 || capacity > 50
      ) {
        return jsonResponse(request, { error: "A valid mentor profile is required" }, 400);
      }
      const { data: savedProfile, error: profileError } = await admin.from("mentor_profiles").upsert({
        user_id: userId,
        mentor_type: mentorType,
        headline,
        biography,
        industries: textList(profile.industries),
        skills: textList(profile.skills),
        locations: textList(profile.locations),
        languages: textList(profile.languages),
        experience_levels: textList(profile.experienceLevels),
        accepting_mentees: acceptingMentees,
        maximum_active_mentees: capacity,
        visibility: acceptingMentees ? "network" : "private",
        matching_consent_at: acceptingMentees ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" }).select("*").single();
      if (profileError) throw profileError;
      if (!acceptingMentees) {
        const { error: staleError } = await admin.from("mentor_matches").delete()
          .eq("mentor_user_id", userId)
          .eq("status", "suggested");
        if (staleError) throw staleError;
      }
      await recordOperationalEvent(admin, {
        userId,
        operation: "mentor_profile",
        outcome: "succeeded",
        latencyMs: Date.now() - startedAt,
        model: "explicit-discovery-consent-v1",
      });
      return jsonResponse(request, { profile: savedProfile });
    }

    if (action === "refresh") {
      const [profileResult, twinResult, mentorsResult] = await Promise.all([
        client.from("career_profiles").select("career_goal,experience_level,country").eq("user_id", userId).maybeSingle(),
        client.from("career_twins").select("*").eq("user_id", userId).maybeSingle(),
        client.from("mentor_profiles").select("*")
          .eq("accepting_mentees", true)
          .in("visibility", ["network", "public"])
          .neq("verification_status", "suspended")
          .limit(200),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (twinResult.error) throw twinResult.error;
      if (mentorsResult.error) throw mentorsResult.error;
      if (!twinResult.data) {
        return jsonResponse(request, {
          error: "Refresh the Career Twin before matching with mentors.",
          code: "CAREER_TWIN_REQUIRED",
        }, 409);
      }
      const matches = buildMentorMatches(
        userId,
        profileResult.data || {},
        twinResult.data,
        mentorsResult.data || [],
      );
      if (matches.length) {
        const { error } = await client.from("mentor_matches").upsert(matches, {
          onConflict: "user_id,mentor_user_id",
        });
        if (error) throw error;
      }
    }

    if (action === "request") {
      const matchId = String(body.matchId || "");
      const message = String(body.message || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(matchId) || message.length < 20 || message.length > 2000) {
        return jsonResponse(request, { error: "A valid match and introduction message are required" }, 400);
      }
      const { data: match, error: matchError } = await client.from("mentor_matches")
        .select("id,user_id,mentor_user_id,status")
        .eq("id", matchId)
        .eq("user_id", userId)
        .single();
      if (matchError) throw matchError;
      if (!["suggested", "requested"].includes(match.status)) {
        return jsonResponse(request, { error: "This mentor match cannot receive a request" }, 409);
      }
      const { error: requestError } = await client.from("mentorship_requests").upsert({
        match_id: match.id,
        user_id: userId,
        mentor_user_id: match.mentor_user_id,
        message,
        status: "pending",
        responded_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "match_id" });
      if (requestError) throw requestError;
      const { error: statusError } = await client.from("mentor_matches")
        .update({ status: "requested", updated_at: new Date().toISOString() })
        .eq("id", match.id)
        .eq("user_id", userId);
      if (statusError) throw statusError;
    }

    const { data: matches, error: matchesError } = await client.from("mentor_matches")
      .select("*,mentor_profiles(id,mentor_type,headline,biography,industries,skills,locations,languages,experience_levels,verification_status)")
      .eq("user_id", userId)
      .order("score", { ascending: false })
      .limit(30);
    if (matchesError) throw matchesError;
    await recordOperationalEvent(admin, {
      userId,
      operation: "mentor_network",
      outcome: "succeeded",
      latencyMs: Date.now() - startedAt,
      model: "mentor-match-v1",
    });
    return jsonResponse(request, { matches: matches || [] });
  } catch (error) {
    console.error("mentor-network failed");
    await recordOperationalEvent(admin, {
      userId: userId || undefined,
      operation: "mentor_network",
      outcome: "failed",
      errorCode: error instanceof Error ? error.message : "MENTOR_NETWORK_FAILED",
      latencyMs: Date.now() - startedAt,
    });
    return jsonResponse(request, {
      error: "Mentor matching could not be completed.",
      code: "MENTOR_NETWORK_FAILED",
    }, 500);
  }
});
