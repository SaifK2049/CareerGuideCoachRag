import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [html, app, headers, supabaseConfig, billingMigration, analysisFunction, webhookFunction] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "app.js"), "utf8"),
  readFile(resolve(root, "_headers"), "utf8"),
  readFile(resolve(root, "supabase/config.toml"), "utf8"),
  readFile(resolve(root, "supabase/migrations/20260716163820_production_accounts_billing_entitlements.sql"), "utf8"),
  readFile(resolve(root, "supabase/functions/analyze-career/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/stripe-webhook/index.ts"), "utf8"),
]);

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`Duplicate HTML ids: ${[...new Set(duplicates)].join(", ")}`);

const referenced = [...app.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const missing = [...new Set(referenced.filter((id) => !ids.includes(id)))];
if (missing.length) throw new Error(`JavaScript references missing HTML ids: ${missing.join(", ")}`);

for (const required of ["authGate", "onboardingGate", "appShell", "membershipActionButton", "profileForm", "signinTurnstile", "signupTurnstile"]) {
  if (!ids.includes(required)) throw new Error(`Required production surface is missing: ${required}`);
}
for (const header of ["Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options"]) {
  if (!headers.includes(header)) throw new Error(`Required Cloudflare header is missing: ${header}`);
}
if (!/\[functions\.stripe-webhook\][\s\S]*?verify_jwt = false/.test(supabaseConfig)) {
  throw new Error("Stripe webhook must be public at the gateway so Stripe can reach signature verification");
}
for (const functionName of ["analyze-career", "create-checkout-session", "create-portal-session", "delete-account"]) {
  const pattern = new RegExp(`\\[functions\\.${functionName}\\][\\s\\S]*?verify_jwt = true`);
  if (!pattern.test(supabaseConfig)) throw new Error(`${functionName} must require a user JWT`);
}
for (const table of ["account_subscriptions", "feature_usage_monthly", "stripe_events"]) {
  if (!billingMigration.includes(`alter table public.${table} enable row level security`)) {
    throw new Error(`Billing table does not explicitly enable RLS: ${table}`);
  }
}
if (!billingMigration.includes("consume_feature_usage_internal") || !analysisFunction.includes('p_feature_key: "rag_analysis"')) {
  throw new Error("AI analysis is not connected to the server-enforced monthly quota");
}
if (!webhookFunction.includes("constructEventAsync") || !webhookFunction.includes("STRIPE_WEBHOOK_SIGNING_SECRET")) {
  throw new Error("Stripe webhook signature verification is missing");
}
if (/SERVICE_ROLE|SECRET_KEY/.test(app)) throw new Error("A server credential name appears in browser code");
if (!app.includes("if (config.localPreview) localStorage.setItem")) {
  throw new Error("Production browser persistence guard is missing");
}
if (!app.includes("captchaToken: captchaTokens.signin") || !app.includes("captchaToken: captchaTokens.signup")) {
  throw new Error("Sign-in, password recovery and sign-up must pass Cloudflare Turnstile tokens to Supabase");
}
if (!html.includes("https://challenges.cloudflare.com/turnstile/") || !headers.includes("frame-src https://challenges.cloudflare.com")) {
  throw new Error("Cloudflare Turnstile script or CSP permissions are missing");
}

console.log(`Static contract verified: ${ids.length} unique elements and ${referenced.length} JavaScript bindings.`);
