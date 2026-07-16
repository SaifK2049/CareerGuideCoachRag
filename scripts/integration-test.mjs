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
  const signup = await request("/auth/v1/signup", {
    method: "POST",
    body: { email, password, data: { display_name: `${label} User` } },
  });
  assert.equal(signup.response.status, 200, JSON.stringify(signup.data));
  let token = signup.data.access_token;
  if (!token) {
    const login = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(login.response.status, 200, JSON.stringify(login.data));
    token = login.data.access_token;
  }
  const user = { id: signup.data.user.id, email, token };
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

try {
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
    },
  });
  assert.equal(onboardingUpdate.response.status, 200, JSON.stringify(onboardingUpdate.data));
  assert.equal(onboardingUpdate.data[0].onboarding_complete, true);

  const bobCannotReadAliceProfile = await rest(`career_profiles?user_id=eq.${alice.id}&select=*`, bob);
  assert.equal(bobCannotReadAliceProfile.response.status, 200);
  assert.deepEqual(bobCannotReadAliceProfile.data, []);

  for (const functionName of ["analyze-career", "create-checkout-session", "create-portal-session"]) {
    const unconfiguredFunction = await request(`/functions/v1/${functionName}`, {
      token: alice.token,
      method: "POST",
      body: {},
    });
    assert.equal(unconfiguredFunction.response.status, 503, `${functionName} should fail safely when local secrets are absent`);
  }

  const anonymousProfiles = await request("/rest/v1/career_profiles?select=user_id");
  assert.equal(anonymousProfiles.response.status, 401, "career profiles should not be granted to anon");

  const alicePathId = crypto.randomUUID();
  const firstPath = await rest("career_paths?select=*", alice, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      id: alicePathId,
      user_id: alice.id,
      name: "Platform Engineering",
      target: "Senior Platform Engineer",
      description: "Alice target",
    },
  });
  assert.equal(firstPath.response.status, 201, JSON.stringify(firstPath.data));

  const secondFreePath = await rest("career_paths", alice, {
    method: "POST",
    body: {
      id: crypto.randomUUID(),
      user_id: alice.id,
      name: "Second free path",
      target: "Architect",
      description: "",
    },
  });
  assert.equal(secondFreePath.response.ok, false, "free users must be limited to one path");

  const upsertExistingPath = await rest("career_paths?on_conflict=id&select=*", alice, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      id: alicePathId,
      user_id: alice.id,
      name: "Platform Engineering Updated",
      target: "Senior Platform Engineer",
      description: "Updated",
    },
  });
  assert.equal(upsertExistingPath.response.status, 200, JSON.stringify(upsertExistingPath.data));

  const bobCannotReadAlice = await rest(`career_paths?id=eq.${alicePathId}&select=*`, bob);
  assert.equal(bobCannotReadAlice.response.status, 200);
  assert.deepEqual(bobCannotReadAlice.data, []);

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
  assert.equal(crossTenantJob.response.ok, false, "composite ownership foreign key must reject cross-tenant paths");

  const firstJobId = crypto.randomUUID();
  const firstJob = await rest("job_descriptions", alice, {
    method: "POST",
    body: {
      id: firstJobId,
      user_id: alice.id,
      path_id: alicePathId,
      title: "Platform role 1",
      description: "Unique platform description 1",
      content_hash: "integration-hash-1",
    },
  });
  assert.equal(firstJob.response.status, 201, JSON.stringify(firstJob.data));

  const duplicateJob = await rest("job_descriptions", alice, {
    method: "POST",
    body: {
      id: crypto.randomUUID(),
      user_id: alice.id,
      path_id: alicePathId,
      title: "Duplicate role",
      description: "Duplicate normalized content",
      content_hash: "integration-hash-1",
    },
  });
  assert.equal(duplicateJob.response.ok, false, "duplicate job content hashes must be rejected");

  for (let index = 2; index <= 5; index += 1) {
    const job = await rest("job_descriptions", alice, {
      method: "POST",
      body: {
        id: crypto.randomUUID(),
        user_id: alice.id,
        path_id: alicePathId,
        title: `Platform role ${index}`,
        description: `Unique platform description ${index}`,
        content_hash: `integration-hash-${index}`,
      },
    });
    assert.equal(job.response.status, 201, JSON.stringify(job.data));
  }
  const sixthFreeJob = await rest("job_descriptions", alice, {
    method: "POST",
    body: {
      id: crypto.randomUUID(),
      user_id: alice.id,
      path_id: alicePathId,
      title: "Platform role 6",
      description: "Unique platform description 6",
      content_hash: "integration-hash-6",
    },
  });
  assert.equal(sixthFreeJob.response.ok, false, "free users must be limited to five job descriptions");

  for (let index = 1; index <= 10; index += 1) {
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
  const eleventhEvidence = await rest("knowledge_evidence", alice, {
    method: "POST",
    body: {
      id: crypto.randomUUID(),
      user_id: alice.id,
      skill: "Skill 11",
      title: "Evidence 11",
      confidence: 2,
      evidence: "This exceeds the Free allowance.",
    },
  });
  assert.equal(eleventhEvidence.response.ok, false, "free users must be limited to ten evidence records");

  for (let index = 0; index < 2; index += 1) {
    const usage = await rest("rpc/consume_feature_usage", alice, {
      method: "POST",
      body: { p_feature_key: "rag_analysis" },
    });
    assert.equal(usage.response.status, 200, JSON.stringify(usage.data));
    assert.equal(usage.data[0].allowed, true);
    assert.equal(usage.data[0].used, index + 1);
  }
  const exhausted = await rest("rpc/consume_feature_usage", alice, {
    method: "POST",
    body: { p_feature_key: "rag_analysis" },
  });
  assert.equal(exhausted.response.status, 200, JSON.stringify(exhausted.data));
  assert.equal(exhausted.data[0].allowed, false);
  assert.equal(exhausted.data[0].quota, 2);

  const access = await rest("rpc/get_my_account_access", alice, { method: "POST", body: {} });
  assert.equal(access.response.status, 200, JSON.stringify(access.data));
  assert.equal(access.data.plan, "free");
  assert.equal(access.data.rag_used, 2);
  assert.equal(access.data.rag_limit, 2);

  const unauthorizedStripeMutation = await rest("rpc/apply_stripe_subscription_event", alice, {
    method: "POST",
    body: {
      p_user_id: alice.id,
      p_plan_code: "premium",
      p_subscription_id: "sub_forbidden",
      p_price_id: "price_forbidden",
      p_status: "active",
      p_cancel_at_period_end: false,
      p_current_period_end: new Date(Date.now() + 86400000).toISOString(),
      p_event_created: 10,
    },
  });
  assert.equal(unauthorizedStripeMutation.response.ok, false, "users must not mutate Stripe state");

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
  assert.equal(newerStripeEvent.response.status, 200, JSON.stringify(newerStripeEvent.data));
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
  assert.equal(staleStripeEvent.response.status, 200, JSON.stringify(staleStripeEvent.data));
  assert.equal(staleStripeEvent.data, false, "older Stripe events must not overwrite newer state");

  const premiumAccess = await rest("rpc/get_my_account_access", alice, { method: "POST", body: {} });
  assert.equal(premiumAccess.response.status, 200, JSON.stringify(premiumAccess.data));
  assert.equal(premiumAccess.data.plan, "premium");
  assert.equal(premiumAccess.data.rag_limit, 50);

  const premiumSecondPath = await rest("career_paths", alice, {
    method: "POST",
    body: {
      id: crypto.randomUUID(),
      user_id: alice.id,
      name: "Architecture",
      target: "Solution Architect",
      description: "",
    },
  });
  assert.equal(premiumSecondPath.response.status, 201, JSON.stringify(premiumSecondPath.data));

  const pdfBytes = new TextEncoder().encode("%PDF-1.4 Masari integration fixture");
  const upload = await fetch(`${baseUrl}/storage/v1/object/private-cvs/${alice.id}/cv.pdf`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${alice.token}`,
      "Content-Type": "application/pdf",
    },
    body: pdfBytes,
  });
  assert.equal(upload.ok, true, await upload.text());

  const aliceReadsOwnCv = await fetch(`${baseUrl}/storage/v1/object/authenticated/private-cvs/${alice.id}/cv.pdf`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${alice.token}` },
  });
  assert.equal(aliceReadsOwnCv.ok, true, await aliceReadsOwnCv.text());

  const bobReadsAliceCv = await fetch(`${baseUrl}/storage/v1/object/authenticated/private-cvs/${alice.id}/cv.pdf`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${bob.token}` },
  });
  assert.equal(bobReadsAliceCv.ok, false, "private CV must not be readable by another user");

  console.log("Integration contract verified: onboarding, RLS isolation, duplicate detection, Free/Premium limits, quotas, Stripe ordering, functions, and private storage.");
} finally {
  await cleanup();
}
