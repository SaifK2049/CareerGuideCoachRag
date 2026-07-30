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
  phaseOneMigration,
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
  careerOperatingSystemMigration,
  careerIntelligenceFunction,
  careerIntelligenceService,
  careerPlanningFunction,
  careerPlanningService,
  institutionDashboardFunction,
  mentorNetworkFunction,
  mentorMatchingService,
  companyIntelligenceFunction,
  companyIntelligenceService,
  interviewVideoAssessFunction,
  portfolioIntelligenceFunction,
  portfolioIntelligenceService,
  escoImportScript,
  taxonomyRunbook,
  workforceIntelligenceService,
  labourMarketIngestFunction,
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
  readFile(resolve(root, "supabase/migrations/20260725114424_phase_one_productivity.sql"), "utf8"),
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
  readFile(resolve(root, "supabase/migrations/20260730112235_career_operating_system_foundation.sql"), "utf8"),
  readFile(resolve(root, "supabase/functions/career-intelligence/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/_shared/career-intelligence.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/career-planning/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/_shared/career-planning.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/institution-dashboard/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/mentor-network/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/_shared/mentor-matching.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/company-intelligence/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/_shared/company-intelligence.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/interview-video-assess/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/portfolio-intelligence/index.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/_shared/portfolio-intelligence.ts"), "utf8"),
  readFile(resolve(root, "scripts/import-esco-taxonomy.mjs"), "utf8"),
  readFile(resolve(root, "docs/public-taxonomy.md"), "utf8"),
  readFile(resolve(root, "supabase/functions/_shared/workforce-intelligence.ts"), "utf8"),
  readFile(resolve(root, "supabase/functions/labour-market-ingest/index.ts"), "utf8"),
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
for (const surface of ["reminderButton", "reminderModal", "reminderList", "jobImportPreview", "jobDuplicateWarning", "cvOcrReview"]) {
  if (!ids.includes(surface)) throw new Error(`Phase 1 surface is missing: ${surface}`);
}
for (const surface of ["interviewView", "interviewJobSelect", "generateInterviewButton", "interviewStage", "interviewBadgeList"]) {
  if (!ids.includes(surface)) throw new Error(`Interview preparation surface is missing: ${surface}`);
}
for (const surface of [
  "twinView", "refreshCareerTwinButton", "careerTwinSummary", "careerGraphCanvas",
  "careerGraphDetails", "careerRecommendationList"
]) {
  if (!ids.includes(surface)) throw new Error(`Career operating system surface is missing: ${surface}`);
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
for (const field of ["reminder_settings", "dismissed_reminders", "source_provider", "external_job_id", "employment_type", "work_arrangement", "salary_text", "normalized_source_url"]) {
  if (!phaseOneMigration.includes(field)) throw new Error(`Phase 1 database field is missing: ${field}`);
}
if (
  !phaseOneMigration.includes("grant select, insert, update on table public.career_profiles to authenticated") ||
  !phaseOneMigration.includes("job_descriptions_user_normalized_source_idx")
) {
  throw new Error("Phase 1 Data API grants or duplicate lookup index are missing");
}
if (!app.includes("renderApplicationCockpit") || !app.includes("data-application-stage") || !app.includes("updateApplicationStatus")) {
  throw new Error("Application cockpit rendering or pipeline interaction is missing");
}
if (
  !app.includes("window.Tesseract.createWorker") ||
  !app.includes("findDuplicateJob") ||
  !app.includes("renderReminders") ||
  !app.includes("OCR review required") ||
  !importJobFunction.includes("structuredJobPostings") ||
  !importJobFunction.includes("externalJobId")
) {
  throw new Error("OCR review, reminders, import preview, or duplicate detection is incomplete");
}
if (
  !html.includes("node_modules/tesseract.js/dist/tesseract.min.js") ||
  !buildScript.includes('const tesseractOutput = resolve(output, "vendor", "tesseract")') ||
  !buildScript.includes('"worker.min.js"') ||
  !headers.includes("'wasm-unsafe-eval'") ||
  !headers.includes("connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cdn.jsdelivr.net")
) {
  throw new Error("Browser OCR assets or CSP permissions are incomplete");
}
if (!app.includes("renderSetupChecklist") || !app.includes("data-empty-action")) {
  throw new Error("Guided checklist or actionable empty states are missing");
}
if (!app.includes('container.classList.toggle("hidden", isComplete)')) {
  throw new Error("Completed guided checklist must be hidden");
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
if (!/\[functions\.career-intelligence\][\s\S]*?verify_jwt = true/.test(supabaseConfig)) {
  throw new Error("Career intelligence Edge Function must require a user JWT");
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
  ["career-intelligence", careerIntelligenceFunction],
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
  ["career-intelligence", careerIntelligenceFunction],
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
for (const table of [
  "organizations", "organization_memberships", "organization_data_consents",
  "career_taxonomy_nodes", "career_taxonomy_edges", "career_graph_nodes",
  "career_graph_edges", "career_twins", "career_twin_snapshots",
  "career_recommendations", "labour_market_observations", "portfolio_assets",
  "mobility_destination_profiles",
  "career_credentials", "career_readiness_assessments", "career_simulations",
  "learning_roadmaps", "learning_roadmap_milestones", "organization_programmes",
  "organization_cohorts", "organization_cohort_members", "mentor_profiles",
  "mentor_matches", "mentorship_requests", "company_profiles",
  "company_intelligence_briefs", "interview_video_assessments"
]) {
  if (!careerOperatingSystemMigration.includes(`alter table public.${table} enable row level security`)) {
    throw new Error(`Career operating system table does not explicitly enable RLS: ${table}`);
  }
}
for (const relationship of [
  "requires", "supports", "validated_by", "demonstrated_by", "targets",
  "applied_to", "performed_in"
]) {
  if (!careerOperatingSystemMigration.includes(`'${relationship}'`)) {
    throw new Error(`Career knowledge graph relationship is missing: ${relationship}`);
  }
}
if (
  !careerOperatingSystemMigration.includes("private.organization_has_role") ||
  !careerOperatingSystemMigration.includes("'individual_guidance' = any(consent.scopes)") ||
  !careerOperatingSystemMigration.includes("sync_career_knowledge_graph") ||
  !careerOperatingSystemMigration.includes("get_career_operating_system_snapshot") ||
  !careerOperatingSystemMigration.includes("grant select, insert, update, delete on")
) {
  throw new Error("Multi-tenant graph access, consent boundaries, graph sync, or explicit Data API grants are incomplete");
}
if (
  !careerIntelligenceFunction.includes('"sync_career_knowledge_graph"') ||
  !careerIntelligenceFunction.includes("buildCareerIntelligence") ||
  !careerIntelligenceFunction.includes("career_twin_snapshots") ||
  !careerIntelligenceFunction.includes("career_recommendations") ||
  !careerIntelligenceService.includes("required_by_saved_jobs") ||
  !careerIntelligenceService.includes("supporting_strengths") ||
  !careerIntelligenceService.includes("analysis_citations") ||
  !careerIntelligenceService.includes("limitations")
) {
  throw new Error("Career Twin refresh or explainable recommendation evidence chain is incomplete");
}
if (
  !app.includes("careerTwinSourceSignature") ||
  !app.includes("scheduleCareerTwinRefresh") ||
  !app.includes("refreshCareerTwinInBackground") ||
  !app.includes("Updating from new evidence") ||
  !app.includes('button.dataset.view === "twin" && careerTwinRefreshPending')
) {
  throw new Error("Career Twin source-change detection or continuous background evolution is incomplete");
}
if (
  !app.includes('cloud.functions.invoke("career-intelligence"') ||
  !app.includes("renderCareerOperatingSystem") ||
  !app.includes("renderCareerGraph") ||
  !app.includes('"career_recommendations", "career_twin_snapshots", "career_twins"') ||
  !exportFunction.includes("career_graph_nodes") ||
  !exportFunction.includes("career_twin_snapshots") ||
  !exportFunction.includes("organization_data_consents")
) {
  throw new Error("Career operating system UI, clear-workspace behavior, or portable export is incomplete");
}
if (
  !supabaseConfig.includes("[functions.career-planning]") ||
  !careerPlanningFunction.includes("buildReadinessAssessment") ||
  !careerPlanningFunction.includes("buildSimulation") ||
  !careerPlanningFunction.includes("request_fingerprint") ||
  !careerPlanningService.includes("hiring_probability") ||
  !careerPlanningService.includes("personal_comparable_terminal_offer_rate_wilson_v1") ||
  !careerPlanningService.includes("minimum_sample_size: 20") ||
  !careerPlanningService.includes("scenario_adjustment_available: false") ||
  !careerPlanningService.includes("not an individual hiring decision") ||
  !careerPlanningService.includes("No sourced salary observation") ||
  !careerPlanningService.includes("cost_of_living") ||
  !careerPlanningService.includes("regional_comparisons") ||
  !careerPlanningService.includes("career_progression") ||
  !careerPlanningService.includes("skill_premium") ||
  !careerPlanningService.includes("certification_impact") ||
  !careerPlanningService.includes("causal: false") ||
  !careerPlanningService.includes("mobilityProjection") ||
  !careerPlanningService.includes("not legal advice") ||
  !careerPlanningFunction.includes("mobility_destination_profiles") ||
  !careerOperatingSystemMigration.includes("'DE', 'Germany', 'ألمانيا'") ||
  !careerOperatingSystemMigration.includes("'EG', 'Egypt', 'مصر'") ||
  !app.includes("mobilityProjectionMarkup") ||
  !app.includes("salaryIntelligenceMarkup") ||
  !app.includes("Historical outcome estimate") ||
  !app.includes("does not predict an employer decision") ||
  !app.includes("Observed differences do not establish causation") ||
  !app.includes("Official guidance · reviewed") ||
  !careerPlanningService.includes("verification_criteria") ||
  !careerPlanningService.includes("learningResources") ||
  !careerPlanningFunction.includes("resources: milestone.resources") ||
  !careerOperatingSystemMigration.includes("set_learning_milestone_status") ||
  !careerOperatingSystemMigration.includes("'progress_percent'") ||
  !careerOperatingSystemMigration.includes("'salary_projection'") ||
  !app.includes("roadmapManagementMarkup") ||
  !app.includes("roadmap-salary") ||
  !app.includes('cloud.rpc("set_learning_milestone_status"') ||
  !app.includes('cloud.functions.invoke("career-planning"') ||
  !html.includes('id="careerSimulationForm"') ||
  !exportFunction.includes("learning_roadmap_milestones") ||
  !app.includes('"learning_roadmap_milestones", "learning_roadmaps", "career_simulations"')
) {
  throw new Error("Career simulation, readiness, sourced-market safeguards, roadmap UI, export, or deletion support is incomplete");
}
if (
  !html.includes('id="labourMarketCountry"') ||
  !html.includes('id="labourMarketCity"') ||
  !html.includes('id="labourMarketIndustry"') ||
  !html.includes('id="labourMarketJobFamily"') ||
  !html.includes('id="labourMarketExperience"') ||
  !html.includes('id="labourMarketDashboard"') ||
  !app.includes("loadLabourMarketDashboard") ||
  !app.includes('cloud.from("labour_market_observations").select("*")') ||
  !app.includes("Orynta does not estimate market conditions without published evidence") ||
  !careerOperatingSystemMigration.includes("country_code, city, industry, job_family, experience_level, signal_type") ||
  !supabaseConfig.includes("[functions.labour-market-ingest]") ||
  !labourMarketIngestFunction.includes('app_metadata?.role !== "admin"') ||
  !labourMarketIngestFunction.includes('onConflict: "source_name,external_id"') ||
  !labourMarketIngestFunction.includes("observations.length > 500") ||
  !labourMarketIngestFunction.includes("validated-source-batch-v1")
) {
  throw new Error("Multidimensional sourced labour-market dashboard is incomplete");
}
if (
  !html.includes('id="applicationResponseRate"') ||
  !html.includes('id="applicationInterviewConversion"') ||
  !html.includes('id="applicationOfferConversion"') ||
  !html.includes('id="applicationVelocity"') ||
  !app.includes("renderApplicationIntelligence") ||
  !careerOperatingSystemMigration.includes("cv_version_label text not null") ||
  !app.includes("ensureJobCvVersionField") ||
  !app.includes("Best-performing CV version") ||
  !app.includes("cv_version_label: job.cvVersionLabel") ||
  !app.includes("Needs at least three dated applications on the same weekday")
) {
  throw new Error("Application conversion, velocity, timing, company, or attribution intelligence is incomplete");
}
if (
  !supabaseConfig.includes("[functions.institution-dashboard]") ||
  !institutionDashboardFunction.includes("get_organization_employability_dashboard") ||
  !careerOperatingSystemMigration.includes("v_minimum_group_size constant integer := 5") ||
  !careerOperatingSystemMigration.includes("'cohort_analytics' = any(consent.scopes)") ||
  !careerOperatingSystemMigration.includes("'programme_effectiveness'") ||
  !careerOperatingSystemMigration.includes("'placement_rate'") ||
  !html.includes('id="institutionDashboardContent"') ||
  !html.includes('id="institutionConsentList"') ||
  !app.includes("renderInstitutionDashboard") ||
  !app.includes('cloud.functions.invoke("institution-dashboard"') ||
  !app.includes('action: "my_consents"') ||
  !app.includes('action: "set_consent"') ||
  !institutionDashboardFunction.includes('"my_consents", "set_consent"') ||
  !institutionDashboardFunction.includes('.eq("user_id", userId)') ||
  !institutionDashboardFunction.includes("participant-controls-v1") ||
  !institutionDashboardFunction.includes("You are not a participant in this organization") ||
  !exportFunction.includes("organization_cohort_memberships")
) {
  throw new Error("Consent-aware university/government cohort analytics, privacy suppression, UI, or portability is incomplete");
}
if (
  !supabaseConfig.includes("[functions.mentor-network]") ||
  !mentorNetworkFunction.includes("buildMentorMatches") ||
  !mentorNetworkFunction.includes('"request"') ||
  !mentorNetworkFunction.includes('"profile"') ||
  !mentorNetworkFunction.includes("explicit-discovery-consent-v1") ||
  !mentorNetworkFunction.includes('.eq("status", "suggested")') ||
  !mentorMatchingService.includes("skill_gaps_supported") ||
  !mentorMatchingService.includes("location_alignment") ||
  !mentorMatchingService.includes("language_alignment") ||
  !mentorMatchingService.includes("relationship quality") ||
  !careerOperatingSystemMigration.includes("matching_consent_at") ||
  !html.includes('id="mentorMatchList"') ||
  !html.includes('id="mentorProfileForm"') ||
  !html.includes('id="mentorDiscoveryConsent"') ||
  !app.includes("renderMentorNetwork") ||
  !app.includes("renderMentorProfile") ||
  !app.includes("Your mentor profile is private and new suggestions were removed") ||
  !app.includes('cloud.functions.invoke("mentor-network"') ||
  !app.includes('"mentor_matches"') ||
  !exportFunction.includes("mentorship_requests")
) {
  throw new Error("Opt-in mentor discovery, explainable matching, introduction requests, portability, or derived-data deletion is incomplete");
}
if (
  !supabaseConfig.includes("[functions.company-intelligence]") ||
  !companyIntelligenceFunction.includes("buildCompanyBrief") ||
  !companyIntelligenceService.includes("recent_news") ||
  !companyIntelligenceService.includes("interview_expectations") ||
  !companyIntelligenceService.includes("competitors") ||
  !companyIntelligenceService.includes("source_freshness_at") ||
  !companyIntelligenceService.includes("No published company profile is available") ||
  !html.includes('id="generateCompanyBriefButton"') ||
  !app.includes("renderCompanyBrief") ||
  !app.includes('cloud.functions.invoke("company-intelligence"') ||
  !app.includes('"company_intelligence_briefs"') ||
  !exportFunction.includes("company_intelligence_briefs")
) {
  throw new Error("Source-aware company briefing, interview integration, unavailable-state handling, portability, or deletion is incomplete");
}
if (
  !supabaseConfig.includes("[functions.interview-video-assess]") ||
  !interviewVideoAssessFunction.includes("gaze_alignment") ||
  !interviewVideoAssessFunction.includes("posture_stability") ||
  !interviewVideoAssessFunction.includes("gesture_use") ||
  !interviewVideoAssessFunction.includes("confidence_presentation") ||
  !interviewVideoAssessFunction.includes("answer_structure") ||
  !interviewVideoAssessFunction.includes("technical_depth") ||
  !interviewVideoAssessFunction.toLowerCase().includes("do not perform facial recognition") ||
  !app.includes("startInterviewVideoRecording") ||
  !app.includes("The recording is not stored") ||
  !app.includes('cloud.functions.invoke("interview-video-assess"') ||
  !app.includes('"interview_video_assessments"') ||
  !interviewTranscribeFunction.includes('"video/webm"') ||
  !exportFunction.includes("interview_video_assessments")
) {
  throw new Error("Private video capture, transcript metrics, scoped visual coaching, safety boundaries, portability, or deletion is incomplete");
}
if (
  !supabaseConfig.includes("[functions.portfolio-intelligence]") ||
  !portfolioIntelligenceFunction.includes("analyse_portfolio") ||
  !portfolioIntelligenceFunction.includes("verify_credential") ||
  !portfolioIntelligenceFunction.includes("recipient_matches_authenticated_email") ||
  !portfolioIntelligenceFunction.includes("providerPolicies") ||
  !portfolioIntelligenceFunction.includes("official_provider_page_observation") ||
  !portfolioIntelligenceFunction.includes("credential-provider-verification-v2") ||
  !portfolioIntelligenceFunction.includes("stored_expiry_check") ||
  !portfolioIntelligenceFunction.includes("revoked") ||
  !portfolioIntelligenceService.includes("documentation") ||
  !portfolioIntelligenceService.includes("testing") ||
  !portfolioIntelligenceService.includes("ci_cd") ||
  !portfolioIntelligenceService.includes("architecture") ||
  !portfolioIntelligenceService.includes("code_organisation") ||
  !portfolioIntelligenceService.includes("technology_diversity") ||
  !portfolioIntelligenceService.includes("activity_consistency") ||
  !html.includes('id="portfolioAssetForm"') ||
  !html.includes('id="careerCredentialForm"') ||
  !app.includes('cloud.functions.invoke("portfolio-intelligence"') ||
  !app.includes('cloud.from("portfolio_assets").insert') ||
  !app.includes('cloud.from("career_credentials").insert')
) {
  throw new Error("Evidence-scoped portfolio analysis or conservative credential verification is incomplete");
}
for (const provider of ["credly", "microsoft_learn", "aws", "google_cloud", "cisco", "azure", "open_badges"]) {
  if (!careerOperatingSystemMigration.includes(`'${provider}'`) || !html.includes(`value="${provider}"`)) {
    throw new Error(`Certification provider integration is missing: ${provider}`);
  }
}
if (
  !careerOperatingSystemMigration.includes("'issuer_observed'") ||
  !app.includes("No expiry date recorded") ||
  !app.includes("Provider verification guidance")
) {
  throw new Error("Credential expiry tracking or conservative issuer-observation state is incomplete");
}
if (
  !careerIntelligenceFunction.includes('"career_taxonomy_nodes"') ||
  !careerIntelligenceFunction.includes('"labour_market_observations"') ||
  !careerIntelligenceFunction.includes('"portfolio_assets"') ||
  !careerIntelligenceFunction.includes('"career_credentials"') ||
  !careerIntelligenceFunction.includes('"company_profiles"') ||
  !careerIntelligenceService.includes("certifications_that_validate_it") ||
  !careerIntelligenceService.includes("related_taxonomy_skills") ||
  !careerIntelligenceService.includes("market_signals") ||
  !careerIntelligenceService.includes("portfolio_evidence") ||
  !careerIntelligenceService.includes("preferredIndustries") ||
  !careerIntelligenceService.includes('evidenceReference("portfolio_asset"') ||
  !careerIntelligenceService.includes('evidenceReference("career_credential"') ||
  !careerIntelligenceService.includes("estimated_match_score_delta") ||
  !careerIntelligenceService.includes("calibrated_hiring_probability: false") ||
  !escoImportScript.includes('taxonomy: "esco"') ||
  !escoImportScript.includes("/occupation.*skill.*relation") ||
  !escoImportScript.includes('onConflict: "taxonomy,external_id"') ||
  !taxonomyRunbook.includes("--dry-run") ||
  !taxonomyRunbook.includes("career_taxonomy_node")
) {
  throw new Error("Unified recommendation evidence or versioned public ESCO taxonomy ingestion is incomplete");
}
if (
  !institutionDashboardFunction.includes("buildGovernmentWorkforceDashboard") ||
  !institutionDashboardFunction.includes('"government"') ||
  !institutionDashboardFunction.includes('"labour_market_observations"') ||
  !institutionDashboardFunction.includes("organization_programmes") ||
  !workforceIntelligenceService.includes("regional_skill_shortages") ||
  !workforceIntelligenceService.includes("workforce_trends") ||
  !workforceIntelligenceService.includes("skills_forecasting") ||
  !workforceIntelligenceService.includes("programme_completion") ||
  !workforceIntelligenceService.includes("not a predictive forecast") ||
  !app.includes("governmentWorkforceMarkup") ||
  !app.includes("Government workforce intelligence")
) {
  throw new Error("Government workforce trends, shortage signals, programme reporting, privacy handling, or sourced trajectories are incomplete");
}
if (
  !careerOperatingSystemMigration.includes("'github_repository'") ||
  !careerOperatingSystemMigration.includes("'portfolio:' || asset.id::text") ||
  !careerOperatingSystemMigration.includes("'project:portfolio:' || asset.id::text") ||
  !careerOperatingSystemMigration.includes("This project is demonstrated by its linked public GitHub repository") ||
  !careerOperatingSystemMigration.includes("'credential:' || credential.id::text") ||
  !careerOperatingSystemMigration.includes("'technology:' || lower") ||
  !careerOperatingSystemMigration.includes("'course:' || md5") ||
  !careerOperatingSystemMigration.includes("'learning_roadmap_milestone'") ||
  !careerOperatingSystemMigration.includes("This roadmap course supports the user’s stated career goal") ||
  !careerOperatingSystemMigration.includes("'analysis_confidence'") ||
  !careerOperatingSystemMigration.includes("taxonomy_node_id = taxonomy.taxonomy_id") ||
  !careerOperatingSystemMigration.includes("'validated_by'") ||
  !careerOperatingSystemMigration.includes("'demonstrated_by'") ||
  !app.includes("skillGraphExpandedMarkup") ||
  !app.includes("loadSkillGraphDetail") ||
  !app.includes("Parent skills") ||
  !app.includes("Child skills") ||
  !app.includes("Learning resources") ||
  !app.includes("Saved jobs requiring it") ||
  !app.includes("User evidence") ||
  !app.includes("AI confidence")
) {
  throw new Error("Skill graph taxonomy, market, hierarchy, resources, credentials, projects, jobs, evidence, or confidence detail is incomplete");
}
if (
  !html.includes('id="careerGuidanceLocale"') ||
  !html.includes('id="profileGuidanceLocale"') ||
  !careerOperatingSystemMigration.includes("guidance_locale text not null default 'en'") ||
  !careerOperatingSystemMigration.includes("trajectory_ar text not null") ||
  !careerOperatingSystemMigration.includes("summary_ar text not null") ||
  !careerOperatingSystemMigration.includes("title_ar text not null") ||
  !careerOperatingSystemMigration.includes("verification_criteria_ar text not null") ||
  !careerPlanningService.includes("limitations_ar") ||
  !careerPlanningService.includes("title_ar: `ابنِ الأساسيات") ||
  !careerPlanningFunction.includes("goal_ar:") ||
  !app.includes("مخطط التنقل المهني") ||
  !app.includes("خارطة التعلم الشخصية") ||
  !app.includes("verification_criteria_ar") ||
  !app.includes('result.setAttribute("dir", arabic ? "rtl" : "ltr")')
) {
  throw new Error("Bilingual Career Twin, recommendation, mobility, simulation, and roadmap guidance is incomplete");
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
