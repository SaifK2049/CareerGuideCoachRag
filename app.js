const STORAGE_KEY = "career-rag-workspace-v1";
const PRIVACY_NOTICE_VERSION = "2026-07-16";
const config = window.CAREER_RAG_CONFIG || {};
const betaMode = config.betaMode !== false;
const billingEnabled = config.billingEnabled === true;
const signupEnabled = config.signupEnabled === true;
const cloud = config.supabaseUrl && config.supabasePublishableKey && window.supabase
  ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey)
  : null;
["termsLink", "appTermsLink"].forEach(function(id) {
  if (config.termsUrl) document.getElementById(id).href = config.termsUrl;
});
["privacyLink", "appPrivacyLink"].forEach(function(id) {
  if (config.privacyUrl) document.getElementById(id).href = config.privacyUrl;
});
document.getElementById("signupPrompt").classList.toggle("hidden", !signupEnabled);
document.getElementById("feedbackButton").classList.toggle("hidden", config.feedbackEnabled === false);
let session = null;
let cloudReady = false;
let saveQueue = Promise.resolve();
let accountAccess = { plan: "free", status: "free", rag_used: 0, rag_limit: betaMode ? 10 : 2, features: {} };
let onboardingStep = 1;
const pendingAnalysisRequests = {};
const captchaTokens = { signin: "", signup: "" };
const turnstileWidgets = { signin: null, signup: null };

function ensureTurnstile(kind) {
  if (!config.turnstileSiteKey || !window.turnstile || turnstileWidgets[kind] !== null) return;
  const container = document.getElementById(kind + "Turnstile");
  if (!container) return;
  turnstileWidgets[kind] = window.turnstile.render(container, {
    sitekey: config.turnstileSiteKey,
    theme: "light",
    callback: function(token) { captchaTokens[kind] = token; },
    "expired-callback": function() { captchaTokens[kind] = ""; },
    "error-callback": function() { captchaTokens[kind] = ""; }
  });
}

function requireCaptcha(kind, message) {
  if (!config.turnstileSiteKey || captchaTokens[kind]) return true;
  ensureTurnstile(kind);
  message.classList.remove("is-success");
  message.textContent = "Complete the security check and try again.";
  return false;
}

function resetTurnstile(kind) {
  captchaTokens[kind] = "";
  if (window.turnstile && turnstileWidgets[kind] !== null) window.turnstile.reset(turnstileWidgets[kind]);
}

window.onTurnstileLoad = function() { ensureTurnstile("signin"); };

const SKILLS = {
  AWS: ["aws", "amazon web services"],
  Azure: ["azure", "microsoft azure"],
  GCP: ["gcp", "google cloud"],
  Kubernetes: ["kubernetes", "k8s"],
  Docker: ["docker", "containerization", "containers"],
  Terraform: ["terraform", "infrastructure as code", "iac"],
  Python: ["python"],
  Java: ["java"],
  JavaScript: ["javascript"],
  TypeScript: ["typescript"],
  SQL: ["sql", "postgresql", "mysql"],
  Git: ["git", "github", "gitlab"],
  "CI/CD": ["ci/cd", "continuous integration", "continuous delivery", "jenkins", "github actions"],
  Linux: ["linux", "unix"],
  Networking: ["networking", "tcp/ip", "dns", "load balancing"],
  Security: ["security", "iam", "identity and access", "vulnerability"],
  Observability: ["observability", "monitoring", "prometheus", "grafana", "logging"],
  "REST APIs": ["rest api", "restful", "api design"],
  Microservices: ["microservices", "distributed systems"],
  "Agile delivery": ["agile", "scrum", "kanban"],
  "Power BI": ["power bi", "business intelligence"],
  Kafka: ["kafka", "event streaming"],
  "Project management": ["project management", "stakeholder management", "roadmap"]
};

const CERTS = {
  AWS: ["AWS Certified Solutions Architect – Associate", "https://aws.amazon.com/certification/certified-solutions-architect-associate/"],
  Azure: ["Microsoft Certified: Azure Administrator Associate", "https://learn.microsoft.com/credentials/certifications/azure-administrator/"],
  GCP: ["Google Cloud Associate Cloud Engineer", "https://cloud.google.com/learn/certification/cloud-engineer"],
  Kubernetes: ["Certified Kubernetes Administrator (CKA)", "https://training.linuxfoundation.org/certification/certified-kubernetes-administrator-cka/"],
  Terraform: ["HashiCorp Certified: Terraform Associate", "https://developer.hashicorp.com/certifications/infrastructure-automation"],
  Security: ["CompTIA Security+", "https://www.comptia.org/certifications/security"],
  "Power BI": ["Microsoft Certified: Power BI Data Analyst Associate", "https://learn.microsoft.com/credentials/certifications/data-analyst-associate/"],
  "Project management": ["PMP Certification", "https://www.pmi.org/certifications/project-management-pmp"]
};

const demoState = {
  profile: { displayName: "Demo user", careerGoal: "Explore Masari", experienceLevel: "mid", country: "", onboardingComplete: true, betaTermsAcceptedAt: "2026-07-16T00:00:00.000Z", privacyNoticeVersion: PRIVACY_NOTICE_VERSION },
  activePathId: "path-cloud",
  cv: { fileName: "", text: "", uploadedAt: "" },
  paths: [{
    id: "path-cloud",
    name: "Cloud Platform Engineering",
    target: "Senior Cloud / Platform Engineer",
    description: "Build evidence across the infrastructure, delivery, and reliability skills employers are asking for.",
    jobs: [
      { id: "job-1", title: "Senior Platform Engineer", company: "Northstar Systems", location: "Berlin · Hybrid", source: "", description: "We are looking for a Senior Platform Engineer to build reliable cloud infrastructure. Required experience with AWS, Kubernetes, Terraform, Linux, Docker, and CI/CD. You will improve observability, automate infrastructure, and work with development teams in an Agile environment.", createdAt: "2026-07-14T10:00:00.000Z" },
      { id: "job-2", title: "Cloud Infrastructure Engineer", company: "Helix Data", location: "Remote · EU", source: "", description: "Own cloud platforms running on AWS or Azure. Strong Terraform and infrastructure as code experience is preferred. You should understand networking, IAM and security, container platforms, monitoring, and incident response. Python or another automation language is a plus.", createdAt: "2026-07-13T10:00:00.000Z" }
    ]
  }],
  knowledge: [
    { id: "know-1", skill: "Python", title: "Automation scripts and internal tooling", level: 3, evidence: "Built recurring data and deployment utilities in Python for operational workflows." },
    { id: "know-2", skill: "Git", title: "Team delivery workflows", level: 3, evidence: "Use Git-based review and release workflows across projects." },
    { id: "know-3", skill: "SQL", title: "Data querying", level: 2, evidence: "Working knowledge of relational queries and reporting datasets." }
  ],
  analyses: []
};

let state = loadState();
let activeView = "overview";

function loadState() {
  if (!config.localPreview) return emptyState();
  try { return JSON.parse(localStorage.getItem(cacheKey())) || structuredClone(demoState); }
  catch (error) { return structuredClone(demoState); }
}

function cacheKey() { return session ? STORAGE_KEY + ":" + session.user.id : STORAGE_KEY + ":preview"; }

function saveState() {
  if (config.localPreview) localStorage.setItem(cacheKey(), JSON.stringify(state));
  const label = document.getElementById("saveState");
  if (label) label.textContent = session ? "Saving…" : "Local preview";
  if (session && cloudReady) {
    saveQueue = saveQueue.then(persistCloudState).catch(async function(error) {
      if (label) label.textContent = "Cloud save failed";
      toast(error.message || "Could not save to the cloud");
      await loadCloudState();
      render();
    });
  }
  return saveQueue;
}

