import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { handleCors, jsonResponse } from "../_shared/http.ts";

type TurnstileResult = {
  success: boolean;
  hostname?: string;
  "error-codes"?: string[];
};

function validEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

Deno.serve(async (request) => {
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);

  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const displayName = String(body.displayName || "").trim().slice(0, 120);
    const turnstileToken = String(body.turnstileToken || "");
    if (!validEmail(email)) {
      return jsonResponse(request, { error: "Enter a valid email address", code: "INVALID_EMAIL" }, 400);
    }
    if (!turnstileToken) {
      return jsonResponse(request, { error: "Complete the security check", code: "CAPTCHA_REQUIRED" }, 400);
    }

    const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!turnstileSecret) throw new Error("Turnstile secret is not configured");
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: turnstileSecret, response: turnstileToken }),
    });
    const challenge = await verification.json() as TurnstileResult;
    if (!challenge.success) {
      return jsonResponse(request, { error: "The security check expired. Please try again.", code: "CAPTCHA_FAILED" }, 400);
    }

    const admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const result = await admin.from("waitlist_signups").insert({
      email,
      display_name: displayName,
      source: "website",
      consented_at: new Date().toISOString(),
    });
    if (result.error && result.error.code !== "23505") throw result.error;

    return jsonResponse(request, {
      joined: true,
      alreadyJoined: result.error?.code === "23505",
      message: "You are on the Masari waitlist.",
    });
  } catch (_error) {
    console.error("join-waitlist failed");
    return jsonResponse(request, {
      error: "We could not join the waitlist right now. Please try again.",
      code: "WAITLIST_FAILED",
    }, 500);
  }
});
