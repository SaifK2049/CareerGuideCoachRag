import Stripe from "npm:stripe@22.3.1";
import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { corsHeaders, handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

function response(request: Request, body: unknown, status = 200) {
  return jsonResponse(request, body, status);
}

Deno.serve(async (request) => {
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return response(request, { error: "Method not allowed" }, 405);
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return response(request, { error: "Authentication required" }, 401);

    const userClient = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const token = authorization.replace("Bearer ", "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return response(request, { error: "Invalid session" }, 401);

    const admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const userId = userData.user.id;
    const rateLimit = await consumeRateLimit(admin, userId, "create-checkout-session", 5, 600);
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit, corsHeaders(request));

    const appUrl = Deno.env.get("APP_URL");
    const priceId = Deno.env.get("STRIPE_PREMIUM_PRICE_ID");
    if (!appUrl || !priceId || !Deno.env.get("STRIPE_SECRET_KEY")) {
      return response(request, { error: "Billing is not configured" }, 503);
    }
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);

    const { data: subscription } = await admin.from("account_subscriptions")
      .select("status").eq("user_id", userId).maybeSingle();
    if (subscription && ["active", "trialing"].includes(subscription.status)) {
      return response(request, { error: "Premium is already active" }, 409);
    }

    const { data: billing } = await admin.from("billing_customers")
      .select("stripe_customer_id").eq("user_id", userId).maybeSingle();
    let customerId = billing?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userData.user.email,
        metadata: { supabase_user_id: userId },
      }, { idempotencyKey: `orynta-customer-${userId}` });
      customerId = customer.id;
      const { error } = await admin.from("billing_customers").upsert({
        user_id: userId,
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    }
    const existingSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });
    if (existingSubscriptions.data.some((item) =>
      ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"].includes(item.status)
    )) {
      return response(request, { error: "An existing subscription must be managed through the billing portal" }, 409);
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${appUrl.replace(/\/$/, "")}/?billing=success`,
      cancel_url: `${appUrl.replace(/\/$/, "")}/?billing=canceled`,
      subscription_data: { metadata: { supabase_user_id: userId, plan_code: "premium" } },
      metadata: { supabase_user_id: userId, plan_code: "premium" },
    }, { idempotencyKey: `orynta-checkout-${userId}-${Math.floor(Date.now() / 300000)}` });
    return response(request, { url: checkout.url });
  } catch (_error) {
    console.error("create-checkout-session failed");
    return response(request, {
      error: "Billing checkout is temporarily unavailable.",
      code: "CHECKOUT_FAILED",
    }, 500);
  }
});