function emptyState() {
  return {
    profile: { displayName: "", careerGoal: "", experienceLevel: "", country: "", onboardingComplete: false, betaTermsAcceptedAt: "", privacyNoticeVersion: "" },
    activePathId: "",
    cv: { fileName: "", text: "", uploadedAt: "" },
    paths: [],
    knowledge: [],
    analyses: []
  };
}

async function loadCloudState() {
  const userId = session.user.id;
  const results = await Promise.all([
    cloud.from("career_profiles").select("*").eq("user_id", userId).maybeSingle(),
    cloud.from("career_paths").select("*").eq("user_id", userId).order("created_at"),
    cloud.from("job_descriptions").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    cloud.from("knowledge_evidence").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    cloud.from("career_analyses").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
    cloud.rpc("get_my_account_access")
  ]);
  results.forEach(function(result) { if (result.error) throw result.error; });
  const profile = results[0].data;
  const paths = (results[1].data || []).map(function(path) {
    return {
      id: path.id, name: path.name, target: path.target, description: path.description,
      jobs: (results[2].data || []).filter(function(job) { return job.path_id === path.id; }).map(function(job) {
        return { id: job.id, title: job.title, company: job.company, location: job.location, source: job.source_url, description: job.description, createdAt: job.created_at };
      })
    };
  });
  state = {
    profile: {
      displayName: profile && profile.display_name || session.user.user_metadata && session.user.user_metadata.display_name || "",
      careerGoal: profile && profile.career_goal || "",
      experienceLevel: profile && profile.experience_level || "",
      country: profile && profile.country || "",
      onboardingComplete: Boolean(profile && profile.onboarding_complete),
      betaTermsAcceptedAt: profile && profile.beta_terms_accepted_at || "",
      privacyNoticeVersion: profile && profile.privacy_notice_version || ""
    },
    activePathId: profile && profile.active_path_id || (paths[0] && paths[0].id) || "",
    cv: { fileName: profile && profile.cv_file_name || "", text: profile && profile.cv_text || "", uploadedAt: profile && profile.cv_uploaded_at || "" },
    paths: paths,
    knowledge: (results[3].data || []).map(function(item) {
      return { id: item.id, skill: item.skill, title: item.title, level: item.confidence, evidence: item.evidence };
    }),
    analyses: (results[4].data || []).map(normalizeAnalysisRecord)
  };
  accountAccess = results[5].data || accountAccess;
}

async function deleteMissing(table, ids) {
  let query = cloud.from(table).delete().eq("user_id", session.user.id);
  if (ids.length) query = query.not("id", "in", "(" + ids.join(",") + ")");
  const result = await query;
  if (result.error) throw result.error;
}

async function contentHash(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(bytes)).map(function(byte) { return byte.toString(16).padStart(2, "0"); }).join("");
}

async function persistCloudState() {
  const userId = session.user.id;
  const pendingState = structuredClone(state);
  const pathRows = pendingState.paths.map(function(path) { return { id: path.id, user_id: userId, name: path.name, target: path.target, description: path.description || "", updated_at: new Date().toISOString() }; });
  const jobRows = await Promise.all(pendingState.paths.flatMap(function(path) {
    return path.jobs.map(async function(job) {
      return {
        id: job.id, user_id: userId, path_id: path.id, title: job.title,
        company: job.company || "", location: job.location || "", source_url: job.source || "",
        description: job.description, content_hash: await contentHash(job.description),
        updated_at: new Date().toISOString()
      };
    });
  }));
  const evidenceRows = pendingState.knowledge.map(function(item) { return { id: item.id, user_id: userId, skill: item.skill, title: item.title, confidence: item.level, evidence: item.evidence, updated_at: new Date().toISOString() }; });
  for (const item of [[pathRows, "career_paths"], [jobRows, "job_descriptions"], [evidenceRows, "knowledge_evidence"]]) {
    if (item[0].length) {
      const result = await cloud.from(item[1]).upsert(item[0]);
      if (result.error) throw result.error;
    }
  }
  const profileResult = await cloud.from("career_profiles").upsert({
    user_id: userId, active_path_id: pendingState.activePathId || null, cv_file_name: pendingState.cv.fileName || "",
    cv_text: pendingState.cv.text || "", cv_uploaded_at: pendingState.cv.uploadedAt || null,
    display_name: pendingState.profile.displayName || "", career_goal: pendingState.profile.careerGoal || "",
    experience_level: pendingState.profile.experienceLevel || "", country: pendingState.profile.country || "",
    onboarding_complete: Boolean(pendingState.profile.onboardingComplete),
    beta_terms_accepted_at: pendingState.profile.betaTermsAcceptedAt || null,
    privacy_notice_version: pendingState.profile.privacyNoticeVersion || null,
    updated_at: new Date().toISOString()
  });
  if (profileResult.error) throw profileResult.error;
  await deleteMissing("job_descriptions", jobRows.map(function(row) { return row.id; }));
  await deleteMissing("knowledge_evidence", evidenceRows.map(function(row) { return row.id; }));
  await deleteMissing("career_paths", pathRows.map(function(row) { return row.id; }));
  document.getElementById("saveState").textContent = "Saved privately";
}

function activePath() {
  return state.paths.find(function(path) { return path.id === state.activePathId; }) || state.paths[0];
}

function canAdd(featureKey, currentCount) {
  const feature = accountAccess.features && accountAccess.features[featureKey];
  return !feature || feature.quota === null || currentCount < Number(feature.quota);
}

function safe(value) {
  return String(value || "").replace(/[&<>'"]/g, function(char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char];
  });
}

function normalizeAnalysisRecord(record) {
  return {
    id: record.id,
    requestId: record.request_id || record.requestId,
    pathId: record.path_id || record.pathId,
    targetRole: record.target_role || record.targetRole || "",
    status: record.status || "succeeded",
    summary: record.summary || "",
    findings: Array.isArray(record.findings) ? record.findings : [],
    sources: Array.isArray(record.sources) ? record.sources : [],
    model: record.model || "",
    createdAt: record.created_at || record.createdAt || "",
    completedAt: record.completed_at || record.completedAt || ""
  };
}

