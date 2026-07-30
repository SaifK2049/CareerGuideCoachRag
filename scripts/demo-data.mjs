import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEMO_EMAIL = "demo@orynta.local";
export const DEMO_PASSWORD = "OryntaDemo2026!";
const root = resolve(import.meta.dirname, "..");
const uuid = (suffix) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const instant = (offset, hour = 10) => `${day(offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`;

function localStatus() {
  const output = execFileSync("npx", ["supabase", "status", "-o", "json"], {
    cwd: root,
    encoding: "utf8",
  });
  const status = JSON.parse(output.slice(output.indexOf("{")));
  const api = new URL(status.API_URL);
  if (!["127.0.0.1", "localhost", "::1"].includes(api.hostname)) {
    throw new Error(`Refusing to seed a non-local Supabase URL: ${api.origin}`);
  }
  return status;
}

async function request(status, path, options = {}) {
  const response = await fetch(status.API_URL + path, {
    method: options.method || "GET",
    headers: {
      apikey: status.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function insert(status, table, rows) {
  if (!rows.length) return;
  await request(status, `/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: rows,
  });
}

function questions(role) {
  return [
    {
      category: "Behavioral", difficulty: "starter",
      question: "Tell me about a time you improved a backend service that users depended on.",
      why_it_matters: "Shows ownership, prioritisation, and measurable delivery.",
      answer_framework: "Use STAR: situation, the reliability risk, your specific action, and the measured result.",
      evidence_prompts: ["Mention the latency reduction from 420 ms to 170 ms.", "Separate your contribution from the team result."],
      evidence_labels: ["CV2", "K1"],
    },
    {
      category: "Technical", difficulty: "stretch",
      question: `How would you design and operate a reliable API platform for ${role}?`,
      why_it_matters: "Tests API design, data choices, deployment, and operational judgement.",
      answer_framework: "Clarify requirements, sketch boundaries and data flow, then cover failure modes, observability, security, and rollout.",
      evidence_prompts: ["Use the FastAPI/PostgreSQL service as evidence.", "Explain one trade-off rather than listing tools."],
      evidence_labels: ["CV1", "J1"],
    },
    {
      category: "Role-specific", difficulty: "challenge",
      question: "A Kubernetes rollout increases error rates while dashboards remain green. What do you do?",
      why_it_matters: "Reveals incident response, observability depth, and safe delivery habits.",
      answer_framework: "Stabilise first, verify user impact, compare golden signals, inspect rollout/version data, then improve detection.",
      evidence_prompts: ["Be honest that Kubernetes ownership is partial.", "Connect Docker and CI/CD experience to the investigation."],
      evidence_labels: ["K7", "K8", "J2"],
    },
    {
      category: "CV-specific", difficulty: "stretch",
      question: "Your CV says you cut deployment time by 60%. What changed and how was that measured?",
      why_it_matters: "Validates a prominent quantified achievement.",
      answer_framework: "Define the original baseline, bottleneck, automation change, measurement window, and resulting team behaviour.",
      evidence_prompts: ["Name the GitHub Actions pipeline stages.", "Explain how rollback safety was preserved."],
      evidence_labels: ["CV3"],
    },
    {
      category: "Behavioral", difficulty: "stretch",
      question: "Describe a mentoring moment where your first approach did not work.",
      why_it_matters: "Tests reflection, adaptability, and people impact.",
      answer_framework: "Describe the learner's need, your initial assumption, the signal it failed, the adjustment, and the result.",
      evidence_prompts: ["Use the onboarding programme for four engineers.", "Keep the story focused on the other person's outcome."],
      evidence_labels: ["CV4", "K6"],
    },
    {
      category: "Technical", difficulty: "challenge",
      question: "How would you migrate a PostgreSQL-backed service to Azure without a risky big-bang release?",
      why_it_matters: "Tests cloud migration planning and exposes the Azure evidence gap constructively.",
      answer_framework: "Cover inventory, target architecture, data migration, dual-running, observability, security, rollback, and staged cutover.",
      evidence_prompts: ["Distinguish proven PostgreSQL skills from learning-stage Azure skills.", "State what you would validate with a platform specialist."],
      evidence_labels: ["K3", "K9", "J3"],
    },
  ];
}

function answers(sessionId, strong = true) {
  const text = [
    "At Linden Labs our billing API had p95 latency of 420 ms during peak traffic. I profiled slow queries, added two targeted PostgreSQL indexes, removed an N+1 call, and introduced a cache with explicit invalidation. I rolled it out behind a flag and watched error and latency dashboards. P95 fell to 170 ms and support tickets dropped by 28%. I documented the query-review checklist so the improvement continued after the project.",
    "I start with traffic, availability, data consistency, and recovery objectives. I would keep API boundaries small, use FastAPI services only where independent scaling or ownership warrants it, and keep PostgreSQL as the source of truth. Containers move through tested CI/CD stages, with health checks, canary rollout, structured logs, traces, SLOs, and rollback. I would explicitly test dependency failure and degraded modes.",
    "I would pause or roll back the rollout before deep investigation. Then I would compare version-level request metrics, logs, traces, Kubernetes events, probes, and downstream latency. Green dashboards suggest missing service-level or version dimensions, so after stabilising I would add release annotations and an error-budget alert. I have supported Kubernetes deployments but would involve the cluster owner for control-plane concerns.",
    "The baseline was a 25-minute manual release with inconsistent checks. I built GitHub Actions stages for tests, image scanning, image publishing, migration validation, and gated deployment. A scripted rollback used the last known-good image. Across 20 releases the median time fell to 10 minutes, a 60% reduction, with no increase in change failure rate.",
    "I initially gave a new engineer a dense architecture walkthrough, but their first task still stalled. I asked where the model broke down and learned they needed a concrete request path. I switched to pairing on one API trace, then had them teach it back and update the runbook. They delivered independently the next week, and that sequence became part of onboarding for four engineers.",
    "I would inventory dependencies and define SLO and RPO/RTO targets, then provision Azure infrastructure through reviewed templates. I would rehearse PostgreSQL replication and restore, deploy the application dark, mirror safe traffic, compare outputs, and progressively shift reads then writes with rollback gates. My Azure work is lab-based, so identity, networking, and managed-database choices would receive an architecture review.",
  ];
  return text.map((answer_text, index) => ({
    id: uuid((strong ? 500 : 510) + index),
    session_id: sessionId,
    question_index: index,
    answer_text,
    self_rating: strong ? (index % 3) + 3 : (index % 2) + 2,
    earned_xp: strong ? 15 : 10,
    created_at: instant(strong ? -4 : -24, 14 + index),
    updated_at: instant(strong ? -4 : -24, 14 + index),
  }));
}

export async function seedDemo() {
  const status = localStatus();
  const users = await request(status, "/auth/v1/admin/users?page=1&per_page=1000");
  const previous = (users.users || []).find((user) => user.email === DEMO_EMAIL);
  if (previous) await request(status, `/auth/v1/admin/users/${previous.id}`, { method: "DELETE" });
  const user = await request(status, "/auth/v1/admin/users", {
    method: "POST",
    body: {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "User Demo" },
      app_metadata: { local_demo: true },
    },
  });
  const userId = user.id;
  const pathSoftware = uuid(1);
  const pathCloud = uuid(2);
  const pathBackend = uuid(3);
  const paths = [
    { id: pathSoftware, user_id: userId, name: "Software Engineer", target: "Software Engineer", description: "82% match · strong API, Python, SQL, Git, and delivery evidence; biggest gaps are frontend breadth and system-design examples.", created_at: instant(-80), updated_at: instant(-2) },
    { id: pathCloud, user_id: userId, name: "Cloud Platform Engineer", target: "Cloud Platform Engineer", description: "68% match · strong containers and CI/CD, partial Kubernetes and observability, with Azure as the highest-priority gap.", created_at: instant(-75), updated_at: instant(-1) },
    { id: pathBackend, user_id: userId, name: "Senior Backend Engineer", target: "Senior Backend Engineer", description: "88% match · strongest fit from six years of backend delivery, API performance, PostgreSQL, mentoring, and measurable reliability work.", created_at: instant(-70), updated_at: instant(0) },
  ];
  await insert(status, "career_paths", paths);

  const cvText = `USER DEMO — SYNTHETIC CV
Berlin, Germany · demo@orynta.local · Hybrid product-company roles

SUMMARY
Senior Backend Developer with 6 years of synthetic experience building reliable APIs and cloud-ready delivery systems. Targeting Software Engineering and Cloud Platform Engineering roles.

LINDEN LABS — Senior Backend Developer — Berlin — 2023–Present [CV1–CV4]
• Built Python and FastAPI services backed by PostgreSQL; reduced p95 API latency from 420 ms to 170 ms through query tuning and caching [CV1, CV2].
• Created Docker-based GitHub Actions CI/CD pipelines; cut median deployment time from 25 to 10 minutes (60%) while preserving rollback controls [CV3].
• Mentored four engineers through pairing, API tracing, and maintained onboarding runbooks [CV4].
• Supported microservice boundary reviews, Kubernetes rollouts, Azure migration discovery, and incident observability; contributed but did not own the platforms [CV5].

HARBOR COMMERCE — Backend Developer — Remote EU — 2020–2023 [CV6–CV8]
• Designed versioned REST APIs and PostgreSQL schemas for order workflows processing 1.2M synthetic transactions per month [CV6].
• Introduced pytest integration suites and Git review rules, reducing escaped defects by 32% [CV7].
• Facilitated sprint planning and retrospectives for two quarters; delivery evidence is partial rather than formal Scrum leadership [CV8].

NORTHWIND STUDIO — Junior Software Developer — Berlin — 2019–2020 [CV9]
• Shipped internal Python automation and maintained Linux services, Git repositories, and SQL reports [CV9].

PROJECTS
Cloud Lab Portfolio [P1]: Deployed a containerised FastAPI service to a local Kubernetes cluster with Helm, Prometheus metrics, Grafana dashboards, and an Azure architecture decision record.
Event Processing Prototype [P2]: Modelled an idempotent job worker with PostgreSQL outbox records and retry/dead-letter behaviour.

EDUCATION
B.Sc. Computer Science, Synthetic Technical University, 2019.

SKILLS
Strong: Python, FastAPI, REST APIs, PostgreSQL, SQL, Git, Docker, CI/CD, mentoring.
Partial: Microservices, Kubernetes, Azure, observability, Agile delivery.
Learning: Terraform, cloud networking, production cluster operations.

All organisations, achievements, projects, and citations in this CV are synthetic and intended only for local product demonstration.`;

  await request(status, `/rest/v1/career_profiles?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: {
    user_id: userId,
    active_path_id: pathCloud,
    cv_file_name: "user-demo-synthetic-cv.pdf",
    cv_text: cvText,
    cv_uploaded_at: instant(-5),
    display_name: "User Demo",
    career_goal: "Software Engineer / Cloud Platform Engineering · hybrid product companies · cloud/backend focus",
    experience_level: "senior",
    country: "Berlin, Germany",
    onboarding_complete: true,
    beta_terms_accepted_at: instant(-60),
    privacy_notice_version: "2026-07-22",
    reminder_settings: { closing_days: 7, follow_up_days: 0, interview_hours: 48, include_plan_items: true },
    dismissed_reminders: {},
    },
  });

  const jobs = [
    [101, pathCloud, "Cloud Platform Engineer", "Atlas Forge", "Berlin · Hybrid", "saved", 8, null, 5, null, "Tailor the Azure migration example and apply", "€78,000–€92,000", "Own Azure platform services, Kubernetes, Terraform, CI/CD, Docker, observability, Python automation, networking, and developer enablement."],
    [102, pathBackend, "Senior Backend Engineer", "Juniper Market", "Berlin · Hybrid", "applied", 14, -6, 2, null, "Send portfolio API architecture note", "€82,000–€96,000", "Build Python FastAPI microservices and PostgreSQL APIs. Lead design reviews, mentor engineers, improve observability, and deliver through Git-based CI/CD."],
    [103, pathCloud, "Platform Reliability Engineer", "Kiteworks Labs", "Remote · Germany", "interviewing", 10, -12, 1, 2, "Rehearse incident-response STAR story", "€80,000–€95,000", "Operate Kubernetes services, Docker delivery, Prometheus and Grafana observability, incident response, SLOs, Python automation, and cloud networking."],
    [104, pathSoftware, "Software Engineer, Developer Platform", "Birch Product Co.", "Berlin · Hybrid", "offer", 6, -28, null, null, "Review synthetic offer scorecard by Friday", "€76,000–€88,000", "Develop internal APIs and developer tools using Python, PostgreSQL, Docker, Git, CI/CD, and pragmatic Agile delivery. Kubernetes experience is helpful."],
    [105, pathBackend, "Backend API Engineer", "Mosaic Ledger", "Berlin · On-site", "rejected", -3, -35, null, null, "Record lessons and close application", "€72,000–€84,000", "Design secure REST APIs with Python, FastAPI, SQL, PostgreSQL, Docker and Git. Experience with distributed systems and Azure is desirable."],
    [106, pathSoftware, "Senior Software Engineer", "Pinecone Works", "Remote · EU", "saved", 18, null, 12, null, "Compare role against hybrid preference", "€85,000–€100,000", "Senior product engineer with Python, API design, PostgreSQL, testing, mentoring, system design, CI/CD, Docker, and cross-functional Agile delivery."],
    [107, pathBackend, "Lead Backend Developer", "Copper Cloud", "Hamburg · Hybrid", "applied", 12, -3, 4, null, "Follow up with hiring team", "€90,000–€105,000", "Lead backend engineers building Python microservices, PostgreSQL platforms and REST APIs. Own delivery metrics, mentoring, observability and Kubernetes adoption."],
  ].map(([id, path_id, title, company, location, application_status, close, applied, follow, interview, next_action, salary_text, description]) => ({
    id: uuid(id), user_id: userId, path_id, title, company, location,
    source_url: `https://example.invalid/jobs/${id}`, normalized_source_url: `https://example.invalid/jobs/${id}`,
    source_provider: "synthetic-local", external_job_id: `ORYNTA-DEMO-${id}`,
    description, content_hash: createHash("sha256").update(description).digest("hex"),
    application_status, closing_date: day(close), applied_at: applied === null ? null : instant(applied),
    follow_up_date: follow === null ? null : day(follow), interview_at: interview === null ? null : instant(interview, 13),
    next_action, salary_text, employment_type: "Full-time",
    work_arrangement: location.includes("Remote") ? "Remote" : location.includes("Hybrid") ? "Hybrid" : "On-site",
    notes: `Synthetic application. Stage history: saved ${day(-40)}${applied === null ? "" : ` → applied ${day(applied)}`}${application_status === "interviewing" ? ` → interviewing ${day(-2)}` : ""}${application_status === "offer" ? ` → offer ${day(-1)}` : ""}${application_status === "rejected" ? ` → rejected ${day(-3)}` : ""}.`,
    contact_name: application_status === "interviewing" ? "Recruiter Demo" : "",
    contact_email: application_status === "interviewing" ? "recruiter@synthetic.invalid" : "",
    import_metadata: { synthetic: true, method: "local_demo_seed" },
    created_at: instant(-40 + (id - 100)), updated_at: instant(-1),
  }));
  await insert(status, "job_descriptions", jobs);

  const evidence = [
    [201, "Python", "FastAPI billing API performance", 3, "Owned profiling and Python changes that reduced p95 latency from 420 ms to 170 ms [CV1, CV2]."],
    [202, "FastAPI", "Versioned service interfaces", 3, "Designed request validation, dependency boundaries, and versioned endpoints for a PostgreSQL-backed API [CV1, CV6]."],
    [203, "PostgreSQL", "Query and schema optimisation", 3, "Added targeted indexes, removed N+1 queries, and designed transaction-safe order schemas [CV2, CV6]."],
    [204, "Docker", "Repeatable service packaging", 3, "Maintained multi-stage Docker builds used by local development and CI delivery [CV3]."],
    [205, "CI/CD", "Measured release automation", 3, "Built GitHub Actions stages that reduced median deployment time by 60% with tested rollback [CV3]."],
    [206, "Mentoring", "Four-engineer onboarding programme", 3, "Paired on request tracing, used teach-back, and maintained onboarding runbooks [CV4]."],
    [207, "Microservices", "Service-boundary design reviews", 2, "Contributed to boundary and idempotency decisions, but did not own a broad production decomposition [CV5, P2]."],
    [208, "Kubernetes", "Local cluster and rollout support", 2, "Deployed the portfolio service with Helm locally and supported production rollout investigations [CV5, P1]."],
    [209, "Azure", "Migration discovery and architecture lab", 1, "Completed an Azure architecture decision record and migration rehearsal; no owned production Azure workload yet [CV5, P1]."],
    [210, "Observability", "Metrics and incident dashboards", 2, "Added application metrics and used Prometheus/Grafana locally; production tracing ownership remains partial [CV5, P1]."],
    [211, "Agile delivery", "Sprint facilitation", 2, "Facilitated planning and retrospectives for two quarters without formal Scrum leadership responsibility [CV8]."],
    [212, "Git", "Review and release controls", 3, "Used protected branches, peer review, release tags, and rollback commits across product teams [CV3, CV7]."],
    [213, "REST APIs", "API design and scale evidence", 3, "Designed versioned APIs for 1.2M synthetic monthly transactions [CV6]."],
    [214, "STAR story bank", "Reusable interview examples", 2, "Stories prepared: API latency recovery [CV2], CI/CD improvement [CV3], mentoring adjustment [CV4], and incident learning [CV5]."],
  ].map(([id, skill, title, confidence, evidenceText]) => ({
    id: uuid(id), user_id: userId, skill, title, confidence, evidence: evidenceText,
    created_at: instant(-30 + (id - 200)), updated_at: instant(-2),
  }));
  await insert(status, "knowledge_evidence", evidence);

  const sources = [
    { label: "CV1", source_type: "cv", source_id: "current-cv", title: "Linden Labs · Backend services", excerpt: "Built Python and FastAPI services backed by PostgreSQL." },
    { label: "CV2", source_type: "cv", source_id: "current-cv", title: "API performance achievement", excerpt: "Reduced p95 API latency from 420 ms to 170 ms through query tuning and caching." },
    { label: "CV3", source_type: "cv", source_id: "current-cv", title: "CI/CD achievement", excerpt: "Cut median deployment time from 25 to 10 minutes while preserving rollback controls." },
    { label: "CV4", source_type: "cv", source_id: "current-cv", title: "Mentoring evidence", excerpt: "Mentored four engineers through pairing, API tracing, and onboarding runbooks." },
    { label: "J1", source_type: "job_description", source_id: uuid(101), title: "Atlas Forge requirements", company: "Atlas Forge", excerpt: "Own Azure platform services, Kubernetes, Terraform, CI/CD, Docker, and observability." },
    { label: "J2", source_type: "job_description", source_id: uuid(103), title: "Kiteworks Labs requirements", company: "Kiteworks Labs", excerpt: "Operate Kubernetes services, Prometheus and Grafana observability, incident response, and SLOs." },
    { label: "K1", source_type: "knowledge", source_id: uuid(201), title: "Python performance evidence", excerpt: "Owned profiling and Python changes that reduced p95 latency." },
    { label: "K7", source_type: "knowledge", source_id: uuid(208), title: "Kubernetes evidence", excerpt: "Local Helm deployment and production rollout support; no cluster ownership." },
    { label: "K8", source_type: "knowledge", source_id: uuid(210), title: "Observability evidence", excerpt: "Application metrics and local Prometheus/Grafana; production tracing ownership is partial." },
    { label: "K9", source_type: "knowledge", source_id: uuid(209), title: "Azure evidence", excerpt: "Architecture lab and migration rehearsal without an owned production workload." },
  ];
  const currentFindings = [
    { skill: "Python & FastAPI", confidence: "strong", explanation: "Supported by two roles, a measured latency result, and a directly relevant knowledge record. Impact: core requirement across all tracked platform/backend roles. Next: keep the 420 ms → 170 ms metric prominent.", citations: ["CV1", "CV2", "K1"] },
    { skill: "PostgreSQL & API design", confidence: "strong", explanation: "Six years of API work plus schema and query optimisation provide strong coverage. The match contribution is 18 of 20 weighted points.", citations: ["CV1", "CV2"] },
    { skill: "Docker & CI/CD", confidence: "strong", explanation: "The 60% release-time improvement demonstrates delivery impact rather than a tool list. This satisfies the evidence threshold for both skills.", citations: ["CV3", "J1"] },
    { skill: "Kubernetes", confidence: "partial", explanation: "There is hands-on Helm and rollout-support evidence, but no owned production cluster or operational outcome. Priority: high because it appears in two of three active cloud jobs. Next: publish an operated-service case study.", citations: ["K7", "J1", "J2"] },
    { skill: "Observability", confidence: "partial", explanation: "Metrics and dashboard work are visible, while tracing, SLO ownership, and incident outcomes are thin. Next: add a trace-led incident example with before/after detection time.", citations: ["K8", "J2"] },
    { skill: "Azure", confidence: "missing", explanation: "The architecture lab is useful learning evidence but does not yet demonstrate production delivery. Highest-priority opportunity: complete a local Azure-compatible migration case study and document identity, networking, rollback, and cost decisions.", citations: ["K9", "J1"] },
    { skill: "Agile delivery", confidence: "partial", explanation: "Planning and retrospective facilitation show participation, but delivery leadership outcomes are not quantified. Next: connect the work to predictability or cycle-time improvement.", citations: ["CV4"] },
  ];
  const analyses = [
    {
      id: uuid(301), request_id: uuid(601), user_id: userId, path_id: pathCloud, target_role: "Cloud Platform Engineer",
      status: "succeeded",
      summary: "Overall match: 68/100. Evidence coverage: 71% (5 of 7 assessed requirement groups have strong or partial support; 2 are below the demonstration threshold). The score weights recurring requirements at 60%, evidence strength at 30%, and recency/relevance at 10%. Strongest evidence: Python/FastAPI performance and CI/CD impact. Highest-priority opportunity: production-shaped Azure evidence. Confidence: high for cited evidence, medium for gap priority because the job sample is seven synthetic listings.",
      findings: currentFindings, sources, model: "local-demo-deterministic-v1", document_count: 24,
      created_at: instant(-1), started_at: instant(-1), completed_at: instant(-1), updated_at: instant(-1),
    },
    {
      id: uuid(302), request_id: uuid(602), user_id: userId, path_id: pathCloud, target_role: "Cloud Platform Engineer",
      status: "succeeded",
      summary: "Previous report: 59/100 match and 57% evidence coverage. Docker and CI/CD were strong; Kubernetes, observability, Azure, and Agile delivery lacked enough cited detail. Scoring used the same 60/30/10 weighting as the current report.",
      findings: [
        ...currentFindings.slice(0, 3),
        { ...currentFindings[3], confidence: "missing", explanation: "No hands-on Kubernetes evidence was cited in this earlier assessment." },
        { ...currentFindings[4], confidence: "missing", explanation: "No specific observability tooling or outcome was cited." },
        currentFindings[5],
        { ...currentFindings[6], confidence: "missing", explanation: "Agile participation was listed without a delivery example." },
      ],
      sources, model: "local-demo-deterministic-v1", document_count: 18,
      created_at: instant(-35), started_at: instant(-35), completed_at: instant(-35), updated_at: instant(-35),
    },
    {
      id: uuid(303), request_id: uuid(603), user_id: userId, path_id: pathBackend, target_role: "Senior Backend Engineer",
      status: "succeeded",
      summary: "Overall match: 88/100. Evidence coverage: 91%. Python, FastAPI, PostgreSQL, API design, Git, delivery automation, and mentoring are strongly supported; microservice ownership remains partial. Confidence: high.",
      findings: currentFindings.slice(0, 4), sources, model: "local-demo-deterministic-v1", document_count: 17,
      created_at: instant(-8), started_at: instant(-8), completed_at: instant(-8), updated_at: instant(-8),
    },
    {
      id: uuid(304), request_id: uuid(604), user_id: userId, path_id: pathSoftware, target_role: "Software Engineer",
      status: "succeeded",
      summary: "Overall match: 82/100. Evidence coverage: 84%. Backend product delivery is strong; broader frontend evidence and additional system-design examples would improve role flexibility. Confidence: medium-high.",
      findings: currentFindings.slice(0, 5), sources, model: "local-demo-deterministic-v1", document_count: 16,
      created_at: instant(-12), started_at: instant(-12), completed_at: instant(-12), updated_at: instant(-12),
    },
  ];
  await insert(status, "career_analyses", analyses);
  await insert(status, "analysis_finding_feedback", [
    { id: uuid(320), user_id: userId, analysis_id: uuid(301), finding_index: 0, rating: "useful" },
    { id: uuid(321), user_id: userId, analysis_id: uuid(301), finding_index: 4, rating: "needs_work" },
  ]);

  const tasks = [
    [401, "Document an Agile delivery outcome", "Agile delivery", "Add cycle-time or predictability impact to the sprint-facilitation example. Effort: 45 min. Impact: medium. Dependency: find a safe synthetic baseline.", "completed", "medium", -8, -9, null],
    [402, "Publish Azure migration decision record", "Azure", "Document identity, networking, PostgreSQL cutover, rollback, and cost trade-offs. Effort: 4 hours. Impact: high. Dependency: complete the local migration rehearsal.", "in_progress", "high", 7, null, null],
    [403, "Operate Kubernetes portfolio service", "Kubernetes", "Run three releases, induce one failure, capture recovery evidence, and update the README. Effort: 6 hours. Impact: high. Dependency: observability baseline.", "in_progress", "high", 12, null, null],
    [404, "Add trace-led incident evidence", "Observability", "Instrument one request path and record detection/recovery before and after traces. Effort: 3 hours. Impact: high. Dependency: Kubernetes service.", "not_started", "high", 18, null, null],
    [405, "Strengthen CV platform summary", "CV", "Move the 60% deployment improvement and API latency result into the opening third. Effort: 30 min. Impact: medium.", "completed", "medium", -4, -5, null],
    [406, "Complete portfolio evidence page", "Portfolio", "Publish architecture, trade-offs, screenshots, metrics, and a truthful limitations section. Effort: 5 hours. Impact: high. Dependency: Kubernetes and observability tasks.", "not_started", "high", 24, null, null],
    [407, "Schedule two platform conversations", "Networking", "Ask two synthetic peers about platform ownership signals and interview expectations. Effort: 1 hour. Impact: medium.", "not_started", "medium", 10, null, null],
    [408, "Submit two focused applications", "Applications", "Tailor CV evidence to Atlas Forge and Pinecone Works, then record follow-up dates. Effort: 2 hours. Impact: high. Dependency: Azure decision record draft.", "not_started", "high", 9, null, null],
    [409, "Rehearse incident-response STAR story", "Interview", "Record a two-minute answer, check action/result specificity, and repeat once. Effort: 40 min. Impact: high.", "completed", "high", -1, -2, null],
  ].map(([id, title, skill, description, statusValue, priority, due, completed, evidence_id]) => ({
    id: uuid(id), user_id: userId, path_id: pathCloud, analysis_id: id === 402 ? uuid(301) : null,
    finding_index: id === 402 ? 5 : null, evidence_id, title, skill, description,
    status: statusValue, priority, target_date: day(due),
    completed_at: completed === null ? null : instant(completed),
    created_at: instant(-20 + (id - 400)), updated_at: instant(-1),
  }));
  await insert(status, "action_plan_items", tasks);
  await insert(status, "analysis_evidence_links", [
    { id: uuid(420), user_id: userId, analysis_id: uuid(301), finding_index: 0, evidence_id: uuid(201) },
    { id: uuid(421), user_id: userId, analysis_id: uuid(301), finding_index: 3, evidence_id: uuid(208) },
    { id: uuid(422), user_id: userId, analysis_id: uuid(301), finding_index: 4, evidence_id: uuid(210) },
  ]);
  await insert(status, "cv_guidance", [{
    id: uuid(430), user_id: userId, path_id: pathCloud, job_id: uuid(101),
    summary: "Truthful guidance for Atlas Forge: lead with delivery automation and clearly label Azure/Kubernetes as growing evidence.",
    suggestions: [
      { section: "Summary", recommendation: "Lead with backend platform delivery, 60% faster releases, and hybrid Berlin preference.", reason: "Directly matches the role's enablement focus." },
      { section: "Experience", recommendation: "Keep the 420 ms → 170 ms API result and name PostgreSQL query work.", reason: "Demonstrates measurable engineering depth." },
      { section: "Projects", recommendation: "Add the local Kubernetes/Azure migration case study with an explicit non-production limitation.", reason: "Closes the visibility gap without overstating experience." },
    ],
    model: "local-demo-deterministic-v1", created_at: instant(-2),
  }]);

  const sessionOne = uuid(501);
  const sessionTwo = uuid(502);
  const assessment = {
    score: 84, verdict: "strong",
    summary: "The answers are specific and evidence-led. The next gain is sharper trade-off language in cloud scenarios.",
    strengths: [
      { title: "Measured outcomes", detail: "Latency and deployment improvements use clear baselines and results.", question_indexes: [0, 3] },
      { title: "Honest scope", detail: "Kubernetes and Azure answers distinguish owned work from supported or lab work.", question_indexes: [2, 5] },
    ],
    improvements: [
      { title: "State trade-offs sooner", detail: "Name the rejected alternative and why before listing implementation steps.", question_indexes: [1, 5] },
      { title: "Tighten reflection", detail: "End behavioral answers with what changed in your later practice.", question_indexes: [0, 4] },
    ],
    next_practice: { focus: "Cloud trade-off clarity", exercise: "Answer the Azure migration question in 90 seconds using one decision, one rejected option, one risk, and one rollback signal." },
  };
  await insert(status, "interview_practice_sessions", [
    {
      id: sessionOne, user_id: userId, path_id: pathCloud, job_id: uuid(103),
      title: "Platform Reliability Engineer", company: "Kiteworks Labs",
      questions: questions("platform reliability engineering"),
      source_context: sources, status: "completed", answered_count: 6, earned_xp: 90,
      model: "local-demo-deterministic-v1", started_at: instant(-4, 13), completed_at: instant(-4, 15),
      assessment_status: "succeeded", assessment, assessment_model: "local-demo-deterministic-v1", assessed_at: instant(-4, 16),
    },
    {
      id: sessionTwo, user_id: userId, path_id: pathBackend, job_id: uuid(102),
      title: "Senior Backend Engineer", company: "Juniper Market",
      questions: questions("senior backend engineering"),
      source_context: sources, status: "completed", answered_count: 6, earned_xp: 60,
      model: "local-demo-deterministic-v1", started_at: instant(-24, 13), completed_at: instant(-24, 15),
      assessment_status: "succeeded", assessment: { ...assessment, score: 72, verdict: "solid", summary: "Good technical structure; add more explicit ownership and results." },
      assessment_model: "local-demo-deterministic-v1", assessed_at: instant(-24, 16),
    },
  ]);
  await insert(status, "interview_practice_answers", [
    ...answers(sessionOne, true).map((row) => ({ ...row, user_id: userId })),
    ...answers(sessionTwo, false).map((row) => ({ ...row, user_id: userId })),
  ]);
  await insert(status, "interview_game_profiles", [{
    user_id: userId, total_xp: 150, current_streak: 3, longest_streak: 5,
    last_practice_date: day(-1), questions_answered: 12, sessions_completed: 2,
    badges: ["first_answer", "five_answers", "session_complete", "three_day_streak"],
  }]);
  await insert(status, "audit_events", [
    { user_id: userId, action: "demo_seeded", entity_type: "workspace", entity_id: userId, details: { synthetic: true, local_only: true } },
    { user_id: userId, action: "cv_replaced", entity_type: "cv", entity_id: "current-cv", details: { previous: "user-demo-cv-v1.pdf", current: "user-demo-synthetic-cv.pdf", synthetic: true } },
    { user_id: userId, action: "assessment_rerun", entity_type: "career_analysis", entity_id: uuid(301), details: { previous_score: 59, current_score: 68, synthetic: true } },
  ]);

  const artifactDir = resolve(root, ".demo-artifacts");
  mkdirSync(artifactDir, { recursive: true });
  const cvTextPath = resolve(artifactDir, "user-demo-synthetic-cv.txt");
  const cvPdfPath = resolve(artifactDir, "user-demo-synthetic-cv.pdf");
  writeFileSync(cvTextPath, cvText);
  try {
    const pdf = execFileSync("cupsfilter", ["-m", "application/pdf", cvTextPath], { stdio: ["ignore", "pipe", "ignore"] });
    writeFileSync(cvPdfPath, pdf);
    const upload = await fetch(`${status.API_URL}/storage/v1/object/private-cvs/${userId}/current-cv.pdf`, {
      method: "POST",
      headers: {
        apikey: status.SERVICE_ROLE_KEY,
        Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
        "Content-Type": "application/pdf",
        "x-upsert": "true",
      },
      body: pdf,
    });
    if (!upload.ok) throw new Error(`CV upload failed: ${upload.status} ${await upload.text()}`);
  } catch (error) {
    console.warn(`Synthetic PDF was not uploaded: ${error.message}`);
  }
  return { userId, apiUrl: status.API_URL };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = await seedDemo();
  console.log(`Local demo seeded for ${DEMO_EMAIL} at ${result.apiUrl}`);
}
