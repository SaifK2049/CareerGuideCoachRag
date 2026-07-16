import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import Stripe from "npm:stripe@22.3.1";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return new Response('{"error":"Method not allowed"}', { status: 405, headers });
  try {
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    const body = await request.json();
    if (!token || body.confirmation !== "DELETE") {
      return new Response('{"error":"Explicit confirmation required"}', { status: 400, headers });
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data, error: userError } = await admin.auth.getUser(token);
    if (userError || !data.user) return new Response('{"error":"Invalid session"}', { status: 401, headers });

    const { data: billing } = await admin.from("billing_customers")
      .select("stripe_customer_id").eq("user_id", data.user.id).maybeSingle();
    if (billing?.stripe_customer_id) {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) return new Response('{"error":"Billing is not configured"}', { status: 503, headers });
      const stripe = new Stripe(stripeKey);
      await stripe.customers.del(billing.stripe_customer_id);
    }
    await admin.storage.from("private-cvs").remove(
      (await admin.storage.from("private-cvs").list(data.user.id)).data?.map((file) => `${data.user.id}/${file.name}`) || [],
    );
    await admin.auth.admin.signOut(token, "global");
    const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
    if (deleteError) throw deleteError;
    return new Response('{"deleted":true}', { headers });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Deletion failed" }), { status: 500, headers });
  }
});
