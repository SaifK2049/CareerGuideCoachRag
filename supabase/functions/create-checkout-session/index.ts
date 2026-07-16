import Stripe from "npm:stripe@22.3.1";
import { createClient } from "npm:@supabase/supabase-js@2.110.6";

function cors(request: Request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || Deno.env.get("APP_URL") || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function response(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(request) });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  if (request.method !== "POST") return response(request, { error: "Method not allowed" }, 405);
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return response(request, { error: "Authentication required" }, 401);
    const appUrl = Deno.env.get("APP_URL");
    const priceId = Deno.env.get("STRIPE_PREMIUM_PRICE_ID");
    if (!appUrl || !priceId || !Deno.env.get("STRIPE_SECRET_KEY")) {
      return response(request, { error: "Billing is not configured" }, 503);
    }
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const token = authorization.replace("Bearer ", "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return response(request, { error: "Invalid session" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const userId = userData.user.id;
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
      }, { idempotencyKey: `masari-customer-${userId}` });
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
    }, { idempotencyKey: `masari-checkout-${userId}-${Math.floor(Date.now() / 300000)}` });
    return response(request, { url: checkout.url });
  } catch (error) {
    console.error(error);
    return response(request, { error: error instanceof Error ? error.message : "Checkout failed" }, 500);
  }
});