function renderAnalysisResult(path) {
  const box = document.getElementById("ragResult");
  const analysis = path && (state.analyses || []).find(function(item) {
    return item.pathId === path.id && item.status === "succeeded";
  });
  if (!analysis) {
    box.innerHTML = '<div class="empty-state">Run a cited analysis after adding your CV or knowledge evidence and at least one job description. Successful results are saved here.</div>';
    return;
  }
  const sourceMap = Object.fromEntries((analysis.sources || []).map(function(source) {
    return [source.label, source];
  }));
  box.innerHTML = '<div class="analysis-result"><div class="analysis-result-head"><strong>Private cited analysis</strong><span>' +
    safe(formatDate(analysis.completedAt || analysis.createdAt)) + '</span></div><p class="analysis-summary">' +
    safe(analysis.summary) + '</p><div class="analysis-findings">' +
    (analysis.findings || []).map(function(item, findingIndex) {
      const badgeClass = item.confidence === "strong" ? "good" : item.confidence === "partial" || item.confidence === "uncertain" ? "warn" : "gap";
      return '<article class="analysis-finding"><div class="analysis-finding-head"><strong>' + safe(item.skill) +
        '</strong><span class="skill-badge ' + badgeClass + '">' + safe(item.confidence) + '</span></div><p>' +
        safe(item.explanation) + '</p><div class="citation-list">' +
        (item.citations || []).map(function(label) {
          const source = sourceMap[label] || {};
          const title = source.title || source.source_type || "Private source";
          const detailId = "citation-" + findingIndex + "-" + String(label).replace(/[^A-Za-z0-9-]/g, "");
          return '<button type="button" class="citation-button" data-citation-target="' + detailId + '">' +
            safe(label) + ' · ' + safe(title) + '</button><div class="citation-detail" id="' + detailId + '"><strong>' +
            safe(source.source_type || "source") + (source.company ? " · " + source.company : "") +
            '</strong><br />' + safe(source.excerpt || "The source excerpt is unavailable.") + '</div>';
        }).join("") + '</div></article>';
    }).join("") + '</div></div>';
  box.querySelectorAll("[data-citation-target]").forEach(function(button) {
    button.addEventListener("click", function() {
      const detail = document.getElementById(button.dataset.citationTarget);
      if (detail) detail.classList.toggle("is-visible");
    });
  });
}

function countOccurrences(text, aliases) {
  const source = String(text || "").toLowerCase();
  return aliases.reduce(function(total, alias) {
    let count = 0;
    let start = 0;
    const item = alias.toLowerCase();
    while (source.indexOf(item, start) !== -1) {
      count += 1;
      start = source.indexOf(item, start) + item.length;
    }
    return total + count;
  }, 0);
}

function analysisFor(path) {
  const jobText = (path.jobs || []).map(function(job) { return job.description; }).join(" ");
  const evidenceText = [state.cv.text].concat(state.knowledge.map(function(item) { return item.skill + " " + item.title + " " + item.evidence; })).join(" ");
  return Object.keys(SKILLS).map(function(skill) {
    const demand = countOccurrences(jobText, SKILLS[skill]);
    const evidence = countOccurrences(evidenceText, SKILLS[skill]);
    const knowledge = state.knowledge.filter(function(item) { return item.skill.toLowerCase() === skill.toLowerCase(); }).reduce(function(max, item) { return Math.max(max, Number(item.level) || 0); }, 0);
    const coverage = demand ? Math.min(100, Math.round(((evidence + knowledge) / (demand + 1)) * 62)) : 0;
    return { skill: skill, demand: demand, evidence: evidence, knowledge: knowledge, coverage: coverage };
  }).filter(function(item) { return item.demand > 0; }).sort(function(a, b) {
    return (b.demand * (100 - b.coverage)) - (a.demand * (100 - a.coverage));
  });
}

function splitText(text, size, overlap) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const chunks = [];
  let start = 0;
  size = size || 900;
  overlap = overlap || 120;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(".", end);
      if (boundary > start + 300) end = boundary + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function ragDocuments() {
  const docs = [];
  if (state.cv.text) splitText(state.cv.text).forEach(function(text, index) {
    docs.push({ id: "cv-" + (index + 1), source_type: "cv", text: text, metadata: { source_id: "cv", file_name: state.cv.fileName || "cv-text", chunk_index: index } });
  });
  state.knowledge.forEach(function(item) {
    docs.push({ id: item.id, source_type: "knowledge", text: item.skill + ": " + item.title + ". " + item.evidence, metadata: { source_id: item.id, chunk_index: 0, skill: item.skill, confidence: item.level } });
  });
  state.paths.forEach(function(path) {
    path.jobs.forEach(function(job) {
      splitText(job.description).forEach(function(text, index) {
        docs.push({ id: job.id + "-" + (index + 1), source_type: "job_description", text: text, metadata: { source_id: job.id, chunk_index: index, path_id: path.id, path: path.name, target: path.target, job_title: job.title, company: job.company, source_url: job.source || "" } });
      });
    });
  });
  return docs;
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value)) : "";
}

function renderAccount() {
  const premium = accountAccess.plan === "premium";
  const hasBilling = !["free", "canceled", "incomplete_expired"].includes(accountAccess.status || "free");
  const betaAccess = betaMode && !premium;
  const name = state.profile.displayName || (session && session.user.email && session.user.email.split("@")[0]) || "there";
  document.getElementById("welcomeLabel").textContent = "Welcome, " + name;
  ["planBadge", "membershipBadge"].forEach(function(id) {
    const badge = document.getElementById(id);
    badge.textContent = premium ? "Premium" : betaAccess ? "Beta" : "Free";
    badge.classList.toggle("is-premium", premium);
  });
  document.getElementById("upgradeButton").classList.toggle("hidden", premium || !billingEnabled);
  document.getElementById("membershipActionButton").classList.toggle("hidden", !billingEnabled);
  document.getElementById("membershipName").textContent = premium ? "Masari Premium" : betaAccess ? "Masari Private Beta" : "Masari Free";
  document.getElementById("membershipDescription").textContent = premium
    ? "Advanced career analysis and planning are active."
    : betaAccess
      ? "Your invited beta access includes private cloud storage and cited analysis."
      : "Build your baseline with limited monthly AI analysis.";
  const used = Number(accountAccess.rag_used || 0);
  const limit = Number(accountAccess.rag_limit || 0);
  document.getElementById("analysisUsage").textContent = used + " / " + (limit || "—");
  document.getElementById("analysisUsageBar").style.width = limit ? Math.min(100, Math.round(used / limit * 100)) + "%" : "0%";
  document.getElementById("membershipActionButton").textContent = premium || hasBilling ? "Manage billing" : "Upgrade to Premium";
}

function render() {
  renderAccount();
  const path = activePath();
  if (!path) {
    document.getElementById("activePathName").textContent = "Create a job path";
    document.getElementById("activePathDescription").textContent = "Add a target role, then collect job descriptions against it.";
    document.getElementById("activePathTarget").textContent = "No target selected";
    document.getElementById("activePathJobCount").textContent = "0 jobs tracked";
    document.getElementById("jobsStat").textContent = "0";
    document.getElementById("knowledgeStat").textContent = state.knowledge.length;
    document.getElementById("documentsStat").textContent = ragDocuments().length;
    document.getElementById("readinessScore").textContent = "0%";
    document.getElementById("readinessBar").style.width = "0%";
    document.getElementById("topGapStat").textContent = "Add data";
    renderSkills([]);
    renderFocus([]);
    renderAnalysisResult(null);
    renderJobs(document.getElementById("recentJobs"), []);
    document.getElementById("pathList").innerHTML = '<div class="empty-state">Create your first job path.</div>';
    document.getElementById("pathJobs").innerHTML = '<div class="empty-state">No jobs yet.</div>';
    renderKnowledge();
    renderProfile();
    return;
  }
  const items = analysisFor(path);
  const score = items.length ? Math.round(items.reduce(function(sum, item) { return sum + item.coverage; }, 0) / items.length) : 0;
  const top = items[0];
  document.getElementById("activePathName").textContent = path.name;
  document.getElementById("activePathDescription").textContent = path.description || "Build evidence toward this target role.";
  document.getElementById("activePathTarget").textContent = path.target;
  document.getElementById("activePathJobCount").textContent = path.jobs.length + (path.jobs.length === 1 ? " job tracked" : " jobs tracked");
  document.getElementById("readinessScore").textContent = score + "%";
  document.getElementById("readinessBar").style.width = score + "%";
  document.getElementById("readinessNote").textContent = score >= 70 ? "Your evidence covers recurring requirements. Close the highest-value gaps below." : "Add your CV and knowledge evidence to establish a stronger baseline.";
  document.getElementById("jobsStat").textContent = path.jobs.length;
  document.getElementById("knowledgeStat").textContent = state.knowledge.length;
  document.getElementById("documentsStat").textContent = ragDocuments().length;
  document.getElementById("topGapStat").textContent = top ? top.skill : "Add data";
  document.getElementById("topGapFoot").textContent = top ? top.demand + " demand signal" + (top.demand === 1 ? "" : "s") : "from job demand";
  renderSkills(items);
  renderFocus(items);
  renderAnalysisResult(path);
  renderJobs(document.getElementById("recentJobs"), path.jobs.slice(0, 5));
  renderPaths(path);
  renderKnowledge();
  renderProfile();
  document.getElementById("pageTitle").textContent = activeView === "overview" ? "Overview" : activeView === "paths" ? "Job paths" : activeView === "knowledge" ? "Knowledge" : "Profile & CV";
}

