import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const rawStatus = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" });
const status = JSON.parse(rawStatus.slice(rawStatus.indexOf("{")));
const baseUrl = status.API_URL;
const anonKey = status.ANON_KEY;
const serviceKey = status.SERVICE_ROLE_KEY;
const createdUsers = [];

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

async function createUser(label) {
  const email = `masari-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = "Masari-Test-Password-42!";
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
    const job = await rest("job_descriptions", alice, {
      method: "POST",
      body: {
        id: crypto.randomUUID(),
        user_id: alice.id,
        path_id: pathIds[0],
        title: `Platform role ${index}`,
        description: `Unique beta platform description ${index}`,
        content_hash: `beta-integration-hash-${index}`,
      },
    });
    assert.equal(job.response.status, 201, JSON.stringify(job.data));
  }
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

  for (let index = 1; index <= 50; index += 1) {
    const evidence = await rest("knowledge_evidence", alice, {
      method: "POST",
      body: {
        id: crypto.randomUUID(),
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

  const pdfBytes = new TextEncoder().encode("%PDF-1.4 Masari integration fixture");
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

  console.log("Private-beta integration contract verified: invite-only auth, consent, RLS isolation, beta quotas, idempotent persisted analysis, quota refunds, rate limiting, feedback, export, private storage, billing isolation, and account deletion.");
} finally {
  await cleanup();
}
