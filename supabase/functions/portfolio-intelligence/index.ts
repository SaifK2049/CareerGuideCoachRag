import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import {
  analyseGithubRepository,
  githubCoordinates,
  sha256Hex,
} from "../_shared/portfolio-intelligence.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { consumeRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { recordOperationalEvent } from "../_shared/telemetry.ts";

type Row = Record<string, any>;

async function github(path: string): Promise<any> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Orynta-Portfolio-Intelligence",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return await response.json();
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function privateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (
    normalized === "::1" || normalized === "::" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")
  ) return true;
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

async function assertPublicHttps(url: URL): Promise<void> {
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("Credential URLs must use public HTTPS endpoints.");
  }
  if (url.hostname === "localhost" || url.hostname.endsWith(".local")) {
    throw new Error("Private credential endpoints are not allowed.");
  }
  const addresses = await Promise.allSettled([
    Deno.resolveDns(url.hostname, "A"),
    Deno.resolveDns(url.hostname, "AAAA"),
  ]);
  const resolved = addresses.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!resolved.length || resolved.some(privateAddress)) {
    throw new Error("The credential endpoint must resolve only to public addresses.");
  }
}

async function fetchPublicCredential(source: URL): Promise<Response> {
  let current = source;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await assertPublicHttps(current);
    const response = await fetch(current, {
      headers: { Accept: "application/json, text/html;q=0.9" },
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("The credential source returned an invalid redirect.");
    current = new URL(location, current);
  }
  throw new Error("The credential source redirected too many times.");
}

const providerPolicies: Record<string, {
  hosts: string[];
  guidanceUrl: string;
  mechanism: string;
}> = {
  credly: {
    hosts: ["credly.com", "www.credly.com"],
    guidanceUrl: "https://support.credly.com/hc/en-us/articles/360021222071-What-is-a-badge",
    mechanism: "Credly public badge",
  },
  aws: {
    hosts: ["credly.com", "www.credly.com"],
    guidanceUrl: "https://aws.amazon.com/certification/certification-digital-badges/",
    mechanism: "AWS badge issued through Credly",
  },
  google_cloud: {
    hosts: ["credly.com", "www.credly.com"],
    guidanceUrl: "https://cloud.google.com/learn/training/credentials",
    mechanism: "Google Cloud Credential Wallet badge through Credly",
  },
  cisco: {
    hosts: ["credly.com", "www.credly.com"],
    guidanceUrl: "https://www.cisco.com/site/us/en/learn/training-certifications/certifications/digital-badges/index.html",
    mechanism: "Cisco badge issued through Credly",
  },
  microsoft_learn: {
    hosts: ["learn.microsoft.com"],
    guidanceUrl: "https://learn.microsoft.com/credentials/certifications/cred-share-validate",
    mechanism: "Microsoft Learn public verifiable credential or transcript",
  },
  azure: {
    hosts: ["learn.microsoft.com"],
    guidanceUrl: "https://learn.microsoft.com/credentials/certifications/cred-share-validate",
    mechanism: "Microsoft Learn public verifiable Azure credential",
  },
};

function providerPolicy(credential: Row, url: URL): Row | null {
  if (credential.provider === "open_badges") return null;
  const policy = providerPolicies[String(credential.provider || "")];
  if (!policy) {
    throw new Error("This provider does not expose a supported automatic verification mechanism.");
  }
  const host = url.hostname.toLowerCase();
  if (!policy.hosts.includes(host)) {
    throw new Error(`Use the provider’s public verification link from ${policy.hosts.join(" or ")}.`);
  }
  return policy;
}

async function verifyOpenBadge(credential: Row, email: string): Promise<Row> {
  const url = new URL(String(credential.credential_url || ""));
  const policy = providerPolicy(credential, url);
  const storedExpiry = credential.expires_on ? Date.parse(`${credential.expires_on}T23:59:59Z`) : NaN;
  if (Number.isFinite(storedExpiry) && storedExpiry < Date.now()) {
    return {
      verification_status: "expired",
      verification: {
        checked_at: new Date().toISOString(),
        method: "stored_expiry_check",
        source_url: url.toString(),
        provider: credential.provider,
        reason: "The stored credential expiry date has passed.",
      },
    };
  }
  const response = await fetchPublicCredential(url);
  if (!response.ok) throw new Error(`Credential source returned ${response.status}.`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json")) {
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 2_000_000) throw new Error("Credential page is too large to inspect safely.");
    const page = (await response.text()).slice(0, 2_000_000);
    const normalizedPage = page.toLowerCase();
    const nameObserved = String(credential.name || "").trim().length >= 3 &&
      normalizedPage.includes(String(credential.name).toLowerCase());
    const issuerObserved = String(credential.issuer || "").trim().length >= 3 &&
      normalizedPage.includes(String(credential.issuer).toLowerCase());
    const officialPageObserved = Boolean(policy && (nameObserved || issuerObserved));
    return {
      verification_status: officialPageObserved ? "issuer_observed" : "unverified",
      verification: {
        checked_at: new Date().toISOString(),
        method: officialPageObserved ? "official_provider_page_observation" : "public_url_reachability",
        source_url: response.url,
        provider: credential.provider,
        provider_mechanism: policy?.mechanism || "Open Badges",
        provider_guidance_url: policy?.guidanceUrl || "https://www.1edtech.org/standards/open-badges",
        credential_name_observed: nameObserved,
        issuer_name_observed: issuerObserved,
        identity_bound: false,
        reason: officialPageObserved
          ? "The credential appears on an approved provider page, but the page could not be cryptographically bound to the authenticated account."
          : "The public page is reachable, but it does not expose a machine-verifiable Open Badges assertion or matching official credential details.",
      },
    };
  }
  const assertion = await response.json() as Row;
  const recipient = assertion.recipient || {};
  const identity = String(recipient.identity || "");
  let recipientMatches = false;
  if (recipient.type === "email" && recipient.hashed === false) {
    recipientMatches = identity.toLowerCase() === email.toLowerCase();
  } else if (recipient.type === "email" && recipient.hashed === true && recipient.salt) {
    recipientMatches = await sha256Hex(`${email}${recipient.salt}`) === identity.replace(/^sha256\$/i, "");
  }
  const expiresAt = assertion.expires ? Date.parse(assertion.expires) : NaN;
  const expired = Number.isFinite(expiresAt) && expiresAt < Date.now();
  const revoked = assertion.revoked === true;
  const structurallyValid = Boolean(assertion.id && assertion.badge && assertion.issuedOn && recipient.identity);
  return {
    verification_status: revoked
      ? "revoked"
      : expired ? "expired" : structurallyValid && recipientMatches ? "verified" : "unverified",
    verification: {
      checked_at: new Date().toISOString(),
      method: "open_badges_assertion_v2",
      source_url: response.url,
      structurally_valid: structurallyValid,
      recipient_matches_authenticated_email: recipientMatches,
      revoked,
      provider: credential.provider,
      provider_mechanism: policy?.mechanism || "Open Badges assertion",
      provider_guidance_url: policy?.guidanceUrl || "https://www.1edtech.org/standards/open-badges",
      reason: recipientMatches
        ? "The Open Badges recipient matches the authenticated account email."
        : "The assertion could not be bound to the authenticated account email.",
    },
  };
}