function renderSkills(items) {
  const box = document.getElementById("skillLandscape");
  if (!items.length) { box.innerHTML = '<div class="empty-state">Add your first job description to see recurring skill demand.</div>'; return; }
  box.innerHTML = items.slice(0, 8).map(function(item) {
    const kind = item.coverage >= 70 ? "good" : item.coverage >= 35 ? "warn" : "gap";
    const label = item.coverage >= 70 ? "Covered" : item.coverage >= 35 ? "Partial" : "Gap";
    return '<div class="skill-row"><div><div class="skill-name">' + safe(item.skill) + '</div><span class="skill-badge ' + kind + '">' + label + '</span></div><div class="skill-demand"><div class="skill-demand-line"><span>' + item.demand + ' demand signal' + (item.demand === 1 ? "" : "s") + '</span><span>' + ((item.evidence || item.knowledge) ? "Evidence found" : "No evidence yet") + '</span></div><div class="meter-track"><span style="width:' + item.coverage + '%"></span></div></div><div class="skill-score ' + kind + '">' + item.coverage + '%</div></div>';
  }).join("");
}

function renderFocus(items) {
  const box = document.getElementById("focusPlan");
  if (!items.length) { box.innerHTML = '<div class="empty-state">Your plan will appear once you add a job description.</div>'; return; }
  box.innerHTML = items.slice(0, 3).map(function(item, index) {
    const cert = CERTS[item.skill];
    const action = item.coverage < 35 ? "Build evidence for " + item.skill + " before choosing a certification." : "Strengthen your " + item.skill + " evidence with one measurable project.";
    const link = cert ? '<a class="focus-link" href="' + cert[1] + '" target="_blank" rel="noreferrer">' + safe(cert[0]) + ' ↗</a>' : "";
    return '<div class="focus-item"><span class="focus-number">0' + (index + 1) + '</span><div><strong>' + safe(item.skill) + ' · ' + (item.coverage < 35 ? "close the gap" : "make it visible") + '</strong><p>' + action + '</p>' + link + '</div></div>';
  }).join("");
}

function renderJobs(box, jobs) {
  if (!jobs.length) { box.innerHTML = '<div class="empty-state">No job entries yet. Add a description to start measuring demand.</div>'; return; }
  box.innerHTML = jobs.map(function(job) {
    return '<div class="job-row"><div class="job-title-wrap"><div class="job-title">' + safe(job.title) + '</div><span>' + safe(job.description.slice(0, 95)) + (job.description.length > 95 ? "…" : "") + '</span></div><div class="job-company">' + safe(job.company || "Independent") + '</div><div class="job-location">' + safe(job.location || "Location not set") + '</div><button class="row-action" data-edit-job="' + job.id + '" aria-label="Edit job" title="Edit job">✎</button></div>';
  }).join("");
  box.querySelectorAll("[data-edit-job]").forEach(function(button) { button.addEventListener("click", function() { openJobModal(button.dataset.editJob); }); });
}

function renderPaths(path) {
  const list = document.getElementById("pathList");
  list.innerHTML = state.paths.map(function(item) {
    return '<button class="path-card ' + (item.id === path.id ? "is-active" : "") + '" data-select-path="' + item.id + '"><strong>' + safe(item.name) + '</strong><span>' + safe(item.target) + " · " + item.jobs.length + " jobs</span></button>";
  }).join("");
  list.querySelectorAll("[data-select-path]").forEach(function(button) { button.addEventListener("click", function() { state.activePathId = button.dataset.selectPath; saveState(); render(); }); });
  document.getElementById("pathDetailName").textContent = path.name;
  document.getElementById("pathDetailDescription").textContent = path.description || "Build evidence toward this target role.";
  document.getElementById("pathDetailTarget").textContent = path.target;
  document.getElementById("pathDetailCount").textContent = path.jobs.length + " tracked job" + (path.jobs.length === 1 ? "" : "s");
  renderJobs(document.getElementById("pathJobs"), path.jobs);
}

function renderKnowledge() {
  const list = document.getElementById("knowledgeList");
  const coverage = state.knowledge.length ? Math.min(100, Math.round(state.knowledge.reduce(function(sum, item) { return sum + Number(item.level || 0); }, 0) / (state.knowledge.length * 3) * 100)) : 0;
  document.getElementById("knowledgeCoverage").textContent = coverage + "%";
  document.getElementById("knowledgeCoverageBar").style.width = coverage + "%";
  document.getElementById("knowledgeCoverageText").textContent = state.knowledge.length ? state.knowledge.length + " evidence item" + (state.knowledge.length === 1 ? "" : "s") + " connected to your baseline." : "No knowledge entries yet.";
  if (!state.knowledge.length) { list.innerHTML = '<div class="panel empty-state">Add evidence for skills you have practiced, studied, or delivered in a project.</div>'; return; }
  list.innerHTML = state.knowledge.map(function(item) {
    const dots = [1, 2, 3].map(function(level) { return '<i class="' + (level <= item.level ? "is-filled" : "") + '"></i>'; }).join("");
    return '<article class="knowledge-item"><div class="knowledge-item-top"><div><div class="skill-tag">' + safe(item.skill) + '</div><h3>' + safe(item.title) + '</h3></div><div class="confidence" aria-label="Confidence ' + item.level + ' of 3">' + dots + '</div></div><p>' + safe(item.evidence) + '</p><button class="text-button" data-edit-knowledge="' + item.id + '">Edit evidence <span>↗</span></button></article>';
  }).join("");
  list.querySelectorAll("[data-edit-knowledge]").forEach(function(button) { button.addEventListener("click", function() { openKnowledgeModal(button.dataset.editKnowledge); }); });
}

function renderProfile() {
  document.getElementById("profileDisplayName").value = state.profile.displayName || "";
  document.getElementById("profileCareerGoal").value = state.profile.careerGoal || "";
  document.getElementById("profileExperience").value = state.profile.experienceLevel || "";
  document.getElementById("profileCountry").value = state.profile.country || "";
  document.getElementById("cvText").value = state.cv.text || "";
  document.getElementById("cvStatus").textContent = state.cv.fileName || (state.cv.text ? "Pasted CV evidence" : "No CV uploaded");
  const details = document.getElementById("cvFileDetails");
  details.classList.toggle("hidden", !state.cv.fileName);
  if (state.cv.fileName) details.textContent = state.cv.fileName + " · extracted " + formatDate(state.cv.uploadedAt);
}

