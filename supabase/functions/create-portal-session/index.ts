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

Deno.serve(async (request) => {
  const headers = cors(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return new Response('{"error":"Method not allowed"}', { status: 405, headers });
  try {
    const authorization = request.headers.get("Authorization");
    const appUrl = Deno.env.get("APP_URL");
    if (!authorization) return new Response('{"error":"Authentication required"}', { status: 401, headers });
    if (!appUrl || !Deno.env.get("STRIPE_SECRET_KEY")) {
      return new Response('{"error":"Billing is not configured"}', { status: 503, headers });
    }
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: userData, error: userError } = await userClient.auth.getUser(authorization.replace("Bearer ", ""));
    if (userError || !userData.user) return new Response('{"error":"Invalid session"}', { status: 401, headers });
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: billing, error: billingError } = await admin.from("billing_customers")
      .select("stripe_customer_id").eq("user_id", userData.user.id).maybeSingle();
    if (billingError) throw billingError;
    if (!billing) return new Response('{"error":"No billing account exists yet"}', { status: 404, headers });
    const portal = await stripe.billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: `${appUrl.replace(/\/$/, "")}/?billing=return`,
    });
    return new Response(JSON.stringify({ url: portal.url }), { headers });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Billing portal failed" }), { status: 500, headers });
  }
});
