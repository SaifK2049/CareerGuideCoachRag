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
  waitlistMigration,
  waitlistFunction,
  productMigration,
  cockpitMigration,
  interviewMigration,
  interviewAssessmentMigration,
  cvGuidanceFunction,
  interviewFunction,
  interviewTranscribeFunction,
  importJobFunction,
  sharedReportFunction,
  reportPage,
  reportScript,
  adminPage,
  adminScript,
  adminStyles,
  adminMigration,
  adminWaitlistMigration,
  adminFunction,
  telemetryHelper,
  redirects,
  buildScript,
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
  readFile(resolve(root, "supabase/migrations/20260718223523_public_waitlist.sql"), "utf8"),
  readFile(resolve(root, "supabase/functions/join-waitlist/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/migrations/20260718225738_product_workflows.sql"), "utf8"),
  readFile(resolve(root, "supabase/migrations/20260720174347_application_cockpit.sql"), "utf8"),
  readFile(resolve(root, "supabase/migrations/20260720193851_interview_preparation_gamification.sql"), "utf8"),
  readFile(resolve(root, "supabase/migrations/20260720203957_interview_assessment_voice.sql"), "utf8"),
  readFile(resolve(root, "supabase/functions/cv-guidance/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/interview-prep/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/interview-transcribe/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/import-job/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/shared-report/index.ts"), "utf8"),
  readFile(resolve(root, "report.html"), "utf8"),
  readFile(resolve(root, "report.js"), "utf8"),
  readFile(resolve(root, "admin.html"), "utf8"),
  readFile(resolve(root, "admin.js"), "utf8"),
  readFile(resolve(root, "admin.css"), "utf8"),
  readFile(resolve(root, "supabase/migrations/20260722130434_admin_analytics_telemetry.sql"), "utf8"),
  readFile(resolve(root, "supabase/migrations/20260722152159_admin_waitlist_invites.sql"), "utf8"),
  readFile(resolve(root, "supabase/functions/admin-analytics/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/_shared/telemetry.ts"), "utf8"),
  readFile(resolve(root, "_redirects"), "utf8"),
  readFile(resolve(root, "scripts/build.mjs"), "utf8"),
]);