function openModal(id) { document.getElementById(id).classList.add("is-open"); document.getElementById(id).setAttribute("aria-hidden", "false"); }
function closeModal(id) { document.getElementById(id).classList.remove("is-open"); document.getElementById(id).setAttribute("aria-hidden", "true"); }

function openPathModal(path) {
  document.getElementById("pathId").value = path ? path.id : "";
  document.getElementById("pathName").value = path ? path.name : "";
  document.getElementById("pathTarget").value = path ? path.target : "";
  document.getElementById("pathDescription").value = path ? path.description : "";
  document.getElementById("pathModalTitle").textContent = path ? "Edit job path" : "Create a job path";
  openModal("pathModal");
}

function openJobModal(jobId) {
  const path = activePath();
  const job = path && path.jobs.find(function(item) { return item.id === jobId; });
  document.getElementById("jobId").value = job ? job.id : "";
  document.getElementById("jobTitle").value = job ? job.title : "";
  document.getElementById("jobCompany").value = job ? job.company : "";
  document.getElementById("jobLocation").value = job ? job.location : "";
  document.getElementById("jobSource").value = job ? job.source : "";
  document.getElementById("jobDescription").value = job ? job.description : "";
  document.getElementById("jobModalTitle").textContent = job ? "Edit job description" : "Add job to " + (path ? path.name : "this path");
  openModal("jobModal");
}

function openKnowledgeModal(id) {
  const item = state.knowledge.find(function(entry) { return entry.id === id; });
  document.getElementById("knowledgeId").value = item ? item.id : "";
  document.getElementById("knowledgeSkill").value = item ? item.skill : "";
  document.getElementById("knowledgeTitle").value = item ? item.title : "";
  document.getElementById("knowledgeLevel").value = item ? item.level : "2";
  document.getElementById("knowledgeEvidence").value = item ? item.evidence : "";
  document.getElementById("knowledgeModalTitle").textContent = item ? "Edit knowledge evidence" : "Add knowledge evidence";
  openModal("knowledgeModal");
}

function toast(message) {
  const box = document.getElementById("toast");
  box.textContent = message;
  box.classList.add("is-visible");
  clearTimeout(box._timer);
  box._timer = setTimeout(function() { box.classList.remove("is-visible"); }, 2600);
}

async function functionErrorMessage(error, fallback) {
  try {
    const context = error && error.context;
    if (context && typeof context.clone === "function") {
      const payload = await context.clone().json();
      if (payload.code === "RATE_LIMITED") {
        return "Too many requests. Try again in " + Number(payload.retry_after_seconds || 1) + " seconds.";
      }
      if (payload.error) return payload.error;
    }
  } catch (_error) {}
  return error && error.message || fallback;
}

function downloadJson(payload, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  link.download = fileName;
  link.click();
  window.setTimeout(function() { URL.revokeObjectURL(link.href); }, 1000);
}

async function exportAccount() {
  if (config.localPreview) {
    downloadJson({
      schema_version: "1.0",
      product: "Masari",
      exported_at: new Date().toISOString(),
      local_preview: true,
      workspace: state,
      rag_documents: ragDocuments()
    }, "masari-account-export.json");
    toast("Preview account data exported");
    return;
  }
  if (!cloud || !session) { toast("Sign in before exporting account data"); return; }
  const button = document.getElementById("exportButton");
  button.disabled = true;
  try {
    await saveQueue;
    const result = await cloud.functions.invoke("export-account", { body: {} });
    if (result.error) throw result.error;
    downloadJson(result.data, "masari-account-export.json");
    toast("Private account data exported");
  } catch (error) {
    toast(await functionErrorMessage(error, "Account export failed"));
  } finally {
    button.disabled = false;
  }
}

async function extractPdf(file) {
  if (!window.pdfjsLib) throw new Error("PDF parser is still loading. Try again.");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map(function(item) { return item.str; }).join(" "));
  }
  const extracted = pages.join("\n\n").replace(/[ \t]+/g, " ").trim();
  if (extracted.length < 50) {
    throw new Error("This PDF appears to be scanned or image-only. Paste the CV text, or upload a text-based PDF.");
  }
  return extracted;
}

function setView(view) {
  activeView = view;
  document.querySelectorAll(".view").forEach(function(section) { section.classList.toggle("is-visible", section.id === view + "View"); });
  document.querySelectorAll(".nav-item").forEach(function(button) { button.classList.toggle("is-active", button.dataset.view === view); });
  render();
}

function showSurface(surface) {
  document.getElementById("authGate").classList.toggle("hidden", surface !== "auth");
  document.getElementById("onboardingGate").classList.toggle("hidden", surface !== "onboarding");
  document.getElementById("appShell").classList.toggle("hidden", surface !== "app");
}

function setOnboardingStep(step) {
  onboardingStep = Math.max(1, Math.min(3, step));
  document.querySelectorAll("[data-onboarding-step]").forEach(function(panel) {
    panel.classList.toggle("hidden", Number(panel.dataset.onboardingStep) !== onboardingStep);
  });
  document.querySelectorAll("[data-step-dot]").forEach(function(dot) {
    dot.classList.toggle("is-active", Number(dot.dataset.stepDot) <= onboardingStep);
  });
  document.getElementById("onboardingBackButton").classList.toggle("hidden", onboardingStep === 1);
  document.getElementById("onboardingNextButton").classList.toggle("hidden", onboardingStep === 3);
  document.getElementById("onboardingFinishButton").classList.toggle("hidden", onboardingStep !== 3);
}

function showSignedInSurface() {
  if (!state.profile.onboardingComplete) {
    document.getElementById("onboardingName").value = state.profile.displayName || "";
    document.getElementById("onboardingGoal").value = state.profile.careerGoal || "";
    document.getElementById("onboardingExperience").value = state.profile.experienceLevel || "";
    setOnboardingStep(1);
    showSurface("onboarding");
  } else {
    showSurface("app");
    render();
    if (betaMode && !hasCurrentBetaConsent()) {
      window.setTimeout(function() { openModal("betaConsentModal"); }, 0);
    }
  }
}

function hasCurrentBetaConsent() {
  return Boolean(
    state.profile.betaTermsAcceptedAt &&
    state.profile.privacyNoticeVersion === PRIVACY_NOTICE_VERSION
  );
}

async function refreshAccountAccess() {
  const result = await cloud.rpc("get_my_account_access");
  if (result.error) throw result.error;
  accountAccess = result.data || accountAccess;
  renderAccount();
}

async function confirmBillingActivation(attempt) {
  try {
    await refreshAccountAccess();
    if (accountAccess.plan === "premium") { toast("Masari Premium is now active"); return; }
  } catch (_error) {}
  if (attempt < 5) {
    window.setTimeout(function() { confirmBillingActivation(attempt + 1); }, 1500 * (attempt + 1));
  } else {
    toast("Payment received. Refresh shortly if Premium is not visible yet.");
  }
}

async function openBilling() {
  if (!session) return;
  const hasBilling = !["free", "canceled", "incomplete_expired"].includes(accountAccess.status || "free");
  const functionName = accountAccess.plan === "premium" || hasBilling ? "create-portal-session" : "create-checkout-session";
  const result = await cloud.functions.invoke(functionName, { body: {} });
  if (result.error || !result.data || !result.data.url) {
    throw result.error || new Error("Billing did not return a secure redirect");
  }
  window.location.assign(result.data.url);
}

