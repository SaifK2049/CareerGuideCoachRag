import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [
  html,
  app,
  headers,
  supabaseConfig,
  billingMigration,
  rateLimitMigration,
  betaMigration,
  serializationMigration,
  rateLimitHelper,
  httpHelper,
  analysisFunction,
  exportFunction,
  checkoutFunction,
  portalFunction,
  deleteFunction,
  webhookFunction,
  privacyNotice,
  betaTerms,
] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "app.js"), "utf8"),
  readFile(resolve(root, "_headers"), "utf8"),
  readFile(resolve(root, "supabase/config.toml"), "utf8"),
  readFile(resolve(root, "supabase/migrations/20260716163820_production_accounts_billing_entitlements.sql"), "utf8"),
  readFile(resolve(root, "supabase/migrations/20260716205341_edge_function_rate_limits.sql"), "utf8"),
  readFile(resolve(root, "supabase/migrations/20260716212204_private_beta_readiness.sql"), "utf8"),
  readFile(resolve(root, "supabase/migrations/20260716215538_serialize_user_analyses.sql"), "utf8"),
  readFile(resolve(root, "supabase/functions/_shared/rate-limit.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/_shared/http.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/analyze-career/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/export-account/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/create-checkout-session/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/create-portal-session/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/delete-account/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/stripe-webhook/index.ts"), "utf8"),
  readFile(resolve(root, "privacy.html"), "utf8"),
  readFile(resolve(root, "beta-terms.html"), "utf8"),
]);

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`Duplicate HTML ids: ${[...new Set(duplicates)].join(", ")}`);

