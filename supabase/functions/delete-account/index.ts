import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import Stripe from "npm:stripe@22.3.1";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

function recentlyIssued(token: string, maximumAgeSeconds: number): boolean {
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    return Number.isFinite(payload.iat) &&
      Math.floor(Date.now() / 1000) - Number(payload.iat) <= maximumAgeSeconds;
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);

  try {
    const token = request.headers.get("Authorization")?.replace("Bearer ", "") || "";
    const body = await request.json();
    if (!token || body.confirmation !== "DELETE") {
      return jsonResponse(request, {
        error: "Type DELETE to confirm permanent account deletion.",
        code: "CONFIRMATION_REQUIRED",
      }, 400);
    }
    const admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data, error: userError } = await admin.auth.getUser(token);
    if (userError || !data.user) {
      return jsonResponse(request, { error: "Your session is no longer valid.", code: "INVALID_SESSION" }, 401);
    }
    if (!recentlyIssued(token, 15 * 60)) {
      return jsonResponse(request, {
        error: "Sign in again before permanently deleting your account.",
        code: "REAUTHENTICATION_REQUIRED",
      }, 401);
    }

    const rateLimit = await consumeRateLimit(admin, data.user.id, "delete-account", 3, 3600);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    }

    const { data: billing, error: billingError } = await admin.from("billing_customers")
      .select("stripe_customer_id").eq("user_id", data.user.id).maybeSingle();
    if (billingError) throw billingError;
    if (billing?.stripe_customer_id) {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) {
        return jsonResponse(request, {
          error: "Contact support to cancel the existing billing account before deletion.",
          code: "BILLING_CANCELLATION_REQUIRED",
        }, 409);
      }
      await new Stripe(stripeKey).customers.del(billing.stripe_customer_id);
    }

    const { data: files, error: listError } = await admin.storage.from("private-cvs").list(
      data.user.id,
      { limit: 100 },
    );
    if (listError) throw listError;
    const paths = (files || []).map((file) => `${data.user.id}/${file.name}`);
    if (paths.length) {
      const { error: removeError } = await admin.storage.from("private-cvs").remove(paths);
      if (removeError) throw removeError;
    }

    await admin.auth.admin.signOut(token, "global");
    const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
    if (deleteError) throw deleteError;
    return jsonResponse(request, { deleted: true });
  } catch (_error) {
    console.error("delete-account failed");
    return jsonResponse(request, {
      error: "Account deletion failed safely. No partial result is being claimed.",
      code: "DELETE_FAILED",
    }, 500);
  }
});
