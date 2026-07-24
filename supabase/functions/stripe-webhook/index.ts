import Stripe from "npm:stripe@22.3.1";
import { createClient } from "npm:@supabase/supabase-js@2.110.6";

const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing Stripe signature", { status: 400 });
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET");
  if (!stripeKey || !webhookSecret) return new Response("Stripe webhook is not configured", { status: 503 });
  const stripe = new Stripe(stripeKey);
  const admin = createClient<any>(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    console.error("Invalid Stripe signature", error);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const { data: existing } = await admin.from("stripe_events")
      .select("processed_at").eq("event_id", event.id).maybeSingle();
    if (existing?.processed_at) return new Response(JSON.stringify({ received: true, duplicate: true }), {
      headers: { "Content-Type": "application/json" },
    });
    await admin.from("stripe_events").upsert({
      event_id: event.id,
      event_type: event.type,
      last_error: null,
    }, { onConflict: "event_id" });

    if (event.type === "checkout.session.completed") {
      const checkout = event.data.object as Stripe.Checkout.Session;
      const userId = checkout.client_reference_id || checkout.metadata?.supabase_user_id;
      const customerId = typeof checkout.customer === "string" ? checkout.customer : checkout.customer?.id;
      if (userId && customerId) {
        const { error } = await admin.from("billing_customers").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
    }

    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      let userId = subscription.metadata?.supabase_user_id;
      if (!userId) {
        const { data: billing } = await admin.from("billing_customers")
          .select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
        userId = billing?.user_id;
      }
      if (!userId && event.type !== "customer.subscription.deleted") {
        throw new Error(`No Orynta user is mapped to Stripe customer ${customerId}`);
      }
      if (!userId) {
        const { error: markDeletedError } = await admin.from("stripe_events").update({
          processed_at: new Date().toISOString(),
          last_error: null,
        }).eq("event_id", event.id);
        if (markDeletedError) throw markDeletedError;
        return new Response(JSON.stringify({ received: true, user_deleted: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      const item = subscription.items.data[0];
      const periodEnd = (subscription as unknown as { current_period_end?: number }).current_period_end ||
        (item as unknown as { current_period_end?: number }).current_period_end;
      const { error } = await admin.rpc("apply_stripe_subscription_event", {
        p_user_id: userId,
        p_plan_code: "premium",
        p_subscription_id: subscription.id,
        p_price_id: item?.price?.id || null,
        p_status: event.type === "customer.subscription.deleted" ? "canceled" : subscription.status,
        p_cancel_at_period_end: subscription.cancel_at_period_end,
        p_current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        p_event_created: event.created,
      });
      if (error) throw error;
    }

    const { error: markError } = await admin.from("stripe_events").update({
      processed_at: new Date().toISOString(),
      last_error: null,
    }).eq("event_id", event.id);
    if (markError) throw markError;
    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Stripe webhook processing failed", error);
    await admin.from("stripe_events").update({
      last_error: error instanceof Error ? error.message.slice(0, 1000) : "Unknown error",
    }).eq("event_id", event.id);
    return new Response("Webhook processing failed", { status: 500 });
  }
});