const referenced = [...app.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const missing = [...new Set(referenced.filter((id) => !ids.includes(id)))];
if (missing.length) throw new Error(`JavaScript references missing HTML ids: ${missing.join(", ")}`);

for (const required of ["authGate", "onboardingGate", "appShell", "membershipActionButton", "profileForm", "signinTurnstile", "signupTurnstile", "feedbackForm", "deleteAccountForm", "betaConsentForm"]) {
  if (!ids.includes(required)) throw new Error(`Required production surface is missing: ${required}`);
}
for (const header of ["Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options"]) {
  if (!headers.includes(header)) throw new Error(`Required Cloudflare header is missing: ${header}`);
}
if (!/\[functions\.stripe-webhook\][\s\S]*?verify_jwt = false/.test(supabaseConfig)) {
  throw new Error("Stripe webhook must be public at the gateway so Stripe can reach signature verification");
}
for (const functionName of ["analyze-career", "create-checkout-session", "create-portal-session", "delete-account", "export-account"]) {
  const pattern = new RegExp(`\\[functions\\.${functionName}\\][\\s\\S]*?verify_jwt = true`);
  if (!pattern.test(supabaseConfig)) throw new Error(`${functionName} must require a user JWT`);
}
for (const table of ["account_subscriptions", "feature_usage_monthly", "stripe_events"]) {
  if (!billingMigration.includes(`alter table public.${table} enable row level security`)) {
    throw new Error(`Billing table does not explicitly enable RLS: ${table}`);
  }
}
for (const table of ["career_analyses", "beta_feedback"]) {
  if (!betaMigration.includes(`alter table public.${table} enable row level security`)) {
    throw new Error(`Private-beta table does not explicitly enable RLS: ${table}`);
  }
}
if (
  !betaMigration.includes("reserve_career_analysis_internal") ||
  !betaMigration.includes("fail_career_analysis_internal") ||
  !analysisFunction.includes('admin.rpc("reserve_career_analysis"') ||
  !analysisFunction.includes('admin.rpc("fail_career_analysis"')
) {
  throw new Error("AI analysis does not reserve and release its server-enforced quota");
}
if (!analysisFunction.includes('admin.rpc("complete_career_analysis"') || !analysisFunction.includes("requestId")) {
  throw new Error("AI analysis persistence or idempotency is missing");
}
if (
  !serializationMigration.includes("career_analyses_one_pending_user_idx") ||
  !serializationMigration.includes("'state', 'user_busy'") ||
  !analysisFunction.includes('reservationState === "user_busy"')
) {
  throw new Error("Concurrent analyses are not serialized per user");
}
if (!webhookFunction.includes("constructEventAsync") || !webhookFunction.includes("STRIPE_WEBHOOK_SIGNING_SECRET")) {
  throw new Error("Stripe webhook signature verification is missing");
}
if (
  !rateLimitMigration.includes("private.rate_limit_buckets") ||
  !rateLimitMigration.includes("grant execute on function public.consume_rate_limit") ||
  !rateLimitHelper.includes('code: "RATE_LIMITED"')
) {
  throw new Error("Atomic server-side rate limiting is missing");
}
for (const [name, source] of [
  ["analyze-career", analysisFunction],
  ["create-checkout-session", checkoutFunction],
  ["create-portal-session", portalFunction],
  ["delete-account", deleteFunction],
  ["export-account", exportFunction],
]) {
  if (!source.includes("consumeRateLimit") || !source.includes("rateLimitResponse")) {
    throw new Error(`${name} is not connected to server-side rate limiting`);
  }
}
for (const [name, source] of [
  ["analyze-career", analysisFunction],
  ["create-checkout-session", checkoutFunction],
  ["create-portal-session", portalFunction],
  ["delete-account", deleteFunction],
  ["export-account", exportFunction],
]) {
  if (!source.includes("handleCors") || !source.includes("../_shared/http.ts")) {
    throw new Error(`${name} is not using the shared origin allowlist`);
  }
}
if (!httpHelper.includes("ORIGIN_NOT_ALLOWED") || httpHelper.includes('"Access-Control-Allow-Origin": "*"')) {
  throw new Error("Shared Edge Function CORS must fail closed without wildcard origins");
}
if (!/enable_signup = false/.test(supabaseConfig)) {
  throw new Error("Local Supabase auth must model invite-only private beta access");
}
if (!app.includes("billingEnabled") || !app.includes("signupEnabled") || !app.includes("betaMode")) {
  throw new Error("Private-beta feature flags are missing from the browser application");
}
if (!app.includes('cloud.functions.invoke("export-account"') || !app.includes('cloud.from("beta_feedback").insert')) {
  throw new Error("Account export or private-beta feedback is not connected");
}
if (!deleteFunction.includes("recentlyIssued") || !app.includes("deleteAccountForm")) {
  throw new Error("Account deletion must require recent password confirmation");
}
if (!app.includes('cloud.from("document_chunks").delete()') || !app.includes('cloud.from("career_analyses").delete()')) {
  throw new Error("Clearing a workspace must remove retained RAG chunks and saved analyses");
}
if (!privacyNotice.includes("AI processing") || !betaTerms.includes("Private Beta Terms")) {
  throw new Error("Private-beta privacy and terms pages are missing");
}
if (/SERVICE_ROLE|SECRET_KEY/.test(app)) throw new Error("A server credential name appears in browser code");
if (!app.includes("if (config.localPreview) localStorage.setItem")) {
  throw new Error("Production browser persistence guard is missing");
}
if (!app.includes('authEvent === "TOKEN_REFRESHED" || authEvent === "USER_UPDATED"')) {
  throw new Error("Routine auth refreshes must not overwrite the loaded workspace");
}
if (!/await saveState\(\);[\s\S]*?cloud\.auth\.updateUser\(\{ data: \{ display_name: state\.profile\.displayName \} \}\)/.test(app)) {
  throw new Error("Onboarding must persist the workspace before updating auth metadata");
}
if (!app.includes("captchaToken: captchaTokens.signin") || !app.includes("captchaToken: captchaTokens.signup")) {
  throw new Error("Sign-in, password recovery and sign-up must pass Cloudflare Turnstile tokens to Supabase");
}
if (!html.includes("https://challenges.cloudflare.com/turnstile/") || !headers.includes("frame-src https://challenges.cloudflare.com")) {
  throw new Error("Cloudflare Turnstile script or CSP permissions are missing");
}

console.log(`Static contract verified: ${ids.length} unique elements and ${referenced.length} JavaScript bindings.`);