document.querySelectorAll("[data-view]").forEach(function(button) { button.addEventListener("click", function() { setView(button.dataset.view); }); });
document.querySelectorAll("[data-view-target]").forEach(function(button) { button.addEventListener("click", function() { setView(button.dataset.viewTarget); }); });
document.querySelectorAll("[data-close-modal]").forEach(function(button) { button.addEventListener("click", function() { closeModal(button.dataset.closeModal); }); });
document.querySelectorAll("[data-open-modal]").forEach(function(button) {
  button.addEventListener("click", function() {
    if (button.dataset.openModal === "pathModal") openPathModal();
    else if (button.dataset.openModal === "knowledgeModal") openKnowledgeModal();
    else openJobModal();
  });
});
document.querySelectorAll(".modal-backdrop").forEach(function(backdrop) {
  backdrop.addEventListener("click", function(event) {
    if (event.target === backdrop && backdrop.id !== "betaConsentModal") closeModal(backdrop.id);
  });
});
document.getElementById("editPathButton").addEventListener("click", function() { openPathModal(activePath()); });
document.getElementById("exportButton").addEventListener("click", exportAccount);
document.getElementById("authButton").addEventListener("click", async function() {
  if (config.localPreview) {
    toast("Preview mode has no account session to sign out from");
    return;
  }
  if (cloud && session) await cloud.auth.signOut({ scope: "local" });
});

document.getElementById("authForm").addEventListener("submit", async function(event) {
  event.preventDefault();
  const message = document.getElementById("authMessage");
  message.classList.remove("is-success");
  if (!requireCaptcha("signin", message)) return;
  message.textContent = "Signing in…";
  const result = await cloud.auth.signInWithPassword({
    email: document.getElementById("authEmail").value.trim(),
    password: document.getElementById("authPassword").value,
    options: { captchaToken: captchaTokens.signin }
  });
  resetTurnstile("signin");
  message.textContent = result.error ? result.error.message : "";
});

document.getElementById("signupForm").addEventListener("submit", async function(event) {
  event.preventDefault();
  const message = document.getElementById("signupMessage");
  if (!signupEnabled) {
    message.textContent = "Masari is currently invite-only. Ask the beta owner for an invitation.";
    return;
  }
  message.classList.remove("is-success");
  if (!requireCaptcha("signup", message)) return;
  message.textContent = "Creating your private workspace…";
  const result = await cloud.auth.signUp({
    email: document.getElementById("signupEmail").value.trim(),
    password: document.getElementById("signupPassword").value,
    options: {
      data: { display_name: document.getElementById("signupName").value.trim() },
      captchaToken: captchaTokens.signup
    }
  });
  resetTurnstile("signup");
  if (result.error) { message.textContent = result.error.message; return; }
  message.classList.add("is-success");
  message.textContent = result.data.session ? "Account created." : "Account created. Check your email to confirm it, then sign in.";
});

document.getElementById("showSignupButton").addEventListener("click", function() {
  if (!signupEnabled) {
    document.getElementById("authMessage").textContent = "Masari is currently invite-only.";
    return;
  }
  document.getElementById("signInPanel").classList.add("hidden");
  document.getElementById("signupPanel").classList.remove("hidden");
  ensureTurnstile("signup");
});
document.getElementById("showSigninButton").addEventListener("click", function() {
  document.getElementById("signupPanel").classList.add("hidden");
  document.getElementById("signInPanel").classList.remove("hidden");
  ensureTurnstile("signin");
});
document.getElementById("forgotPasswordButton").addEventListener("click", async function() {
  const email = document.getElementById("authEmail").value.trim();
  const message = document.getElementById("authMessage");
  message.classList.remove("is-success");
  if (!email) { message.textContent = "Enter your email address first."; return; }
  if (!requireCaptcha("signin", message)) return;
  const result = await cloud.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
    captchaToken: captchaTokens.signin
  });
  resetTurnstile("signin");
  message.classList.toggle("is-success", !result.error);
  message.textContent = result.error ? result.error.message : "Password reset instructions have been sent.";
});
document.getElementById("resetPasswordForm").addEventListener("submit", async function(event) {
  event.preventDefault();
  const password = document.getElementById("newPassword").value;
  const confirmation = document.getElementById("confirmPassword").value;
  const message = document.getElementById("resetPasswordMessage");
  if (password !== confirmation) { message.textContent = "The passwords do not match."; return; }
  const result = await cloud.auth.updateUser({ password: password });
  if (result.error) { message.textContent = result.error.message; return; }
  closeModal("resetPasswordModal");
  this.reset();
  toast("Your password has been updated");
});
document.getElementById("onboardingSignoutButton").addEventListener("click", function() { cloud.auth.signOut({ scope: "local" }); });
document.getElementById("betaConsentSignoutButton").addEventListener("click", function() { cloud.auth.signOut({ scope: "local" }); });
document.getElementById("betaConsentForm").addEventListener("submit", async function(event) {
  event.preventDefault();
  const status = document.getElementById("betaConsentStatus");
  status.textContent = "Saving your choice…";
  state.profile.betaTermsAcceptedAt = new Date().toISOString();
  state.profile.privacyNoticeVersion = PRIVACY_NOTICE_VERSION;
  try {
    await saveState();
    if (cloud && session) {
      const verification = await cloud.from("career_profiles")
        .select("beta_terms_accepted_at,privacy_notice_version")
        .eq("user_id", session.user.id)
        .single();
      if (
        verification.error ||
        !verification.data.beta_terms_accepted_at ||
        verification.data.privacy_notice_version !== PRIVACY_NOTICE_VERSION
      ) {
        throw verification.error || new Error("Consent could not be verified");
      }
    }
    closeModal("betaConsentModal");
    status.textContent = "";
    toast("Private beta terms accepted");
  } catch (error) {
    state.profile.betaTermsAcceptedAt = "";
    state.profile.privacyNoticeVersion = "";
    status.textContent = error.message || "Your choice could not be saved.";
  }
});
document.getElementById("onboardingBackButton").addEventListener("click", function() { setOnboardingStep(onboardingStep - 1); });
document.getElementById("onboardingNextButton").addEventListener("click", function() {
  if (onboardingStep === 1) {
    const fields = ["onboardingName", "onboardingGoal", "onboardingExperience"].map(function(id) { return document.getElementById(id); });
    if (!fields.every(function(field) { return field.reportValidity(); })) return;
  }
  setOnboardingStep(onboardingStep + 1);
});
document.getElementById("onboardingCvFile").addEventListener("change", async function(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { document.getElementById("onboardingMessage").textContent = "CV files must be 10 MB or smaller."; return; }
  const nextButton = document.getElementById("onboardingNextButton");
  nextButton.disabled = true;
  document.getElementById("onboardingCvLabel").textContent = "Extracting " + file.name + "…";
  try {
    document.getElementById("onboardingCvText").value = await extractPdf(file);
    document.getElementById("onboardingCvLabel").textContent = file.name + " is ready";
  } catch (error) { document.getElementById("onboardingMessage").textContent = error.message || "Could not extract this PDF."; }
  finally { nextButton.disabled = false; }
});
document.getElementById("onboardingForm").addEventListener("submit", async function(event) {
  event.preventDefault();
  const message = document.getElementById("onboardingMessage");
  message.textContent = "Creating your personal workspace…";
  try {
    const pathId = crypto.randomUUID();
    const file = document.getElementById("onboardingCvFile").files[0];
    const cvText = document.getElementById("onboardingCvText").value.trim();
    state.profile = {
      displayName: document.getElementById("onboardingName").value.trim(),
      careerGoal: document.getElementById("onboardingGoal").value.trim(),
      experienceLevel: document.getElementById("onboardingExperience").value,
      country: "",
      onboardingComplete: true,
      betaTermsAcceptedAt: new Date().toISOString(),
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION
    };
    state.cv = {
      fileName: file ? file.name : "",
      text: cvText,
      uploadedAt: cvText || file ? new Date().toISOString() : ""
    };
    state.paths = [{
      id: pathId,
      name: document.getElementById("onboardingPathName").value.trim(),
      target: document.getElementById("onboardingTarget").value.trim(),
      description: document.getElementById("onboardingPathDescription").value.trim(),
      jobs: []
    }];
    state.activePathId = pathId;
    if (file) {
      const upload = await cloud.storage.from("private-cvs").upload(session.user.id + "/current-cv.pdf", file, { upsert: true, contentType: "application/pdf" });
      if (upload.error) throw upload.error;
    }
    await saveState();
    const userUpdate = await cloud.auth.updateUser({ data: { display_name: state.profile.displayName } });
    if (userUpdate.error) throw userUpdate.error;
    message.textContent = "";
    showSurface("app");
    render();
  } catch (error) { message.textContent = error.message || "Setup could not be completed."; }
});
["upgradeButton", "membershipActionButton"].forEach(function(id) {
  document.getElementById(id).addEventListener("click", async function() {
    if (!billingEnabled) {
      toast("Premium billing is disabled during the private beta");
      return;
    }
    if (config.localPreview) {
      toast("Premium checkout becomes available when Stripe and Supabase are connected");
      return;
    }
    this.disabled = true;
    try { await openBilling(); }
    catch (error) { toast(await functionErrorMessage(error, "Billing is temporarily unavailable")); this.disabled = false; }
  });
});
document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === "visible" && session && cloudReady) {
    refreshAccountAccess().catch(function() {});
  }
});

