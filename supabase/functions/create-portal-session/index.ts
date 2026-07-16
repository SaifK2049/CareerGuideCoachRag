import Stripe from "npm:stripe@22.3.1";
import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { corsHeaders, handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

Deno.serve(async (request) => {
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  const headers = { ...corsHeaders(request), "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);
  try {
    const authorization = request.headers.get("Authorization");
    const appUrl = Deno.env.get("APP_URL");
    if (!authorization) return new Response('{"error":"Authentication required"}', { status: 401, headers });
    const userClient = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: userData, error: userError } = await userClient.auth.getUser(authorization.replace("Bearer ", ""));
    if (userError || !userData.user) return new Response('{"error":"Invalid session"}', { status: 401, headers });
    const admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const rateLimit = await consumeRateLimit(admin, userData.user.id, "create-portal-session", 10, 600);
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit, headers);
    if (!appUrl || !Deno.env.get("STRIPE_SECRET_KEY")) {
      return new Response('{"error":"Billing is not configured"}', { status: 503, headers });
    }
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);

    const { data: billing, error: billingError } = await admin.from("billing_customers")
      .select("stripe_customer_id").eq("user_id", userData.user.id).maybeSingle();
    if (billingError) throw billingError;
    if (!billing) return new Response('{"error":"No billing account exists yet"}', { status: 404, headers });
    const portal = await stripe.billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: `${appUrl.replace(/\/$/, "")}/?billing=return`,
    });
    return new Response(JSON.stringify({ url: portal.url }), { headers });
  } catch (_error) {
    console.error("create-portal-session failed");
    return jsonResponse(request, {
      error: "The billing portal is temporarily unavailable.",
      code: "PORTAL_FAILED",
    }, 500);
  }
});
