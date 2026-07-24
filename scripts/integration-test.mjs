import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const rawStatus = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" });
const status = JSON.parse(rawStatus.slice(rawStatus.indexOf("{")));
const baseUrl = status.API_URL;
const anonKey = status.ANON_KEY;
const serviceKey = status.SERVICE_ROLE_KEY;
const createdUsers = [];
const createdWaitlistSignups = [];

async function request(path, { token = anonKey, apiKey = anonKey, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = text; }
  return { response, data };
}

async function createUser(label, appMetadata = {}) {
  const email = `orynta-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = "Orynta-Test-Password-42!";
  let created;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    created = await request("/auth/v1/admin/users", {
      token: serviceKey,
      apiKey: serviceKey,
      method: "POST",
      body: {
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: `${label} User` },
        app_metadata: appMetadata,
      },
    });
    if (![502, 503].includes(created.response.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  assert.equal(created.response.status, 200, JSON.stringify(created.data));
  const login = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.data));
  const user = { id: created.data.id, email, password, token: login.data.access_token };
  createdUsers.push(user.id);
  return user;
}

async function rest(path, user, options = {}) {
  return request(`/rest/v1/${path}`, { token: user.token, ...options });
}

async function serviceRest(path, options = {}) {
  return request(`/rest/v1/${path}`, { token: serviceKey, apiKey: serviceKey, ...options });
}

async function cleanup() {
  for (const userId of createdUsers) {
    await request(`/auth/v1/admin/users/${userId}`, {
      token: serviceKey,
      apiKey: serviceKey,
      method: "DELETE",
    });
  }
  for (const signupId of createdWaitlistSignups) {
    await serviceRest(`waitlist_signups?id=eq.${signupId}`, { method: "DELETE" });
  }
}

function completedAnalysisBody(userId, requestId, number) {
  return {
    p_user_id: userId,
    p_request_id: requestId,
    p_summary: `Persisted analysis ${number}`,
    p_findings: [{
      skill: "Kubernetes",
      confidence: "partial",
      explanation: "The job asks for Kubernetes and the CV contains partial evidence.",
      citations: ["D1", "D2"],
    }],
    p_sources: [
      { label: "D1", source_type: "job_description", source_id: "job", excerpt: "Kubernetes required" },
      { label: "D2", source_type: "cv", source_id: "cv", excerpt: "Container experience" },
    ],
    p_model: "integration-model",
  };
}

try {
  const publicSignup = await request("/auth/v1/signup", {
    method: "POST",
    body: { email: `blocked-${Date.now()}@example.com`, password: "Blocked-Password-42!" },
  });
  assert.equal(publicSignup.response.ok, false, "public sign-up must be disabled for the private beta");

  const alice = await createUser("Alice");
  const bob = await createUser("Bob");
  const analyticsAdmin = await createUser("Analytics Admin", { role: "admin" });

  const validProductEvent = await rest("rpc/record_product_event", alice, {
    method: "POST",
    body: {
      p_event_name: "app_open",
      p_surface: "overview",
      p_workflow: null,
      p_error_code: null,
      p_session_id: crypto.randomUUID(),
      p_app_version: "integration",
    },
  });
  assert.equal(validProductEvent.response.status, 204, JSON.stringify(validProductEvent.data));
  const invalidProductEvent = await rest("rpc/record_product_event", alice, {
    method: "POST",
    body: {
      p_event_name: "arbitrary_event",
      p_surface: "overview",
      p_workflow: null,
      p_error_code: null,
      p_session_id: crypto.randomUUID(),
      p_app_version: "integration",
    },
  });
  assert.equal(invalidProductEvent.response.ok, false, "unapproved product events must be rejected");
  const browserTelemetryRead = await rest("product_events?select=*", alice);
  assert.equal(browserTelemetryRead.response.ok, false, "browser users cannot read product telemetry");
  const browserOperationalInsert = await rest("operational_events", alice, {
    method: "POST",
    body: { operation: "analyze_career", outcome: "succeeded", latency_ms: 1 },
  });
  assert.equal(browserOperationalInsert.response.ok, false, "browser users cannot write operational telemetry");

  const browserAdminRpc = await rest("rpc/admin_analytics_overview", analyticsAdmin, {
    method: "POST",
    body: { p_from: new Date(Date.now() - 86400000).toISOString(), p_to: new Date(Date.now() + 86400000).toISOString() },
  });
  assert.equal(browserAdminRpc.response.ok, false, "admin aggregate RPCs remain inaccessible to browser roles");
  const serviceAdminRpc = await serviceRest("rpc/admin_analytics_overview", {
    method: "POST",
    body: { p_from: new Date(Date.now() - 86400000).toISOString(), p_to: new Date(Date.now() + 86400000).toISOString() },
  });
  assert.equal(serviceAdminRpc.response.status, 200, JSON.stringify(serviceAdminRpc.data));
  assert.equal(serviceAdminRpc.data.totals.total_users >= 3, true);

  const nonAdminAnalytics = await request("/functions/v1/admin-analytics", {
    token: alice.token,
    method: "POST",
    body: { operation: "overview", from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() },
  });
  assert.equal(nonAdminAnalytics.response.status, 403, JSON.stringify(nonAdminAnalytics.data));
  const adminAnalytics = await request("/functions/v1/admin-analytics", {
    token: analyticsAdmin.token,
    method: "POST",
    body: { operation: "overview", from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() },
  });
  assert.equal(adminAnalytics.response.status, 200, JSON.stringify(adminAnalytics.data));
  const adminPayload = JSON.stringify(adminAnalytics.data);
  for (const forbidden of ["cv_text", "description", "answer_text", "findings", "contact_email", "stripe_customer_id"]) {
    assert.equal(adminPayload.includes(`"${forbidden}"`), false, `admin overview must not expose ${forbidden}`);
  }

  const waitlistEmail = `orynta-waitlist-${Date.now()}@example.com`;
  const waitlistSignup = await serviceRest("waitlist_signups?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { email: waitlistEmail, display_name: "Waitlist Person", source: "integration" },
  });
  assert.equal(waitlistSignup.response.status, 201, JSON.stringify(waitlistSignup.data));
  const waitlistId = waitlistSignup.data[0].id;
  createdWaitlistSignups.push(waitlistId);
  const waitlistDirectory = await request("/functions/v1/admin-analytics", {
    token: analyticsAdmin.token,
    method: "POST",
    body: { operation: "waitlist", search: waitlistEmail, from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() },
  });
  assert.equal(waitlistDirectory.response.status, 200, JSON.stringify(waitlistDirectory.data));
  assert.equal(waitlistDirectory.data.items[0].status, "pending");
  assert.equal("invited_user_id" in waitlistDirectory.data.items[0], false, "waitlist API must not expose Auth user IDs");
  const nonAdminInvite = await request("/functions/v1/admin-analytics", {
    token: alice.token,
    method: "POST",
    body: { operation: "invite", signupId: waitlistId },
  });
  assert.equal(nonAdminInvite.response.status, 403, JSON.stringify(nonAdminInvite.data));
  const sentInvite = await request("/functions/v1/admin-analytics", {
    token: analyticsAdmin.token,
    method: "POST",
    body: { operation: "invite", signupId: waitlistId },
  });
  assert.equal(sentInvite.response.status, 200, JSON.stringify(sentInvite.data));
  assert.equal(sentInvite.data.invited, true);
  createdUsers.push(sentInvite.data.user_id);
  const duplicateInvite = await request("/functions/v1/admin-analytics", {
    token: analyticsAdmin.token,
    method: "POST",
    body: { operation: "invite", signupId: waitlistId },
  });
  assert.equal(duplicateInvite.response.status, 409, JSON.stringify(duplicateInvite.data));

  const aliceProfile = await rest(`career_profiles?user_id=eq.${alice.id}&select=*`, alice);
  assert.equal(aliceProfile.response.status, 200, JSON.stringify(aliceProfile.data));
  assert.equal(aliceProfile.data.length, 1);
  assert.equal(aliceProfile.data[0].display_name, "Alice User");
  assert.equal(aliceProfile.data[0].onboarding_complete, false);

  const onboardingUpdate = await rest(`career_profiles?user_id=eq.${alice.id}&select=*`, alice, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: {
      onboarding_complete: true,
      career_goal: "Become a senior platform engineer",
      experience_level: "mid",
      cv_text: "Alice private CV evidence",
      beta_terms_accepted_at: new Date().toISOString(),
      privacy_notice_version: "2026-07-16",
    },
  });
  assert.equal(onboardingUpdate.response.status, 200, JSON.stringify(onboardingUpdate.data));
  assert.equal(onboardingUpdate.data[0].privacy_notice_version, "2026-07-16");

  const bobCannotReadAliceProfile = await rest(`career_profiles?user_id=eq.${alice.id}&select=*`, bob);
  assert.equal(bobCannotReadAliceProfile.response.status, 200);
  assert.deepEqual(bobCannotReadAliceProfile.data, []);

  const pathIds = [];
  let firstJobId = "";
  for (let index = 1; index <= 3; index += 1) {
    const id = crypto.randomUUID();
    pathIds.push(id);
    const result = await rest("career_paths", alice, {
      method: "POST",
      body: {
        id,
        user_id: alice.id,
        name: `Beta path ${index}`,
        target: "Senior Platform Engineer",
        description: "Private beta path",
      },
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
  }
  const fourthPath = await rest("career_paths", alice, {
    method: "POST",
    body: {
      id: crypto.randomUUID(),
      user_id: alice.id,
      name: "Fourth beta path",
      target: "Architect",
      description: "",
    },
  });
  assert.equal(fourthPath.response.ok, false, "private-beta users must be limited to three paths");

  const bobPathId = crypto.randomUUID();
  const bobPath = await rest("career_paths", bob, {
    method: "POST",
    body: { id: bobPathId, user_id: bob.id, name: "Data", target: "Data Engineer", description: "" },
  });
  assert.equal(bobPath.response.status, 201, JSON.stringify(bobPath.data));

  const crossTenantJob = await rest("job_descriptions", alice, {
    method: "POST",
    body: {
      id: crypto.randomUUID(),
      user_id: alice.id,
      path_id: bobPathId,
      title: "Cross tenant",
      description: "This must never be accepted.",
    },
  });
  assert.equal(crossTenantJob.response.ok, false, "cross-tenant path references must be rejected");

  for (let index = 1; index <= 20; index += 1) {
    const jobId = crypto.randomUUID();
    if (index === 1) firstJobId = jobId;
    const job = await rest("job_descriptions", alice, {
      method: "POST",
      body: {
        id: jobId,
        user_id: alice.id,
        path_id: pathIds[0],
        title: `Platform role ${index}`,
        description: `Unique beta platform description ${index}`,
        content_hash: `beta-integration-hash-${index}`,
        application_status: index === 1 ? "applied" : "saved",
        applied_at: index === 1 ? new Date().toISOString() : null,
        next_action: index === 1 ? "Follow up with the recruiter" : "",
        follow_up_date: index === 1 ? new Date().toISOString().slice(0, 10) : null,
        interview_at: index === 1 ? new Date(Date.now() + 86400000).toISOString() : null,
        contact_name: index === 1 ? "Recruiter One" : "",
        contact_email: index === 1 ? "recruiter@example.com" : "",
      },
    });
    assert.equal(job.response.status, 201, JSON.stringify(job.data));
  }
  const cockpitJob = await rest(`job_descriptions?id=eq.${firstJobId}&select=next_action,follow_up_date,interview_at,contact_name,contact_email`, alice);
  assert.equal(cockpitJob.response.status, 200, JSON.stringify(cockpitJob.data));
  assert.equal(cockpitJob.data[0].next_action, "Follow up with the recruiter");
  assert.equal(cockpitJob.data[0].contact_email, "recruiter@example.com");
  const bobCannotReadCockpit = await rest(`job_descriptions?id=eq.${firstJobId}&select=next_action,contact_email`, bob);
  assert.deepEqual(bobCannotReadCockpit.data, [], "application cockpit details must remain owner-only");
  const twentyFirstJob = await rest("job_descriptions", alice, {
    method: "POST",
    body: {
      id: crypto.randomUUID(),
      user_id: alice.id,
      path_id: pathIds[0],
      title: "Platform role 21",
      description: "This exceeds the private-beta allowance.",
      content_hash: "beta-integration-hash-21",
    },
  });
  assert.equal(twentyFirstJob.response.ok, false, "private-beta users must be limited to 20 jobs");

  const duplicateJob = await rest("job_descriptions", alice, {
    method: "POST",
    body: {
      id: crypto.randomUUID(),
      user_id: alice.id,
      path_id: pathIds[1],
      title: "Duplicate role",
      description: "Duplicate normalized content",
      content_hash: "beta-integration-hash-1",
    },
  });
  assert.equal(duplicateJob.response.ok, false, "duplicate job content hashes must be rejected");

  const firstInterviewReservation = await rest("rpc/reserve_interview_prep", alice, {
    method: "POST",
    body: {},
  });
  assert.equal(firstInterviewReservation.response.status, 200, JSON.stringify(firstInterviewReservation.data));
  assert.equal(firstInterviewReservation.data[0].allowed, true);
  assert.equal(firstInterviewReservation.data[0].used, 1);
  const overInterviewQuota = await rest("rpc/reserve_interview_prep", alice, {
    method: "POST",
    body: {},
  });
  assert.equal(overInterviewQuota.data[0].allowed, false, "free users receive one practice set per month");
  const browserRefund = await rest("rpc/refund_interview_prep", alice, {
    method: "POST",
    body: { p_user_id: alice.id },
  });
  assert.equal(browserRefund.response.ok, false, "browser clients cannot refund their own AI quota");
  const serviceRefund = await serviceRest("rpc/refund_interview_prep", {
    method: "POST",
    body: { p_user_id: alice.id },
  });
  assert.equal(serviceRefund.response.ok, true, JSON.stringify(serviceRefund.data));

  const directInterviewInsert = await rest("interview_practice_sessions", alice, {
    method: "POST",
    body: {
      user_id: alice.id,
      path_id: pathIds[0],
      job_id: firstJobId,
      title: "Browser-created session",
      questions: [{}, {}, {}],
    },
  });
  assert.equal(directInterviewInsert.response.ok, false, "browser clients cannot create generated interview sessions");

  const interviewQuestions = Array.from({ length: 6 }, function(_item, index) {
    return {
      category: index < 2 ? "role" : "behaviour",
      difficulty: index < 2 ? "starter" : "stretch",
      question: `Integration interview question ${index + 1}`,
      why_it_matters: "Tests relevant evidence.",
      answer_framework: "Situation, action, result, learning.",
      evidence_prompts: ["Use a specific supported example."],
      evidence_labels: ["J1"],
    };
  });
  const savedInterview = await serviceRest("interview_practice_sessions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      user_id: alice.id,
      path_id: pathIds[0],
      job_id: firstJobId,
      title: "Platform role 1",
      company: "Integration Company",
      questions: interviewQuestions,
      source_context: [{ label: "J1", type: "job", title: "Platform role 1" }],
      model: "integration-model",
    },
  });
  assert.equal(savedInterview.response.status, 201, JSON.stringify(savedInterview.data));
  const interviewSessionId = savedInterview.data[0].id;
  const bobCannotReadInterview = await rest(`interview_practice_sessions?id=eq.${interviewSessionId}&select=*`, bob);
  assert.deepEqual(bobCannotReadInterview.data, [], "interview sessions must remain owner-only");
  const directAnswerInsert = await rest("interview_practice_answers", alice, {
    method: "POST",
    body: {
      user_id: alice.id,
      session_id: interviewSessionId,
      question_index: 0,
      answer_text: "Browser-created XP",
      self_rating: 5,
    },
  });
  assert.equal(directAnswerInsert.response.ok, false, "browser clients must use the XP-awarding answer RPC");

  for (let index = 0; index < 6; index += 1) {
    const answer = await rest("rpc/record_interview_answer", alice, {
      method: "POST",
      body: {
        p_session_id: interviewSessionId,
        p_question_index: index,
        p_answer_text: `Specific integration answer ${index + 1}`,
        p_self_rating: 3,
      },
    });
    assert.equal(answer.response.status, 200, JSON.stringify(answer.data));
    assert.equal(answer.data.answer_xp, 10);
    assert.equal(answer.data.completion_xp, index === 5 ? 50 : 0);
  }
  const repeatedAnswer = await rest("rpc/record_interview_answer", alice, {
    method: "POST",
    body: {
      p_session_id: interviewSessionId,
      p_question_index: 0,
      p_answer_text: "Updated answer without duplicate XP",
      p_self_rating: 4,
    },
  });
  assert.equal(repeatedAnswer.data.answer_xp, 0, "editing an answer must not award XP again");
  const assessmentFixture = {
    score: 78,
    verdict: "solid",
    summary: "The examples are relevant and would improve with more measurable outcomes.",
    strengths: [
      { title: "Relevant examples", detail: "The answers stay connected to the role.", question_indexes: [0, 1] },
      { title: "Clear decisions", detail: "The candidate explains several personal choices.", question_indexes: [2, 5] },
    ],
    improvements: [
      { title: "Quantify outcomes", detail: "Add observable results to the examples.", question_indexes: [1, 3] },
      { title: "Tighten structure", detail: "Spend less time on context and more on actions.", question_indexes: [0, 4] },
    ],
    next_practice: { focus: "Measurable impact", exercise: "Rehearse questions 2 and 4 with one concrete result each." },
  };
  const reservedAssessment = await rest("rpc/reserve_interview_assessment", alice, {
    method: "POST",
    body: { p_session_id: interviewSessionId },
  });
  assert.equal(reservedAssessment.response.status, 200, JSON.stringify(reservedAssessment.data));
  assert.equal(reservedAssessment.data.state, "reserved");
  const pendingAssessment = await rest("rpc/reserve_interview_assessment", alice, {
    method: "POST",
    body: { p_session_id: interviewSessionId },
  });
  assert.equal(pendingAssessment.data.state, "pending", "assessment reservation must be idempotent while in progress");
  const bobCannotAssessAlice = await rest("rpc/reserve_interview_assessment", bob, {
    method: "POST",
    body: { p_session_id: interviewSessionId },
  });
  assert.equal(bobCannotAssessAlice.response.ok, false, "another user cannot assess an owned session");
  const completedAssessment = await serviceRest("rpc/complete_interview_assessment", {
    method: "POST",
    body: { p_user_id: alice.id, p_session_id: interviewSessionId, p_assessment: assessmentFixture, p_model: "integration-model" },
  });
  assert.equal(completedAssessment.response.status, 200, JSON.stringify(completedAssessment.data));
  const replayedAssessment = await rest("rpc/reserve_interview_assessment", alice, {
    method: "POST",
    body: { p_session_id: interviewSessionId },
  });
  assert.equal(replayedAssessment.data.state, "succeeded");
  assert.equal(replayedAssessment.data.assessment.score, 78);
  const answerEditInvalidatesAssessment = await rest("rpc/record_interview_answer", alice, {
    method: "POST",
    body: { p_session_id: interviewSessionId, p_question_index: 0, p_answer_text: "A more specific updated answer with a measurable result of 20 percent.", p_self_rating: 4 },
  });
  assert.equal(answerEditInvalidatesAssessment.response.status, 200, JSON.stringify(answerEditInvalidatesAssessment.data));
  const invalidatedSession = await rest(`interview_practice_sessions?id=eq.${interviewSessionId}&select=assessment_status,assessment`, alice);
  assert.equal(invalidatedSession.data[0].assessment_status, "not_started");
  assert.deepEqual(invalidatedSession.data[0].assessment, {});
  const reReservedAssessment = await rest("rpc/reserve_interview_assessment", alice, {
    method: "POST",
    body: { p_session_id: interviewSessionId },
  });
  assert.equal(reReservedAssessment.data.state, "reserved");
  const reCompletedAssessment = await serviceRest("rpc/complete_interview_assessment", {
    method: "POST",
    body: { p_user_id: alice.id, p_session_id: interviewSessionId, p_assessment: assessmentFixture, p_model: "integration-model" },
  });
  assert.equal(reCompletedAssessment.response.status, 200, JSON.stringify(reCompletedAssessment.data));
  const gameProfile = await rest(`interview_game_profiles?user_id=eq.${alice.id}&select=*`, alice);
  assert.equal(gameProfile.data[0].total_xp, 110);
  assert.equal(gameProfile.data[0].questions_answered, 6);
  assert.equal(gameProfile.data[0].sessions_completed, 1);
  assert.equal(gameProfile.data[0].badges.includes("session_complete"), true);
  const bobCannotAnswerAliceSession = await rest("rpc/record_interview_answer", bob, {
    method: "POST",
    body: {
      p_session_id: interviewSessionId,
      p_question_index: 0,
      p_answer_text: "Cross-tenant answer",
      p_self_rating: 5,
    },
  });
  assert.equal(bobCannotAnswerAliceSession.response.ok, false);

  let firstEvidenceId = "";
  for (let index = 1; index <= 50; index += 1) {
    const evidenceId = crypto.randomUUID();
    if (index === 1) firstEvidenceId = evidenceId;
    const evidence = await rest("knowledge_evidence", alice, {
      method: "POST",
      body: {
        id: evidenceId,
        user_id: alice.id,
        skill: `Skill ${index}`,
        title: `Evidence ${index}`,
        confidence: 2,
        evidence: `Private evidence detail ${index}`,
      },
    });
    assert.equal(evidence.response.status, 201, JSON.stringify(evidence.data));
  }
  const fiftyFirstEvidence = await rest("knowledge_evidence", alice, {
    method: "POST",
    body: {
      id: crypto.randomUUID(),
      user_id: alice.id,
      skill: "Skill 51",
      title: "Evidence 51",
      confidence: 2,
      evidence: "This exceeds the private-beta allowance.",
    },
  });
  assert.equal(fiftyFirstEvidence.response.ok, false, "private-beta users must be limited to 50 evidence records");

  const feedback = await rest("beta_feedback", alice, {
    method: "POST",
    body: {
      user_id: alice.id,
      category: "analysis",
      message: "The cited analysis was useful.",
      context: { view: "overview", app_version: "integration" },
    },
  });
  assert.equal(feedback.response.status, 201, JSON.stringify(feedback.data));
  const bobCannotReadFeedback = await rest(`beta_feedback?user_id=eq.${alice.id}&select=*`, bob);
  assert.deepEqual(bobCannotReadFeedback.data, []);
  const aliceCannotWriteBobFeedback = await rest("beta_feedback", alice, {
    method: "POST",
    body: { user_id: bob.id, category: "other", message: "Forbidden cross-user feedback" },
  });
  assert.equal(aliceCannotWriteBobFeedback.response.ok, false);

  const directLegacyQuotaCall = await rest("rpc/consume_feature_usage", alice, {
    method: "POST",
    body: { p_feature_key: "rag_analysis" },
  });
  assert.equal(directLegacyQuotaCall.response.ok, false, "browser clients must use idempotent analysis reservations");

  const directReservation = await rest("rpc/reserve_career_analysis", alice, {
    method: "POST",
    body: {
      p_user_id: alice.id,
      p_request_id: crypto.randomUUID(),
      p_path_id: pathIds[0],
      p_target_role: "Senior Platform Engineer",
      p_document_count: 2,
    },
  });
  assert.equal(directReservation.response.ok, false, "analysis lifecycle RPCs must be service-role only");

  const firstRequestId = crypto.randomUUID();
  const firstReservation = await serviceRest("rpc/reserve_career_analysis", {
    method: "POST",
    body: {
      p_user_id: alice.id,
      p_request_id: firstRequestId,
      p_path_id: pathIds[0],
      p_target_role: "Senior Platform Engineer",
      p_document_count: 2,
    },
  });
  assert.equal(firstReservation.response.status, 200, JSON.stringify(firstReservation.data));
  assert.equal(firstReservation.data.state, "reserved");
  assert.equal(firstReservation.data.access.used, 1);

  const duplicatePending = await serviceRest("rpc/reserve_career_analysis", {
    method: "POST",
    body: {
      p_user_id: alice.id,
      p_request_id: firstRequestId,
      p_path_id: pathIds[0],
      p_target_role: "Senior Platform Engineer",
      p_document_count: 2,
    },
  });
  assert.equal(duplicatePending.data.state, "pending");
  assert.equal(duplicatePending.data.access.used, 1, "duplicate requests must not consume quota");

  const differentRequestWhileBusy = await serviceRest("rpc/reserve_career_analysis", {
    method: "POST",
    body: {
      p_user_id: alice.id,
      p_request_id: crypto.randomUUID(),
      p_path_id: pathIds[1],
      p_target_role: "Platform Architect",
      p_document_count: 2,
    },
  });
  assert.equal(differentRequestWhileBusy.data.state, "user_busy", JSON.stringify(differentRequestWhileBusy.data));
  const accessWhileBusy = await rest("rpc/get_my_account_access", alice, { method: "POST", body: {} });
  assert.equal(accessWhileBusy.data.rag_used, 1, "a second path must wait without consuming quota");

  const bobCannotReadAnalysis = await rest(`career_analyses?request_id=eq.${firstRequestId}&select=*`, bob);
  assert.deepEqual(bobCannotReadAnalysis.data, []);

  const failed = await serviceRest("rpc/fail_career_analysis", {
    method: "POST",
    body: { p_user_id: alice.id, p_request_id: firstRequestId, p_failure_code: "AI_TIMEOUT" },
  });
  assert.equal(failed.data, true);
  const afterFailure = await rest("rpc/get_my_account_access", alice, { method: "POST", body: {} });
  assert.equal(afterFailure.data.rag_used, 0, "failed analyses must release their quota reservation");

  const retryReservation = await serviceRest("rpc/reserve_career_analysis", {
    method: "POST",
    body: {
      p_user_id: alice.id,
      p_request_id: firstRequestId,
      p_path_id: pathIds[0],
      p_target_role: "Senior Platform Engineer",
      p_document_count: 2,
    },
  });
  assert.equal(retryReservation.data.state, "reserved");
  const completed = await serviceRest("rpc/complete_career_analysis", {
    method: "POST",
    body: completedAnalysisBody(alice.id, firstRequestId, 1),
  });
  assert.equal(completed.response.status, 200, JSON.stringify(completed.data));
  assert.equal(completed.data.status, "succeeded");
  assert.equal(completed.data.findings[0].citations.length, 2);

  const findingFeedback = await rest("analysis_finding_feedback?on_conflict=user_id,analysis_id,finding_index", alice, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      user_id: alice.id,
      analysis_id: completed.data.id,
      finding_index: 0,
      rating: "useful",
    },
  });
  assert.equal(findingFeedback.response.status, 201, JSON.stringify(findingFeedback.data));
  const bobCannotReadFindingFeedback = await rest(
    `analysis_finding_feedback?analysis_id=eq.${completed.data.id}&select=*`,
    bob,
  );
  assert.deepEqual(bobCannotReadFindingFeedback.data, []);
  const bobCannotWriteAliceFeedback = await rest("analysis_finding_feedback", bob, {
    method: "POST",
    body: {
      user_id: bob.id,
      analysis_id: completed.data.id,
      finding_index: 0,
      rating: "needs_work",
    },
  });
  assert.equal(bobCannotWriteAliceFeedback.response.status, 403);

  const actionId = crypto.randomUUID();
  const action = await rest("action_plan_items", alice, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      id: actionId,
      user_id: alice.id,
      path_id: pathIds[0],
      analysis_id: completed.data.id,
      finding_index: 0,
      evidence_id: firstEvidenceId,
      title: "Build Kubernetes deployment evidence",
      skill: "Kubernetes",
      description: "Deploy a small service and document the operational decisions.",
      status: "in_progress",
      priority: "high",
    },
  });
  assert.equal(action.response.status, 201, JSON.stringify(action.data));
  const evidenceLink = await rest("analysis_evidence_links", alice, {
    method: "POST",
    body: {
      user_id: alice.id,
      analysis_id: completed.data.id,
      finding_index: 0,
      evidence_id: firstEvidenceId,
    },
  });
  assert.equal(evidenceLink.response.status, 201, JSON.stringify(evidenceLink.data));
  const bobCannotReadActions = await rest(`action_plan_items?id=eq.${actionId}&select=*`, bob);
  assert.deepEqual(bobCannotReadActions.data, []);
  const bobCannotLinkAliceEvidence = await rest("analysis_evidence_links", bob, {
    method: "POST",
    body: {
      user_id: bob.id,
      analysis_id: completed.data.id,
      finding_index: 0,
      evidence_id: firstEvidenceId,
    },
  });
  assert.equal(bobCannotLinkAliceEvidence.response.status, 403);

  const directCvGuidanceInsert = await rest("cv_guidance", alice, {
    method: "POST",
    body: {
      user_id: alice.id,
      path_id: pathIds[0],
      job_id: firstJobId,
      summary: "Browser clients must not create AI guidance records.",
      suggestions: [],
    },
  });
  assert.equal(directCvGuidanceInsert.response.ok, false);
  const savedGuidance = await serviceRest("cv_guidance", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      user_id: alice.id,
      path_id: pathIds[0],
      job_id: firstJobId,
      summary: "Emphasize supported Kubernetes evidence.",
      suggestions: [{
        section: "Experience",
        issue: "The evidence is not prominent.",
        recommendation: "Move the supported deployment example closer to the top.",
        evidence_status: "supported",
      }],
      model: "integration-model",
    },
  });
  assert.equal(savedGuidance.response.status, 201, JSON.stringify(savedGuidance.data));
  const bobCannotReadGuidance = await rest(`cv_guidance?user_id=eq.${alice.id}&select=*`, bob);
  assert.deepEqual(bobCannotReadGuidance.data, []);

  const rawShareToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const shareHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawShareToken));
  const shareHash = Array.from(new Uint8Array(shareHashBytes))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const sharedReport = await rest("shared_reports", alice, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      user_id: alice.id,
      path_id: pathIds[0],
      analysis_id: completed.data.id,
      token_hash: shareHash,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    },
  });
  assert.equal(sharedReport.response.status, 201, JSON.stringify(sharedReport.data));
  const bobCannotReadShareSettings = await rest(`shared_reports?user_id=eq.${alice.id}&select=*`, bob);
  assert.deepEqual(bobCannotReadShareSettings.data, []);
  const publicReport = await request("/functions/v1/shared-report", {
    method: "POST",
    body: { token: rawShareToken },
  });
  assert.equal(publicReport.response.status, 200, JSON.stringify(publicReport.data));
  assert.equal(publicReport.data.report.actions.length, 1);
  assert.equal(JSON.stringify(publicReport.data).includes("Alice private CV evidence"), false);

  const replayed = await serviceRest("rpc/reserve_career_analysis", {
    method: "POST",
    body: {
      p_user_id: alice.id,
      p_request_id: firstRequestId,
      p_path_id: pathIds[0],
      p_target_role: "Senior Platform Engineer",
      p_document_count: 2,
    },
  });
  assert.equal(replayed.data.state, "succeeded");
  assert.equal(replayed.data.access.used, 1, "successful replay must be idempotent");

  for (let index = 2; index <= 10; index += 1) {
    const requestId = crypto.randomUUID();
    const reserved = await serviceRest("rpc/reserve_career_analysis", {
      method: "POST",
      body: {
        p_user_id: alice.id,
        p_request_id: requestId,
        p_path_id: pathIds[0],
        p_target_role: "Senior Platform Engineer",
        p_document_count: 2,
      },
    });
    assert.equal(reserved.data.state, "reserved", JSON.stringify(reserved.data));
    const complete = await serviceRest("rpc/complete_career_analysis", {
      method: "POST",
      body: completedAnalysisBody(alice.id, requestId, index),
    });
    assert.equal(complete.response.status, 200, JSON.stringify(complete.data));
  }
  const overQuota = await serviceRest("rpc/reserve_career_analysis", {
    method: "POST",
    body: {
      p_user_id: alice.id,
      p_request_id: crypto.randomUUID(),
      p_path_id: pathIds[0],
      p_target_role: "Senior Platform Engineer",
      p_document_count: 2,
    },
  });
  assert.equal(overQuota.data.state, "quota_exceeded");
  assert.equal(overQuota.data.access.quota, 10);

  const atomicAction = `integration-atomic-${Date.now()}`;
  const atomicBurst = await Promise.all(Array.from({ length: 10 }, function() {
    return serviceRest("rpc/consume_rate_limit", {
      method: "POST",
      body: {
        p_user_id: alice.id,
        p_action: atomicAction,
        p_limit: 5,
        p_window_seconds: 60,
      },
    });
  }));
  assert.equal(atomicBurst.filter((result) => result.data[0].allowed).length, 5);
  const bobIndependentLimit = await serviceRest("rpc/consume_rate_limit", {
    method: "POST",
    body: {
      p_user_id: bob.id,
      p_action: atomicAction,
      p_limit: 5,
      p_window_seconds: 60,
    },
  });
  assert.equal(bobIndependentLimit.data[0].allowed, true);

  const pdfBytes = new TextEncoder().encode("%PDF-1.4 Orynta integration fixture");
  const upload = await fetch(`${baseUrl}/storage/v1/object/private-cvs/${alice.id}/current-cv.pdf`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${alice.token}`,
      "Content-Type": "application/pdf",
    },
    body: pdfBytes,
  });
  assert.equal(upload.ok, true, await upload.text());
  const aliceReadsOwnCv = await fetch(`${baseUrl}/storage/v1/object/authenticated/private-cvs/${alice.id}/current-cv.pdf`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${alice.token}` },
  });
  assert.equal(aliceReadsOwnCv.ok, true, await aliceReadsOwnCv.text());
  const bobReadsAliceCv = await fetch(`${baseUrl}/storage/v1/object/authenticated/private-cvs/${alice.id}/current-cv.pdf`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${bob.token}` },
  });
  assert.equal(bobReadsAliceCv.ok, false, "private CV must not be readable by another user");

  const unconfiguredAnalysis = await request("/functions/v1/analyze-career", {
    token: alice.token,
    method: "POST",
    body: {
      requestId: crypto.randomUUID(),
      pathId: pathIds[0],
      targetRole: "Senior Platform Engineer",
      documents: [{
        id: "cv-1",
        source_type: "cv",
        text: "Private integration CV evidence",
        metadata: { source_id: "cv", chunk_index: 0 },
      }],
    },
  });
  assert.equal(unconfiguredAnalysis.response.status, 503, JSON.stringify(unconfiguredAnalysis.data));
  assert.equal(unconfiguredAnalysis.data.code, "AI_NOT_CONFIGURED");
  const unconfiguredGuidance = await request("/functions/v1/cv-guidance", {
    token: alice.token,
    method: "POST",
    body: { jobId: firstJobId },
  });
  assert.equal(unconfiguredGuidance.response.status, 503, JSON.stringify(unconfiguredGuidance.data));
  assert.equal(unconfiguredGuidance.data.code, "AI_NOT_CONFIGURED");
  const unconfiguredImport = await request("/functions/v1/import-job", {
    token: alice.token,
    method: "POST",
    body: { url: "https://jobs.lever.co/example/example-role" },
  });
  assert.equal(unconfiguredImport.response.status, 503, JSON.stringify(unconfiguredImport.data));
  assert.equal(unconfiguredImport.data.code, "AI_NOT_CONFIGURED");
  const unconfiguredInterview = await request("/functions/v1/interview-prep", {
    token: alice.token,
    method: "POST",
    body: { jobId: firstJobId },
  });
  assert.equal(unconfiguredInterview.response.status, 503, JSON.stringify(unconfiguredInterview.data));
  assert.equal(unconfiguredInterview.data.code, "AI_NOT_CONFIGURED");
  const freeVoiceForm = new FormData();
  freeVoiceForm.append("audio", new File([new Uint8Array(1200)], "answer.webm", { type: "audio/webm" }));
  const freeVoiceResponse = await fetch(`${baseUrl}/functions/v1/interview-transcribe`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${alice.token}` },
    body: freeVoiceForm,
  });
  const freeVoicePayload = await freeVoiceResponse.json();
  assert.equal(freeVoiceResponse.status, 402, JSON.stringify(freeVoicePayload));
  assert.equal(freeVoicePayload.code, "PREMIUM_REQUIRED");

  for (let index = 0; index < 5; index += 1) {
    const checkoutAttempt = await request("/functions/v1/create-checkout-session", {
      token: alice.token,
      method: "POST",
      body: {},
    });
    assert.equal(checkoutAttempt.response.status, 503);
  }
  const throttledCheckout = await request("/functions/v1/create-checkout-session", {
    token: alice.token,
    method: "POST",
    body: {},
  });
  assert.equal(throttledCheckout.response.status, 429);
  assert.equal(throttledCheckout.data.code, "RATE_LIMITED");

  const exportResult = await request("/functions/v1/export-account", {
    token: alice.token,
    method: "POST",
    body: {},
  });
  assert.equal(exportResult.response.status, 200, JSON.stringify(exportResult.data));
  assert.equal(exportResult.data.profile.user_id, alice.id);
  assert.equal(exportResult.data.career_analyses.length, 10);
  assert.equal(exportResult.data.beta_feedback.length, 1);
  assert.equal(exportResult.data.analysis_finding_feedback.length, 1);
  assert.equal(exportResult.data.action_plan_items.length, 1);
  assert.equal(exportResult.data.analysis_evidence_links.length, 1);
  assert.equal(exportResult.data.cv_guidance.length, 1);
  assert.equal(exportResult.data.shared_reports.length, 1);
  assert.equal(exportResult.data.interview_practice_sessions.length, 1);
  assert.equal(exportResult.data.interview_practice_sessions[0].assessment_status, "succeeded");
  assert.equal(exportResult.data.interview_practice_sessions[0].assessment.score, 78);
  assert.equal(exportResult.data.interview_practice_answers.length, 6);
  assert.equal(exportResult.data.interview_game_profile.total_xp, 110);
  assert.equal("token_hash" in exportResult.data.shared_reports[0], false);
  assert.equal(exportResult.data.stored_cv_files[0].name, "current-cv.pdf");

  const newerStripeEvent = await serviceRest("rpc/apply_stripe_subscription_event", {
    method: "POST",
    body: {
      p_user_id: alice.id,
      p_plan_code: "premium",
      p_subscription_id: "sub_alice",
      p_price_id: "price_premium",
      p_status: "active",
      p_cancel_at_period_end: false,
      p_current_period_end: new Date(Date.now() + 86400000).toISOString(),
      p_event_created: 200,
    },
  });
  assert.equal(newerStripeEvent.data, true);
  const staleStripeEvent = await serviceRest("rpc/apply_stripe_subscription_event", {
    method: "POST",
    body: {
      p_user_id: alice.id,
      p_plan_code: "premium",
      p_subscription_id: "sub_alice",
      p_price_id: "price_premium",
      p_status: "canceled",
      p_cancel_at_period_end: false,
      p_current_period_end: new Date(Date.now() - 86400000).toISOString(),
      p_event_created: 100,
    },
  });
  assert.equal(staleStripeEvent.data, false, "stale Stripe events must not overwrite newer state");
  const premiumAccess = await rest("rpc/get_my_account_access", alice, { method: "POST", body: {} });
  assert.equal(premiumAccess.data.plan, "premium");
  assert.equal(premiumAccess.data.rag_limit, 50);

  const deletion = await request("/functions/v1/delete-account", {
    token: bob.token,
    method: "POST",
    body: { confirmation: "DELETE" },
  });
  assert.equal(deletion.response.status, 200, JSON.stringify(deletion.data));
  assert.equal(deletion.data.deleted, true);

  console.log("Private-beta integration contract verified: invite-only auth, consent, RLS isolation, beta quotas, interview gamification, idempotent persisted analysis, quota refunds, rate limiting, feedback, export, private storage, billing isolation, and account deletion.");
} finally {
  await cleanup();
}