document.getElementById("analyzeButton").addEventListener("click", async function() {
  if (!cloud || !session) { toast("Sign in to run private RAG analysis"); return; }
  if (betaMode && !hasCurrentBetaConsent()) { openModal("betaConsentModal"); return; }
  const path = activePath();
  if (!path || !path.jobs.length) { toast("Add at least one job description before analysis"); return; }
  if (!state.cv.text && !state.knowledge.length) { toast("Add CV text or knowledge evidence before analysis"); return; }
  const button = this;
  const requestId = pendingAnalysisRequests[path.id] || crypto.randomUUID();
  pendingAnalysisRequests[path.id] = requestId;
  button.disabled = true;
  button.textContent = "Analyzing…";
  try {
    await saveQueue;
    const result = await cloud.functions.invoke("analyze-career", {
      body: { requestId: requestId, pathId: path.id, targetRole: path.target, documents: ragDocuments() }
    });
    if (result.error) throw result.error;
    if (result.data.access) {
      accountAccess.rag_used = result.data.access.used;
      accountAccess.rag_limit = result.data.access.quota;
      accountAccess.plan = result.data.access.plan_code;
      renderAccount();
    }
    const analysis = normalizeAnalysisRecord(result.data.analysis || {
      requestId: requestId,
      pathId: path.id,
      status: "succeeded",
      summary: result.data.summary,
      findings: result.data.findings,
      sources: result.data.sources || [],
      completedAt: new Date().toISOString()
    });
    state.analyses = (state.analyses || []).filter(function(item) { return item.id !== analysis.id && item.requestId !== analysis.requestId; });
    state.analyses.unshift(analysis);
    delete pendingAnalysisRequests[path.id];
    renderAnalysisResult(path);
    toast(result.data.replayed ? "Saved analysis restored" : "Cited analysis saved privately");
  } catch (error) { toast(await functionErrorMessage(error, "Analysis failed")); }
  finally { button.disabled = false; button.textContent = "Run cited analysis"; }
});

document.getElementById("pathForm").addEventListener("submit", function(event) {
  event.preventDefault();
  const id = document.getElementById("pathId").value || crypto.randomUUID();
  const existing = state.paths.find(function(path) { return path.id === id; });
  if (!existing && !canAdd("job_paths", state.paths.length)) { toast("Your private-beta job path limit has been reached."); return; }
  const record = { id: id, name: document.getElementById("pathName").value.trim(), target: document.getElementById("pathTarget").value.trim(), description: document.getElementById("pathDescription").value.trim(), jobs: existing ? existing.jobs : [] };
  if (existing) Object.assign(existing, record); else state.paths.unshift(record);
  state.activePathId = id; saveState(); closeModal("pathModal"); setView("paths"); toast("Job path saved");
});

document.getElementById("jobForm").addEventListener("submit", function(event) {
  event.preventDefault();
  const path = activePath();
  if (!path) { toast("Create a job path first"); closeModal("jobModal"); return; }
  const id = document.getElementById("jobId").value || crypto.randomUUID();
  const existing = path.jobs.find(function(job) { return job.id === id; });
  const jobCount = state.paths.reduce(function(total, item) { return total + item.jobs.length; }, 0);
  if (!existing && !canAdd("job_descriptions", jobCount)) { toast("Your private-beta job-description limit has been reached."); return; }
  const record = { id: id, title: document.getElementById("jobTitle").value.trim(), company: document.getElementById("jobCompany").value.trim(), location: document.getElementById("jobLocation").value.trim(), source: document.getElementById("jobSource").value.trim(), description: document.getElementById("jobDescription").value.trim(), createdAt: new Date().toISOString() };
  if (existing) Object.assign(existing, record); else path.jobs.unshift(record);
  saveState(); closeModal("jobModal"); render(); toast("Job description added to this path");
});

document.getElementById("knowledgeForm").addEventListener("submit", function(event) {
  event.preventDefault();
  const id = document.getElementById("knowledgeId").value || crypto.randomUUID();
  const existing = state.knowledge.find(function(item) { return item.id === id; });
  if (!existing && !canAdd("knowledge_evidence", state.knowledge.length)) { toast("Your private-beta evidence limit has been reached."); return; }
  const record = { id: id, skill: document.getElementById("knowledgeSkill").value.trim(), title: document.getElementById("knowledgeTitle").value.trim(), level: Number(document.getElementById("knowledgeLevel").value), evidence: document.getElementById("knowledgeEvidence").value.trim() };
  if (existing) Object.assign(existing, record); else state.knowledge.unshift(record);
  saveState(); closeModal("knowledgeModal"); render(); toast("Knowledge evidence saved");
});

document.getElementById("cvFile").addEventListener("change", async function(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast("CV files must be 10 MB or smaller"); event.target.value = ""; return; }
  document.getElementById("cvStatus").textContent = "Extracting PDF…";
  try {
    state.cv = { fileName: file.name, text: await extractPdf(file), uploadedAt: new Date().toISOString() };
    if (cloud && session) {
      const upload = await cloud.storage.from("private-cvs").upload(session.user.id + "/current-cv.pdf", file, { upsert: true, contentType: "application/pdf" });
      if (upload.error) throw upload.error;
    }
    saveState(); render(); toast("CV extracted and saved privately");
  } catch (error) { document.getElementById("cvStatus").textContent = "Could not extract PDF"; toast(error.message || "PDF extraction failed"); }
});

document.getElementById("saveCvButton").addEventListener("click", function() {
  state.cv.text = document.getElementById("cvText").value.trim();
  state.cv.uploadedAt = state.cv.uploadedAt || new Date().toISOString();
  saveState(); render(); document.getElementById("cvSaveMessage").textContent = "CV evidence saved"; toast("CV evidence saved");
});