for (const surface of ["adminAuth", "adminDenied", "adminShell", "overviewView", "usersView", "waitlistView", "feedbackView", "systemView"]) {
  if (!adminPage.includes(`id="${surface}"`)) throw new Error(`Admin surface is missing: ${surface}`);
}
for (const operation of ["overview", "users", "waitlist", "invite", "feedback", "system", "export"]) {
  if (!adminFunction.includes(`"${operation}"`)) throw new Error(`Admin analytics operation is missing: ${operation}`);
}
if (!adminFunction.includes('app_metadata?.role !== "admin"') || !adminFunction.includes("auth.getUser(token)")) {
  throw new Error("Admin analytics must verify the current Auth user and protected app metadata");
}
if (!adminFunction.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")') || adminScript.includes("SERVICE_ROLE")) {
  throw new Error("Elevated analytics access must remain server-side");
}
for (const table of ["product_events", "operational_events"]) {
  if (!adminMigration.includes(`alter table public.${table} enable row level security`)) throw new Error(`${table} must enable RLS`);
}
if (!adminMigration.includes("orynta-prune-analytics") || !adminMigration.includes("interval '13 months'")) {
  throw new Error("Analytics retention job is missing");
}
if (!adminMigration.includes("revoke all on function public.admin_analytics_overview") || !adminMigration.includes("to service_role")) {
  throw new Error("Admin aggregate functions must be service-role-only");
}
if (!adminWaitlistMigration.includes("admin_claim_waitlist_invite") || !adminWaitlistMigration.includes("revoke all on function public.admin_analytics_waitlist") || !adminFunction.includes("inviteUserByEmail")) {
  throw new Error("Admin waitlist invitations must be claimed atomically and sent only by the protected Edge Function");
}
if (!telemetryHelper.includes("operational_events") || !telemetryHelper.includes("try") || !app.includes("record_product_event")) {
  throw new Error("Fail-open product and operational telemetry is incomplete");
}
if (!redirects.includes("/admin /admin.html 200") || !buildScript.includes('"admin.html"') || !buildScript.includes('"admin.js"')) {
  throw new Error("Admin route or production build assets are missing");
}
if (!/\[functions\.admin-analytics\][\s\S]*?verify_jwt = true/.test(supabaseConfig)) {
  throw new Error("Admin analytics Edge Function must require a JWT");
}
if (!adminStyles.includes(".table-wrap") || !adminScript.includes("renderChart")) {
  throw new Error("Admin responsive tables or data-driven chart are missing");
}
const adminIds = [...adminPage.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const adminReferences = [...adminScript.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const missingAdminIds = [...new Set(adminReferences.filter((id) => !adminIds.includes(id)))];
if (missingAdminIds.length) throw new Error(`Admin JavaScript references missing HTML ids: ${missingAdminIds.join(", ")}`);

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`Duplicate HTML ids: ${[...new Set(duplicates)].join(", ")}`);

const referenced = [...app.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const missing = [...new Set(referenced.filter((id) => !ids.includes(id)))];
if (missing.length) throw new Error(`JavaScript references missing HTML ids: ${missing.join(", ")}`);

for (const required of ["authGate", "onboardingGate", "appShell", "membershipActionButton", "profileForm", "signinTurnstile", "signupTurnstile", "signupForm", "feedbackForm", "deleteAccountForm", "betaConsentForm"]) {
  if (!ids.includes(required)) throw new Error(`Required production surface is missing: ${required}`);
}
for (const required of ["resetPasswordModal", "resetPasswordDescription", "resetPasswordSubmit"]) {
  if (!ids.includes(required)) throw new Error(`Invitation password setup surface is missing: ${required}`);
}
if (!app.includes('initialAuthLinkType === "invite"') || !app.includes('openPasswordSetup("invite")')) {
  throw new Error("Accepted invitations must require password creation");
}
if (!ids.includes("analysisStatus") || !app.includes("data-finding-feedback") || !app.includes("data-add-finding-evidence")) {
  throw new Error("Interactive analysis status or finding feedback controls are missing");
}
for (const surface of ["setupChecklist", "nextActionPanel", "readinessExplainer", "latestAnalysisStat"]) {
  if (!ids.includes(surface)) throw new Error(`Guided dashboard surface is missing: ${surface}`);
}
for (const surface of ["planView", "progressView", "actionPlanList", "analysisHistory", "cvGuidanceResult", "sharedReportList"]) {
  if (!ids.includes(surface)) throw new Error(`Product workflow surface is missing: ${surface}`);
}
for (const surface of ["applicationsView", "applicationTodayList", "applicationPathFilter", "applicationSearch", "applicationKanban"]) {
  if (!ids.includes(surface)) throw new Error(`Application cockpit surface is missing: ${surface}`);
}
for (const surface of ["interviewView", "interviewJobSelect", "generateInterviewButton", "interviewStage", "interviewBadgeList"]) {
  if (!ids.includes(surface)) throw new Error(`Interview preparation surface is missing: ${surface}`);
}
for (const surface of ["membershipPlanModal", "currentPlanName", "currentPlanPrice", "currentPlanFeatures", "premiumPlanFeatures", "membershipPlanNote"]) {
  if (!ids.includes(surface)) throw new Error(`Membership comparison surface is missing: ${surface}`);
}
if (!app.includes("renderMembershipComparison") || !app.includes('openModal("membershipPlanModal")') || !html.includes("€9.99") || !html.includes("No payment will be requested")) {
  throw new Error("Profile membership comparison or no-payment state is incomplete");
}
if (!app.includes("if (currentPlanPrice) currentPlanPrice.innerHTML") || !app.includes("if (!modal) return false")) {
  throw new Error("Membership comparison must tolerate mixed cached HTML and JavaScript versions");
}
for (const field of ["next_action", "follow_up_date", "interview_at", "contact_name", "contact_email"]) {
  if (!cockpitMigration.includes(`add column ${field}`)) throw new Error(`Application cockpit field is missing: ${field}`);
}
for (const indexName of ["job_descriptions_user_status_follow_up_idx", "job_descriptions_user_interview_idx"]) {
  if (!cockpitMigration.includes(indexName)) throw new Error(`Application cockpit index is missing: ${indexName}`);
}
if (!app.includes("renderApplicationCockpit") || !app.includes("data-application-stage") || !app.includes("updateApplicationStatus")) {
  throw new Error("Application cockpit rendering or pipeline interaction is missing");
}
if (!app.includes("renderSetupChecklist") || !app.includes("data-empty-action")) {
  throw new Error("Guided checklist or actionable empty states are missing");
}
for (const header of ["Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options"]) {
  if (!headers.includes(header)) throw new Error(`Required Cloudflare header is missing: ${header}`);
}
if (!/\/\*\.js\s+Cache-Control: no-cache, must-revalidate/.test(headers) || !/\/index\.html\s+Cache-Control: no-cache, must-revalidate/.test(headers)) {
  throw new Error("HTML and JavaScript must revalidate to prevent mixed deployment versions");
}
if (!/\/admin\.html\s+Cache-Control: no-cache, must-revalidate/.test(headers)) {
  throw new Error("Admin HTML must revalidate to prevent mixed deployment versions");
}
if (!headers.includes("microphone=(self)")) {
  throw new Error("Premium microphone practice must allow same-origin browser recording");
}
if (!/\[functions\.stripe-webhook\][\s\S]*?verify_jwt = false/.test(supabaseConfig)) {
  throw new Error("Stripe webhook must be public at the gateway so Stripe can reach signature verification");
}
for (const functionName of ["analyze-career", "create-checkout-session", "create-portal-session", "delete-account", "export-account"]) {
  const pattern = new RegExp(`\\[functions\\.${functionName}\\][\\s\\S]*?verify_jwt = true`);
  if (!pattern.test(supabaseConfig)) throw new Error(`${functionName} must require a user JWT`);
}
for (const functionName of ["cv-guidance", "import-job", "interview-prep", "interview-transcribe"]) {
  const pattern = new RegExp(`\\[functions\\.${functionName}\\][\\s\\S]*?verify_jwt = true`);
  if (!pattern.test(supabaseConfig)) throw new Error(`${functionName} must require a user JWT`);
}
if (!/\[functions\.shared-report\][\s\S]*?verify_jwt = false/.test(supabaseConfig)) {
  throw new Error("Shared reports must perform token authentication inside the function");
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
  ["cv-guidance", cvGuidanceFunction],
  ["import-job", importJobFunction],
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
  ["cv-guidance", cvGuidanceFunction],
  ["import-job", importJobFunction],
  ["shared-report", sharedReportFunction],
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
if (!app.includes('cloud.functions.invoke("join-waitlist"') || !html.includes("Join the Orynta waitlist")) {
  throw new Error("Public waitlist signup flow is missing");
}
if (
  !waitlistMigration.includes("alter table public.waitlist_signups enable row level security") ||
  !waitlistMigration.includes("revoke all on table public.waitlist_signups from anon, authenticated") ||
  !waitlistFunction.includes("challenges.cloudflare.com/turnstile/v0/siteverify") ||
  !waitlistFunction.includes('Deno.env.get("TURNSTILE_SECRET_KEY")')
) {
  throw new Error("Waitlist storage must remain private and Turnstile-verified");
}
for (const table of ["action_plan_items", "analysis_evidence_links", "cv_guidance", "shared_reports"]) {
  if (!productMigration.includes(`alter table public.${table} enable row level security`)) {
    throw new Error(`Product workflow table does not enable RLS: ${table}`);
  }
}
for (const table of ["interview_practice_sessions", "interview_practice_answers", "interview_game_profiles"]) {
  if (!interviewMigration.includes(`alter table public.${table} enable row level security`)) {
    throw new Error(`Interview preparation table does not enable RLS: ${table}`);
  }
}
for (const indexName of ["interview_sessions_path_owner_idx", "interview_sessions_job_owner_idx", "interview_answers_session_owner_idx"]) {
  if (!interviewMigration.includes(indexName)) throw new Error(`Interview foreign key index is missing: ${indexName}`);
}
if (
  !interviewMigration.includes("record_interview_answer_internal") ||
  !interviewMigration.includes("refund_interview_prep") ||
  !interviewMigration.includes("v_completion_xp := 50") ||
  !interviewMigration.includes("current_streak") ||
  !interviewFunction.includes("json_schema") ||
  !interviewFunction.includes('userClient.rpc("reserve_interview_prep"') ||
  !interviewFunction.includes('admin.rpc("refund_interview_prep"') ||
  !interviewFunction.includes("consumeRateLimit") ||
  !interviewFunction.includes("handleCors") ||
  !app.includes("renderInterviewPractice") ||
  !app.includes('cloud.rpc("record_interview_answer"')
) {
  throw new Error("Secure interview preparation and gamification flow is incomplete");
}
if (
  !interviewAssessmentMigration.includes("reserve_interview_assessment_internal") ||
  !interviewAssessmentMigration.includes("complete_interview_assessment") ||
  !interviewAssessmentMigration.includes("invalidate_interview_assessment") ||
  !interviewAssessmentMigration.includes("'premium', 'interview_voice', true") ||
  !interviewFunction.includes('action === "assess"') ||
  !interviewFunction.includes("practice-quality score") ||
  !interviewTranscribeFunction.includes("gpt-4o-mini-transcribe") ||
  !interviewTranscribeFunction.includes("PREMIUM_REQUIRED") ||
  !interviewTranscribeFunction.includes("consumeRateLimit") ||
  !interviewTranscribeFunction.includes("handleCors") ||
  !app.includes("interviewAssessmentMarkup") ||
  !app.includes("navigator.mediaDevices.getUserMedia") ||
  !app.includes("Audio is transcribed and not stored")
) {
  throw new Error("Six-answer assessment or Premium microphone practice is incomplete");
}
if (
  !cvGuidanceFunction.includes("Never invent experience") ||
  !cvGuidanceFunction.includes("json_schema") ||
  !cvGuidanceFunction.includes("AI_NOT_CONFIGURED") ||
  !importJobFunction.includes("approvedHosts") ||
  !importJobFunction.includes('redirect: "error"') ||
  !importJobFunction.includes("AI_NOT_CONFIGURED") ||
  !sharedReportFunction.includes("token_hash") ||
  !sharedReportFunction.includes("sha256(rawToken)") ||
  !reportPage.includes("report.js") ||
  !reportScript.includes('functions.invoke("shared-report"') ||
  !reportScript.includes('history.replaceState({}, "", window.location.pathname)')
) {
  throw new Error("CV guidance, safe job import, or privacy-safe report sharing is incomplete");
}
for (const indexName of [
  "action_plan_items_path_owner_idx",
  "action_plan_items_analysis_owner_idx",
  "action_plan_items_evidence_owner_idx",
  "cv_guidance_path_owner_idx",
  "cv_guidance_job_owner_idx",
  "shared_reports_path_owner_idx",
  "shared_reports_analysis_owner_idx",
]) {
  if (!productMigration.includes(indexName)) throw new Error(`Product workflow foreign key index is missing: ${indexName}`);
}
if (!productMigration.includes("expires_at <= created_at + interval '30 days'")) {
  throw new Error("Shared report expiry must be bounded by the database");
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
if (
  !app.includes("ensureStarterActionAfterCv") ||
  !app.includes("CV saved and your first action plan was created") ||
  !app.includes('.eq("user_id", session.user.id).eq("path_id", path.id).limit(1)') ||
  (app.match(/await ensureStarterActionAfterCv\(\)/g) || []).length < 3
) {
  throw new Error("Saving a first CV must create one idempotent starter action for the active path");
}
if (
  !app.includes("ensureActionAfterAnalysis") ||
  !app.includes("ensureLatestAnalysisAction") ||
  !app.includes('.eq("user_id", session.user.id).eq("analysis_id", analysis.id).limit(1)') ||
  !app.includes("Cited analysis saved and 1 action was added to your plan") ||
  !app.includes("finding_index: prioritized.index")
) {
  throw new Error("A successful cited analysis must create one deduplicated action from its highest-priority finding");
}
if (!privacyNotice.includes("AI processing") || !privacyNotice.includes("does not store the audio file") || !betaTerms.includes("Private Beta Terms")) {
  throw new Error("Private-beta privacy and terms pages are missing");
}
if (/SERVICE_ROLE|SECRET_KEY/.test(app)) throw new Error("A server credential name appears in browser code");
if (!app.includes("if (config.localPreview) localStorage.setItem")) {
  throw new Error("Production browser persistence guard is missing");
}
if (!app.includes('authEvent === "TOKEN_REFRESHED" || authEvent === "USER_UPDATED"')) {
  throw new Error("Routine auth refreshes must not overwrite the loaded workspace");
}
if (!app.includes('"x-request-id": requestId') || !app.includes("Support ID: ")) {
  throw new Error("Analysis failures must expose a privacy-safe monitoring reference");
}
if (!analysisFunction.includes('"analysis_started"') || !analysisFunction.includes('"analysis_failed"')) {
  throw new Error("Analysis Edge Function structured monitoring events are missing");
}
if (!/await saveState\(\);[\s\S]*?cloud\.auth\.updateUser\(\{ data: \{ display_name: state\.profile\.displayName \} \}\)/.test(app)) {
  throw new Error("Onboarding must persist the workspace before updating auth metadata");
}
if (!app.includes("captchaToken: captchaTokens.signin") || !app.includes("turnstileToken: captchaTokens.signup")) {
  throw new Error("Sign-in, password recovery and waitlist signup must pass Cloudflare Turnstile tokens");
}
if (!html.includes("https://challenges.cloudflare.com/turnstile/") || !headers.includes("frame-src https://challenges.cloudflare.com")) {
  throw new Error("Cloudflare Turnstile script or CSP permissions are missing");
}

console.log(`Static contract verified: ${ids.length} unique elements and ${referenced.length} JavaScript bindings.`);