Deno.serve(async (request) => {
  const startedAt = Date.now();
  let admin: any = null;
  let userId = "";
  let operation = "portfolio_intelligence";
  const corsResult = handleCors(request);
  if (corsResult) return corsResult;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);
  try {
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    const client = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) return jsonResponse(request, { error: "Authentication required" }, 401);
    userId = authData.user.id;
    admin = createClient<any>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const limit = await consumeRateLimit(admin, userId, "portfolio-intelligence", 20, 300);
    if (!limit.allowed) return rateLimitResponse(limit, Object.fromEntries(jsonResponse(request, {}).headers.entries()));
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");
    const id = String(body.id || "");
    if (!validUuid(id) || !["analyse_portfolio", "verify_credential"].includes(action)) {
      return jsonResponse(request, { error: "A valid action and record are required." }, 400);
    }

    if (action === "analyse_portfolio") {
      operation = "portfolio_analyse";
      const { data: asset, error } = await client.from("portfolio_assets")
        .select("*").eq("id", id).eq("user_id", userId).single();
      if (error || !asset) return jsonResponse(request, { error: "Portfolio asset not found." }, 404);
      if (asset.provider !== "github" || !asset.url) {
        return jsonResponse(request, { error: "Automated analysis currently supports public GitHub repositories." }, 422);
      }
      const coordinates = githubCoordinates(asset.url);
      if (!coordinates) return jsonResponse(request, { error: "Use a public github.com repository URL." }, 400);
      const base = `/repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repo)}`;
      const [repository, languages, readme, workflows, commits] = await Promise.all([
        github(base),
        github(`${base}/languages`),
        github(`${base}/readme`),
        github(`${base}/actions/workflows?per_page=20`),
        github(`${base}/commits?per_page=20`),
      ]);
      if (!repository || repository.private) return jsonResponse(request, { error: "The public repository was not found." }, 404);
      const report = analyseGithubRepository(
        repository,
        languages || {},
        readme,
        workflows?.workflows || [],
        Array.isArray(commits) ? commits : [],
      );
      const { data, error: updateError } = await admin.from("portfolio_assets").update({
        title: repository.name,
        description: repository.description || asset.description || "",
        external_id: `${coordinates.owner}/${coordinates.repo}`.toLowerCase(),
        technologies: report.technologies,
        analysis: report,
        evidence_refs: report.evidence_refs,
        analysed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("user_id", userId).select("*").single();
      if (updateError) throw updateError;
      await recordOperationalEvent(admin, { userId, operation, outcome: "succeeded", latencyMs: Date.now() - startedAt, model: report.methodology_version });
      return jsonResponse(request, { asset: data });
    }

    operation = "credential_verify";
    const { data: credential, error } = await client.from("career_credentials")
      .select("*").eq("id", id).eq("user_id", userId).single();
    if (error || !credential) return jsonResponse(request, { error: "Credential not found." }, 404);
    if (!credential.credential_url) return jsonResponse(request, { error: "Add a public credential URL before verification." }, 422);
    const result = await verifyOpenBadge(credential, String(authData.user.email || ""));
    const { data, error: updateError } = await admin.from("career_credentials").update({
      ...result,
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("user_id", userId).select("*").single();
    if (updateError) throw updateError;
    await recordOperationalEvent(admin, { userId, operation, outcome: "succeeded", latencyMs: Date.now() - startedAt, model: "credential-provider-verification-v2" });
    return jsonResponse(request, { credential: data });
  } catch (error) {
    await recordOperationalEvent(admin, {
      userId: userId || undefined,
      operation,
      outcome: "failed",
      errorCode: "PORTFOLIO_INTELLIGENCE_FAILED",
      latencyMs: Date.now() - startedAt,
    });
    return jsonResponse(request, {
      error: error instanceof Error ? error.message : "Portfolio intelligence could not be completed.",
      code: "PORTFOLIO_INTELLIGENCE_FAILED",
    }, 502);
  }
});