document.getElementById("profileForm").addEventListener("submit", async function(event) {
  event.preventDefault();
  const message = document.getElementById("profileSaveMessage");
  const displayName = document.getElementById("profileDisplayName").value.trim();
  state.profile.displayName = displayName;
  state.profile.careerGoal = document.getElementById("profileCareerGoal").value.trim();
  state.profile.experienceLevel = document.getElementById("profileExperience").value;
  state.profile.country = document.getElementById("profileCountry").value.trim();
  message.textContent = "Saving…";
  try {
    if (cloud && session) {
      const result = await cloud.auth.updateUser({ data: { display_name: displayName } });
      if (result.error) throw result.error;
    }
    await saveState();
    message.textContent = "Personal details saved";
    renderAccount();
    toast("Career profile updated");
  } catch (error) {
    message.textContent = "";
    toast(error.message || "Personal details could not be saved");
  }
});

document.getElementById("feedbackButton").addEventListener("click", function() {
  if (!session || config.feedbackEnabled === false) return;
  document.getElementById("feedbackStatus").textContent = "";
  openModal("feedbackModal");
});

document.getElementById("feedbackForm").addEventListener("submit", async function(event) {
  event.preventDefault();
  const status = document.getElementById("feedbackStatus");
  const button = this.querySelector("[type=submit]");
  status.classList.remove("is-success");
  status.textContent = "Sending…";
  button.disabled = true;
  try {
    const result = await cloud.from("beta_feedback").insert({
      user_id: session.user.id,
      category: document.getElementById("feedbackCategory").value,
      message: document.getElementById("feedbackMessage").value.trim(),
      context: {
        view: activeView,
        path_id: state.activePathId || null,
        app_version: config.appVersion || "unknown"
      }
    });
    if (result.error) throw result.error;
    status.classList.add("is-success");
    status.textContent = "Thank you—your feedback was saved privately.";
    this.reset();
    window.setTimeout(function() { closeModal("feedbackModal"); }, 900);
  } catch (error) {
    status.textContent = error.message || "Feedback could not be sent.";
  } finally {
    button.disabled = false;
  }
});

document.getElementById("clearWorkspaceButton").addEventListener("click", async function() {
  if (!window.confirm("Clear your CV, paths, jobs, and knowledge entries from Masari?")) return;
  try {
    if (cloud && session) {
      const listing = await cloud.storage.from("private-cvs").list(session.user.id, { limit: 100 });
      if (listing.error) throw listing.error;
      const paths = (listing.data || []).map(function(file) { return session.user.id + "/" + file.name; });
      if (paths.length) {
        const removal = await cloud.storage.from("private-cvs").remove(paths);
        if (removal.error) throw removal.error;
      }
      const analysisDeletion = await cloud.from("career_analyses").delete().eq("user_id", session.user.id);
      if (analysisDeletion.error) throw analysisDeletion.error;
      const chunkDeletion = await cloud.from("document_chunks").delete().eq("user_id", session.user.id);
      if (chunkDeletion.error) throw chunkDeletion.error;
    }
    const profile = state.profile;
    state = emptyState();
    state.profile = profile;
    await saveState();
    render();
    toast("Workspace and stored CV files cleared");
  } catch (error) {
    toast(error.message || "Workspace could not be cleared");
  }
});

document.getElementById("deleteAccountButton").addEventListener("click", function() {
  if (!cloud || !session) { toast("Sign in before deleting an account"); return; }
  document.getElementById("deleteAccountStatus").textContent = "";
  openModal("deleteAccountModal");
});

document.getElementById("deleteAccountForm").addEventListener("submit", async function(event) {
  event.preventDefault();
  const status = document.getElementById("deleteAccountStatus");
  const button = this.querySelector("[type=submit]");
  const confirmation = document.getElementById("deleteConfirmation").value;
  if (confirmation !== "DELETE") { status.textContent = "Type DELETE exactly."; return; }
  button.disabled = true;
  status.textContent = "Confirming your identity…";
  try {
    const reauthentication = await cloud.auth.signInWithPassword({
      email: session.user.email,
      password: document.getElementById("deletePassword").value
    });
    if (reauthentication.error) throw reauthentication.error;
    session = reauthentication.data.session;
    status.textContent = "Deleting your private data…";
    const result = await cloud.functions.invoke("delete-account", { body: { confirmation: "DELETE" } });
    if (result.error) throw result.error;
    localStorage.removeItem(cacheKey());
    state = emptyState();
    closeModal("deleteAccountModal");
    this.reset();
    await cloud.auth.signOut({ scope: "local" });
    render();
    toast("Account and private data deleted");
  } catch (error) {
    status.textContent = await functionErrorMessage(error, "Account deletion failed");
  } finally {
    document.getElementById("deletePassword").value = "";
    button.disabled = false;
  }
});

async function initializeCloud() {
  if (!cloud) {
    if (config.localPreview) {
      state = loadState();
      accountAccess.features = {
        job_paths: { enabled: true, quota: betaMode ? 3 : 1 },
        job_descriptions: { enabled: true, quota: betaMode ? 20 : 5 },
        knowledge_evidence: { enabled: true, quota: betaMode ? 50 : 10 }
      };
      showSurface("app");
      document.getElementById("saveState").textContent = "Local preview";
      render();
      return;
    }
    showSurface("auth");
    const message = document.getElementById("authMessage");
    message.textContent = "Masari is not configured yet. The administrator must add the Supabase project settings.";
    document.querySelectorAll("#authGate input, #authGate button").forEach(function(element) { element.disabled = true; });
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY + ":preview");
  cloud.auth.onAuthStateChange(function(authEvent, nextSession) {
    window.setTimeout(async function() {
      try {
        session = nextSession;
        if (authEvent === "TOKEN_REFRESHED" || authEvent === "USER_UPDATED") return;
        cloudReady = false;
        if (session) {
          localStorage.removeItem(cacheKey());
          await loadCloudState();
          cloudReady = true;
          document.querySelector(".storage-status span:last-child").textContent = "Encrypted cloud workspace";
          document.getElementById("saveState").textContent = "Saved privately";
          showSignedInSurface();
          if (authEvent === "PASSWORD_RECOVERY") openModal("resetPasswordModal");
        } else {
          state = emptyState();
          accountAccess = { plan: "free", status: "free", rag_used: 0, rag_limit: betaMode ? 10 : 2, features: {} };
          showSurface("auth");
        }
      } catch (error) {
        showSurface("auth");
        document.getElementById("authMessage").textContent = error.message || "Your workspace could not be loaded.";
      }
    }, 0);
  });
  const result = await cloud.auth.getSession();
  session = result.data.session;
  if (session) {
    await loadCloudState();
    cloudReady = true;
    document.getElementById("saveState").textContent = "Saved privately";
    showSignedInSurface();
  } else {
    showSurface("auth");
  }
  const billingState = billingEnabled ? new URLSearchParams(window.location.search).get("billing") : null;
  if (billingState) {
    history.replaceState({}, "", window.location.pathname);
    if (billingState === "success") {
      toast("Payment received. Confirming Premium…");
      window.setTimeout(function() { confirmBillingActivation(0); }, 1000);
    } else if (billingState === "canceled") {
      toast("Checkout canceled. Your plan was not changed.");
    } else if (billingState === "return") {
      window.setTimeout(function() { refreshAccountAccess().catch(function() {}); }, 1000);
    }
  }
}

initializeCloud().catch(function(error) {
  showSurface("auth");
  document.getElementById("authMessage").textContent = error.message || "Masari could not connect. Please try again.";
});
