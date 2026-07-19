const STORAGE_KEY = "career-rag-workspace-v1";
const PRIVACY_NOTICE_VERSION = "2026-07-16";
const config = window.CAREER_RAG_CONFIG || {};
const initialAuthLinkType = new URLSearchParams(window.location.hash.slice(1)).get("type")
  || new URLSearchParams(window.location.search).get("type")
  || "";
let passwordSetupMode = initialAuthLinkType === "invite" ? "invite" : "";
const betaMode = config.betaMode !== false;
const billingEnabled = config.billingEnabled === true;
const signupEnabled = config.signupEnabled === true;
const cloud = config.supabaseUrl && config.supabasePublishableKey && window.supabase
  ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey)
  : null;
["termsLink", "appTermsLink"].forEach(function(id) {
  const link = document.getElementById(id);
  if (config.termsUrl && link) link.href = config.termsUrl;
});
["privacyLink", "appPrivacyLink"].forEach(function(id) {
  const link = document.getElementById(id);
  if (config.privacyUrl && link) link.href = config.privacyUrl;
});
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
  analyses: [],
  analysisFeedback: [],
  actionItems: [],
  evidenceLinks: [],
  cvGuidance: [],
  sharedReports: []
};

let state = loadState();
let activeView = "overview";
let activePlanFilter = "all";
let analysisTimers = [];
let analysisUi = {};
let cvStarterActionPromise = null;
const analysisActionPromises = new Map();

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
    analyses: [],
    analysisFeedback: [],
    actionItems: [],
    evidenceLinks: [],
    cvGuidance: [],
    sharedReports: []
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
    cloud.from("analysis_finding_feedback").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
    cloud.from("action_plan_items").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    cloud.from("analysis_evidence_links").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    cloud.from("cv_guidance").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
    cloud.from("shared_reports").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    cloud.rpc("get_my_account_access")
  ]);
  results.forEach(function(result) { if (result.error) throw result.error; });
  const profile = results[0].data;
  const paths = (results[1].data || []).map(function(path) {
    return {
      id: path.id, name: path.name, target: path.target, description: path.description,
      jobs: (results[2].data || []).filter(function(job) { return job.path_id === path.id; }).map(function(job) {
        return {
          id: job.id, title: job.title, company: job.company, location: job.location,
          source: job.source_url, description: job.description, status: job.application_status || "saved",
          closingDate: job.closing_date || "", appliedAt: job.applied_at || "", notes: job.notes || "",
          createdAt: job.created_at
        };
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
    analyses: (results[4].data || []).map(normalizeAnalysisRecord),
    analysisFeedback: results[5].data || [],
    actionItems: results[6].data || [],
    evidenceLinks: results[7].data || [],
    cvGuidance: results[8].data || [],
    sharedReports: results[9].data || []
  };
  accountAccess = results[10].data || accountAccess;
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
        application_status: job.status || "saved", closing_date: job.closingDate || null,
        applied_at: job.appliedAt ? new Date(job.appliedAt + "T12:00:00Z").toISOString() : null,
        notes: job.notes || "",
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

function setAnalysisStatus(pathId, status, message, requestId) {
  analysisUi[pathId] = { status: status, message: message, requestId: requestId || "", updatedAt: new Date().toISOString() };
  try { sessionStorage.setItem("masari:analysis-status", JSON.stringify(analysisUi)); } catch (_error) {}
  renderAnalysisStatus(activePath());
}

function restoreAnalysisStatus() {
  try { analysisUi = JSON.parse(sessionStorage.getItem("masari:analysis-status")) || {}; }
  catch (_error) { analysisUi = {}; }
}

function clearAnalysisTimers() {
  analysisTimers.forEach(window.clearTimeout);
  analysisTimers = [];
}

function renderAnalysisStatus(path) {
  const box = document.getElementById("analysisStatus");
  const current = path && analysisUi[path.id];
  if (!current) {
    box.className = "analysis-status hidden";
    box.innerHTML = "";
    return;
  }
  const failed = current.status === "failed";
  box.className = "analysis-status is-" + safe(current.status);
  box.innerHTML = '<span class="analysis-status-dot" aria-hidden="true"></span><div><strong>' +
    safe(failed ? "Analysis needs attention" : current.status === "completed" ? "Analysis completed" : "Analysis in progress") +
    '</strong><p>' + safe(current.message) + '</p></div>' +
    (failed ? '<button type="button" class="button button-light analysis-retry" id="analysisRetryButton">Try again</button>' : "");
  const retry = box.querySelector("#analysisRetryButton");
  if (retry) retry.addEventListener("click", function() { document.getElementById("analyzeButton").click(); });
}

function safeSourceUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch (_error) { return ""; }
}

async function saveFindingFeedback(analysis, findingIndex, rating) {
  if (!analysis || !analysis.id) return;
  const row = {
    user_id: session && session.user.id,
    analysis_id: analysis.id,
    finding_index: findingIndex,
    rating: rating,
    updated_at: new Date().toISOString()
  };
  if (cloud && session) {
    const result = await cloud.from("analysis_finding_feedback").upsert(row, {
      onConflict: "user_id,analysis_id,finding_index"
    }).select().single();
    if (result.error) throw result.error;
    row.id = result.data.id;
    row.created_at = result.data.created_at;
  }
  state.analysisFeedback = (state.analysisFeedback || []).filter(function(item) {
    return !(item.analysis_id === analysis.id && Number(item.finding_index) === findingIndex);
  });
  state.analysisFeedback.push(row);
  renderAnalysisResult(activePath());
  toast(rating === "useful" ? "Marked as useful" : "Feedback saved for improvement");
}

function renderAnalysisResult(path) {
  const box = document.getElementById("ragResult");
  const analysis = path && (state.analyses || []).find(function(item) {
    return item.pathId === path.id && item.status === "succeeded";
  });
  if (!analysis) {
    const hasJob = Boolean(path && path.jobs && path.jobs.length);
    const hasEvidence = Boolean(state.cv.text || state.knowledge.length);
    const action = !hasJob
      ? '<button type="button" class="button button-dark" data-empty-action="job">Add a job description</button>'
      : !hasEvidence
        ? '<button type="button" class="button button-dark" data-empty-action="profile">Add CV or evidence</button>'
        : '<button type="button" class="button button-dark" data-empty-action="analysis">Run your first analysis</button>';
    box.innerHTML = '<div class="empty-state empty-state-action"><strong>No assessment yet</strong><p>Add a target job and evidence, then Masari will compare them and return source-backed findings.</p>' + action + '</div>';
    bindEmptyActions(box);
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
      const feedback = (state.analysisFeedback || []).find(function(entry) {
        return entry.analysis_id === analysis.id && Number(entry.finding_index) === findingIndex;
      });
      const linkedEvidence = (state.evidenceLinks || []).filter(function(entry) {
        return entry.analysis_id === analysis.id && Number(entry.finding_index) === findingIndex;
      }).map(function(entry) {
        return state.knowledge.find(function(evidence) { return evidence.id === entry.evidence_id; });
      }).filter(Boolean);
      return '<article class="analysis-finding"><div class="analysis-finding-head"><strong>' + safe(item.skill) +
        '</strong><span class="skill-badge ' + badgeClass + '">' + safe(item.confidence) + '</span></div><p>' +
        safe(item.explanation) + '</p>' + (linkedEvidence.length ? '<div class="finding-evidence-links"><strong>Connected evidence</strong><span>' +
        linkedEvidence.map(function(evidence) { return safe(evidence.title); }).join("</span><span>") +
        '</span></div>' : "") + '<div class="citation-list" aria-label="Supporting sources">' +
        (item.citations || []).map(function(label) {
          const source = sourceMap[label] || {};
          const title = source.title || source.source_type || "Private source";
          const detailId = "citation-" + findingIndex + "-" + String(label).replace(/[^A-Za-z0-9-]/g, "");
          const sourceUrl = safeSourceUrl(source.source_url);
          return '<div class="citation-item"><button type="button" class="citation-button" data-citation-target="' + detailId +
            '" aria-expanded="false" aria-controls="' + detailId + '">' +
            safe(label) + ' · ' + safe(title) + '</button><div class="citation-detail" id="' + detailId + '"><strong>' +
            safe(source.source_type || "source") + (source.company ? " · " + source.company : "") +
            '</strong><p>' + safe(source.excerpt || "The source excerpt is unavailable.") + '</p>' +
            (sourceUrl ? '<a href="' + safe(sourceUrl) + '" target="_blank" rel="noreferrer">Open original job source ↗</a>' : "") +
            '</div></div>';
        }).join("") + '</div><div class="finding-actions"><span>Was this finding useful?</span><button type="button" class="feedback-chip' +
        (feedback && feedback.rating === "useful" ? " is-selected" : "") + '" data-finding-feedback="useful" data-finding-index="' +
        findingIndex + '">Useful</button><button type="button" class="feedback-chip' +
        (feedback && feedback.rating === "needs_work" ? " is-selected" : "") + '" data-finding-feedback="needs_work" data-finding-index="' +
        findingIndex + '">Needs work</button><button type="button" class="text-button" data-plan-finding="' +
        findingIndex + '">Add to plan <span>→</span></button><button type="button" class="text-button add-evidence-link" data-add-finding-evidence="' +
        findingIndex + '">Add evidence <span>→</span></button></div></article>';
    }).join("") + '</div></div>';
  box.querySelectorAll("[data-citation-target]").forEach(function(button) {
    button.addEventListener("click", function() {
      const detail = document.getElementById(button.dataset.citationTarget);
      if (detail) {
        const visible = detail.classList.toggle("is-visible");
        button.setAttribute("aria-expanded", String(visible));
      }
    });
  });
  box.querySelectorAll("[data-finding-feedback]").forEach(function(button) {
    button.addEventListener("click", async function() {
      button.disabled = true;
      try {
        await saveFindingFeedback(analysis, Number(button.dataset.findingIndex), button.dataset.findingFeedback);
      } catch (error) {
        button.disabled = false;
        toast(error.message || "Feedback could not be saved");
      }
    });
  });
  box.querySelectorAll("[data-add-finding-evidence]").forEach(function(button) {
    button.addEventListener("click", function() {
      const item = analysis.findings[Number(button.dataset.addFindingEvidence)];
      setView("knowledge");
      openKnowledgeModal();
      document.getElementById("knowledgeSkill").value = item && item.skill || "";
      document.getElementById("knowledgeTitle").focus();
    });
  });
  box.querySelectorAll("[data-plan-finding]").forEach(function(button) {
    button.addEventListener("click", function() {
      const findingIndex = Number(button.dataset.planFinding);
      const item = analysis.findings[findingIndex];
      openPlanItemModal(null, {
        analysisId: analysis.id,
        findingIndex: findingIndex,
        skill: item && item.skill || "",
        title: item ? "Build evidence for " + item.skill : "Close evidence gap",
        description: item && item.explanation || ""
      });
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

function runOverviewAction(action) {
  if (action === "profile") setView("profile");
  else if (action === "path") openPathModal();
  else if (action === "job") openJobModal();
  else if (action === "knowledge") { setView("knowledge"); openKnowledgeModal(); }
  else if (action === "analysis") document.getElementById("analyzeButton").click();
  else if (action === "plan") { setView("plan"); openPlanItemModal(); }
}

function bindEmptyActions(container) {
  container.querySelectorAll("[data-empty-action]").forEach(function(button) {
    button.addEventListener("click", function() { runOverviewAction(button.dataset.emptyAction); });
  });
}

function setupProgress(path) {
  const profileComplete = Boolean(state.profile.displayName && state.profile.careerGoal && state.profile.experienceLevel);
  const hasCv = Boolean(state.cv.text);
  const hasJob = Boolean(path && path.jobs && path.jobs.length);
  const hasAnalysis = Boolean(path && (state.analyses || []).some(function(item) {
    return item.pathId === path.id && item.status === "succeeded";
  }));
  return [
    { label: "Complete your profile", detail: "Set your experience and career direction.", done: profileComplete, action: "profile", cta: "Open profile" },
    { label: "Add your CV baseline", detail: "Upload a PDF or paste your current CV.", done: hasCv, action: "profile", cta: "Add CV" },
    { label: "Add a target job", detail: "Paste a description for a role you want.", done: hasJob, action: "job", cta: "Add job" },
    { label: "Run your first analysis", detail: "Compare your evidence with the target role.", done: hasAnalysis, action: "analysis", cta: "Run analysis" }
  ];
}

function renderSetupChecklist(path) {
  const steps = setupProgress(path);
  const complete = steps.filter(function(step) { return step.done; }).length;
  const container = document.getElementById("setupChecklist");
  container.classList.toggle("is-complete", complete === steps.length);
  document.getElementById("setupChecklistProgress").textContent = complete + " of " + steps.length;
  document.getElementById("setupChecklistSummary").textContent = complete === steps.length
    ? "Your baseline is ready. Keep it current as your experience grows."
    : "Complete these steps to unlock a useful cited assessment.";
  document.getElementById("setupProgressBar").style.width = Math.round(complete / steps.length * 100) + "%";
  const list = document.getElementById("setupSteps");
  list.innerHTML = steps.map(function(step, index) {
    return '<button type="button" class="setup-step' + (step.done ? " is-done" : "") + '" data-setup-action="' + step.action +
      '"><span class="setup-step-check" aria-hidden="true">' + (step.done ? "✓" : String(index + 1)) +
      '</span><span class="setup-step-copy"><strong>' + safe(step.label) + '</strong><small>' + safe(step.detail) +
      '</small></span><span class="setup-step-cta">' + (step.done ? "Review" : safe(step.cta)) + ' →</span></button>';
  }).join("");
  list.querySelectorAll("[data-setup-action]").forEach(function(button) {
    button.addEventListener("click", function() { runOverviewAction(button.dataset.setupAction); });
  });
}

function renderNextAction(path) {
  const next = setupProgress(path).find(function(step) { return !step.done; });
  const title = document.getElementById("nextActionTitle");
  const description = document.getElementById("nextActionDescription");
  const button = document.getElementById("nextActionButton");
  if (next) {
    title.textContent = next.label;
    description.textContent = next.detail;
    button.textContent = next.cta;
    button.dataset.action = next.action;
  } else {
    title.textContent = "Strengthen your highest-priority gap";
    description.textContent = "Add fresh evidence, then rerun the assessment to measure your progress.";
    button.textContent = "Add evidence";
    button.dataset.action = "knowledge";
  }
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
    document.getElementById("readinessScore").textContent = "0%";
    document.getElementById("readinessBar").style.width = "0%";
    document.getElementById("topGapStat").textContent = "Add data";
    renderSkills([]);
    renderFocus([]);
    renderAnalysisResult(null);
    renderJobs(document.getElementById("recentJobs"), []);
    document.getElementById("latestAnalysisStat").textContent = "Not run";
    document.getElementById("pathList").innerHTML = '<div class="empty-state empty-state-action"><strong>No job paths yet</strong><p>Create a direction to start collecting target roles.</p><button type="button" class="button button-dark" data-empty-action="path">Create a job path</button></div>';
    document.getElementById("pathJobs").innerHTML = '<div class="empty-state empty-state-action"><strong>No jobs yet</strong><p>Add a job description to measure recurring demand.</p><button type="button" class="button button-dark" data-empty-action="job">Add a job</button></div>';
    bindEmptyActions(document.getElementById("pathList"));
    bindEmptyActions(document.getElementById("pathJobs"));
    renderSetupChecklist(null);
    renderNextAction(null);
    renderKnowledge();
    renderProfile();
    renderActionPlan(null);
    renderProgress(null);
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
  const latestAnalysis = (state.analyses || []).find(function(item) { return item.pathId === path.id && item.status === "succeeded"; });
  document.getElementById("latestAnalysisStat").textContent = latestAnalysis ? formatDate(latestAnalysis.completedAt || latestAnalysis.createdAt) : "Not run";
  document.getElementById("topGapStat").textContent = top ? top.skill : "Add data";
  document.getElementById("topGapFoot").textContent = top ? top.demand + " demand signal" + (top.demand === 1 ? "" : "s") : "from job demand";
  renderSkills(items);
  renderFocus(items);
  renderAnalysisResult(path);
  renderJobs(document.getElementById("recentJobs"), path.jobs.slice(0, 5));
  renderPaths(path);
  renderKnowledge();
  renderProfile();
  renderActionPlan(path);
  renderProgress(path);
  renderSetupChecklist(path);
  renderNextAction(path);
  document.getElementById("pageTitle").textContent = activeView === "overview" ? "Overview"
    : activeView === "paths" ? "Job paths"
    : activeView === "knowledge" ? "Knowledge"
    : activeView === "plan" ? "Action plan"
    : activeView === "progress" ? "Progress & reports"
    : "Profile & CV";
}

function renderSkills(items) {
  const box = document.getElementById("skillLandscape");
  if (!items.length) { box.innerHTML = '<div class="empty-state empty-state-action"><strong>No demand signals yet</strong><p>Add a job description to see which skills recur.</p><button type="button" class="button button-light" data-empty-action="job">Add a job</button></div>'; bindEmptyActions(box); return; }
  box.innerHTML = items.slice(0, 8).map(function(item) {
    const kind = item.coverage >= 70 ? "good" : item.coverage >= 35 ? "warn" : "gap";
    const label = item.coverage >= 70 ? "Covered" : item.coverage >= 35 ? "Partial" : "Gap";
    return '<div class="skill-row"><div><div class="skill-name">' + safe(item.skill) + '</div><span class="skill-badge ' + kind + '">' + label + '</span></div><div class="skill-demand"><div class="skill-demand-line"><span>' + item.demand + ' demand signal' + (item.demand === 1 ? "" : "s") + '</span><span>' + ((item.evidence || item.knowledge) ? "Evidence found" : "No evidence yet") + '</span></div><div class="meter-track"><span style="width:' + item.coverage + '%"></span></div></div><div class="skill-score ' + kind + '">' + item.coverage + '%</div></div>';
  }).join("");
}

function renderFocus(items) {
  const box = document.getElementById("focusPlan");
  if (!items.length) { box.innerHTML = '<div class="empty-state empty-state-action"><strong>No priorities yet</strong><p>Add a job description and Masari will identify your highest-value gaps.</p><button type="button" class="button button-light" data-empty-action="job">Add a job</button></div>'; bindEmptyActions(box); return; }
  box.innerHTML = items.slice(0, 3).map(function(item, index) {
    const cert = CERTS[item.skill];
    const action = item.coverage < 35 ? "Build evidence for " + item.skill + " before choosing a certification." : "Strengthen your " + item.skill + " evidence with one measurable project.";
    const link = cert ? '<a class="focus-link" href="' + cert[1] + '" target="_blank" rel="noreferrer">' + safe(cert[0]) + ' ↗</a>' : "";
    return '<div class="focus-item"><span class="focus-number">0' + (index + 1) + '</span><div><strong>' + safe(item.skill) + ' · ' + (item.coverage < 35 ? "close the gap" : "make it visible") + '</strong><p>' + action + '</p>' + link + '</div></div>';
  }).join("");
}

function renderJobs(box, jobs) {
  if (!jobs.length) { box.innerHTML = '<div class="empty-state empty-state-action"><strong>No job entries yet</strong><p>Add a description to start measuring employer demand.</p><button type="button" class="button button-light" data-empty-action="job">Add a job description</button></div>'; bindEmptyActions(box); return; }
  box.innerHTML = jobs.map(function(job) {
    return '<div class="job-row"><div class="job-title-wrap"><div class="job-title">' + safe(job.title) + '</div><span>' +
      safe(job.description.slice(0, 95)) + (job.description.length > 95 ? "…" : "") +
      '</span></div><div class="job-company">' + safe(job.company || "Independent") +
      '</div><div class="job-location"><span class="job-status is-' + safe(job.status || "saved") + '">' +
      safe((job.status || "saved").replace("_", " ")) + '</span>' +
      (job.closingDate ? '<small>Closes ' + safe(formatDate(job.closingDate + "T12:00:00Z")) + '</small>' : "") +
      '</div><button class="row-action" data-edit-job="' + job.id + '" aria-label="Edit job" title="Edit job">✎</button></div>';
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
  if (!state.knowledge.length) { list.innerHTML = '<div class="panel empty-state empty-state-action"><strong>No supporting evidence yet</strong><p>Add a skill you have practiced, studied, or delivered in a project.</p><button type="button" class="button button-dark" data-empty-action="knowledge">Add evidence</button></div>'; bindEmptyActions(list); return; }
  list.innerHTML = state.knowledge.map(function(item) {
    const dots = [1, 2, 3].map(function(level) { return '<i class="' + (level <= item.level ? "is-filled" : "") + '"></i>'; }).join("");
    return '<article class="knowledge-item"><div class="knowledge-item-top"><div><div class="skill-tag">' + safe(item.skill) + '</div><h3>' + safe(item.title) + '</h3></div><div class="confidence" aria-label="Confidence ' + item.level + ' of 3">' + dots + '</div></div><p>' + safe(item.evidence) + '</p><button class="text-button" data-edit-knowledge="' + item.id + '">Edit evidence <span>↗</span></button></article>';
  }).join("");
  list.querySelectorAll("[data-edit-knowledge]").forEach(function(button) { button.addEventListener("click", function() { openKnowledgeModal(button.dataset.editKnowledge); }); });
}

function renderActionPlan(path) {
  const list = document.getElementById("actionPlanList");
  const allItems = (state.actionItems || []).filter(function(item) { return !path || !item.path_id || item.path_id === path.id; });
  const completed = allItems.filter(function(item) { return item.status === "completed"; }).length;
  document.getElementById("planProgressLabel").textContent = completed + " of " + allItems.length + " complete";
  document.getElementById("planProgressBar").style.width = allItems.length ? Math.round(completed / allItems.length * 100) + "%" : "0%";
  const items = activePlanFilter === "all" ? allItems : allItems.filter(function(item) { return item.status === activePlanFilter; });
  if (!items.length) {
    list.innerHTML = '<div class="panel empty-state empty-state-action"><strong>' +
      (allItems.length ? "No actions match this filter" : "Your action plan is empty") +
      '</strong><p>Turn a cited finding into a concrete, trackable next step.</p><button class="button button-dark" data-empty-action="plan">Add an action</button></div>';
    list.querySelector("[data-empty-action=plan]").addEventListener("click", function() { openPlanItemModal(); });
    return;
  }
  list.innerHTML = items.map(function(item) {
    const evidence = state.knowledge.find(function(entry) { return entry.id === item.evidence_id; });
    return '<article class="plan-item"><div class="plan-item-main"><div class="plan-item-heading"><span class="priority-dot is-' +
      safe(item.priority) + '"></span><div><strong>' + safe(item.title) + '</strong><span>' + safe(item.skill || "General") +
      '</span></div></div><p>' + safe(item.description || "No detail added.") + '</p>' +
      (evidence ? '<div class="linked-evidence">Evidence: ' + safe(evidence.title) + '</div>' : "") +
      '</div><div class="plan-item-controls"><select class="input compact-input" data-plan-status="' + item.id +
      '"><option value="not_started"' + (item.status === "not_started" ? " selected" : "") +
      '>Not started</option><option value="in_progress"' + (item.status === "in_progress" ? " selected" : "") +
      '>In progress</option><option value="completed"' + (item.status === "completed" ? " selected" : "") +
      '>Completed</option></select><span>' + (item.target_date ? "Due " + safe(formatDate(item.target_date + "T12:00:00Z")) : "No due date") +
      '</span><button class="text-button" data-edit-plan="' + item.id + '">Edit <span>↗</span></button></div></article>';
  }).join("");
  list.querySelectorAll("[data-plan-status]").forEach(function(select) {
    select.addEventListener("change", async function() {
      const item = state.actionItems.find(function(entry) { return entry.id === select.dataset.planStatus; });
      if (!item) return;
      item.status = select.value;
      item.completed_at = select.value === "completed" ? new Date().toISOString() : null;
      item.updated_at = new Date().toISOString();
      if (cloud && session) {
        const result = await cloud.from("action_plan_items").update({
          status: item.status, completed_at: item.completed_at, updated_at: item.updated_at
        }).eq("id", item.id).eq("user_id", session.user.id);
        if (result.error) { toast(result.error.message); await loadCloudState(); }
      }
      renderActionPlan(activePath());
    });
  });
  list.querySelectorAll("[data-edit-plan]").forEach(function(button) {
    button.addEventListener("click", function() {
      openPlanItemModal(state.actionItems.find(function(item) { return item.id === button.dataset.editPlan; }));
    });
  });
}

function findingMap(analysis) {
  return Object.fromEntries((analysis && analysis.findings || []).map(function(item) { return [item.skill.toLowerCase(), item]; }));
}

function renderProgress(path) {
  const history = (state.analyses || []).filter(function(item) {
    return item.status === "succeeded" && (!path || item.pathId === path.id);
  });
  document.getElementById("historyCount").textContent = history.length + " assessment" + (history.length === 1 ? "" : "s");
  const historyBox = document.getElementById("analysisHistory");
  historyBox.innerHTML = history.length ? history.map(function(item, index) {
    return '<article class="history-item"><div><strong>' + safe(formatDate(item.completedAt || item.createdAt)) +
      '</strong><span>' + safe(item.findings.length) + ' cited findings</span></div><p>' + safe(item.summary) +
      '</p>' + (index === 0 ? '<span class="skill-badge good">Latest</span>' : "") + '</article>';
  }).join("") : '<div class="empty-state">Run at least two cited assessments to compare your progress.</div>';
  const comparison = document.getElementById("analysisComparison");
  if (history.length < 2) {
    comparison.innerHTML = '<div class="comparison-empty">A comparison will appear after your second assessment.</div>';
  } else {
    const current = findingMap(history[0]);
    const previous = findingMap(history[1]);
    const improved = Object.keys(current).filter(function(skill) {
      const ranks = { missing: 0, uncertain: 1, partial: 2, strong: 3 };
      return previous[skill] && ranks[current[skill].confidence] > ranks[previous[skill].confidence];
    });
    const newGaps = Object.keys(current).filter(function(skill) {
      return !previous[skill] && ["missing", "uncertain"].includes(current[skill].confidence);
    });
    comparison.innerHTML = '<div class="comparison-cards"><div><strong>' + improved.length +
      '</strong><span>improved findings</span><p>' + safe(improved.slice(0, 4).join(", ") || "No confidence changes yet") +
      '</p></div><div><strong>' + newGaps.length + '</strong><span>new gaps detected</span><p>' +
      safe(newGaps.slice(0, 4).join(", ") || "No new gaps") + '</p></div></div>';
  }

  const jobs = path && path.jobs || [];
  const select = document.getElementById("guidanceJobSelect");
  const selected = select.value;
  select.innerHTML = jobs.length ? jobs.map(function(job) {
    return '<option value="' + job.id + '">' + safe(job.title + (job.company ? " · " + job.company : "")) + '</option>';
  }).join("") : '<option value="">Add a job first</option>';
  if (jobs.some(function(job) { return job.id === selected; })) select.value = selected;
  const latestGuidance = (state.cvGuidance || []).find(function(item) { return item.job_id === select.value; });
  renderCvGuidance(latestGuidance);
  renderSharedReports();
}

function renderCvGuidance(guidance) {
  const box = document.getElementById("cvGuidanceResult");
  if (!guidance) {
    box.innerHTML = '<div class="empty-state">Select a job to receive truthful, job-specific CV recommendations. Masari never invents experience.</div>';
    return;
  }
  box.innerHTML = '<p class="guidance-summary">' + safe(guidance.summary) + '</p><div class="guidance-list">' +
    (guidance.suggestions || []).map(function(item) {
      return '<article><div><strong>' + safe(item.section) + '</strong><span class="skill-badge ' +
        (item.evidence_status === "supported" ? "good" : "warn") + '">' +
        safe(item.evidence_status === "supported" ? "Supported" : "Needs your evidence") +
        '</span></div><p>' + safe(item.issue) + '</p><p><b>Recommendation:</b> ' + safe(item.recommendation) + '</p></article>';
    }).join("") + '</div>';
}

function renderSharedReports() {
  const box = document.getElementById("sharedReportList");
  const active = (state.sharedReports || []).filter(function(item) {
    return !item.revoked_at && new Date(item.expires_at).getTime() > Date.now();
  });
  if (!active.length) { box.innerHTML = '<div class="empty-state">No active share links.</div>'; return; }
  box.innerHTML = active.map(function(item) {
    return '<div class="shared-report-row"><span>Expires ' + safe(new Date(item.expires_at).toLocaleDateString()) +
      '</span><button class="text-button danger" data-revoke-share="' + item.id + '">Revoke</button></div>';
  }).join("");
  box.querySelectorAll("[data-revoke-share]").forEach(function(button) {
    button.addEventListener("click", async function() {
      const revokedAt = new Date().toISOString();
      const result = await cloud.from("shared_reports").update({ revoked_at: revokedAt })
        .eq("id", button.dataset.revokeShare).eq("user_id", session.user.id);
      if (result.error) { toast(result.error.message); return; }
      const item = state.sharedReports.find(function(entry) { return entry.id === button.dataset.revokeShare; });
      if (item) item.revoked_at = revokedAt;
      renderSharedReports();
      toast("Share link revoked");
    });
  });
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

function openPasswordSetup(mode) {
  passwordSetupMode = mode;
  const invited = mode === "invite";
  document.getElementById("resetPasswordTitle").textContent = invited ? "Create your password" : "Choose a new password";
  document.getElementById("resetPasswordDescription").textContent = invited
    ? "Your invitation has been accepted. Create a password to secure your Masari account and sign in again later."
    : "Use at least ten characters with upper-case, lower-case, and number characters. Do not reuse a password.";
  document.getElementById("resetPasswordSubmit").textContent = invited ? "Create password and continue" : "Update password";
  document.getElementById("resetPasswordMessage").textContent = "";
  openModal("resetPasswordModal");
  window.setTimeout(function() { document.getElementById("newPassword").focus(); }, 0);
}

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
  document.getElementById("jobStatus").value = job ? job.status || "saved" : "saved";
  document.getElementById("jobClosingDate").value = job ? job.closingDate || "" : "";
  document.getElementById("jobAppliedAt").value = job && job.appliedAt ? String(job.appliedAt).slice(0, 10) : "";
  document.getElementById("jobNotes").value = job ? job.notes || "" : "";
  document.getElementById("jobImportStatus").textContent = "";
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

function openPlanItemModal(item, defaults) {
  const value = item || defaults || {};
  document.getElementById("planItemId").value = item ? item.id : "";
  document.getElementById("planAnalysisId").value = value.analysis_id || value.analysisId || "";
  document.getElementById("planFindingIndex").value = value.finding_index ?? value.findingIndex ?? "";
  document.getElementById("planItemTitle").value = value.title || "";
  document.getElementById("planItemSkill").value = value.skill || "";
  document.getElementById("planItemDescription").value = value.description || "";
  document.getElementById("planItemPriority").value = value.priority || "medium";
  document.getElementById("planItemTargetDate").value = value.target_date || "";
  const evidenceSelect = document.getElementById("planEvidenceId");
  evidenceSelect.innerHTML = '<option value="">No evidence linked</option>' + state.knowledge.map(function(evidence) {
    return '<option value="' + evidence.id + '">' + safe(evidence.skill + " · " + evidence.title) + '</option>';
  }).join("");
  evidenceSelect.value = value.evidence_id || "";
  document.getElementById("deletePlanItemButton").classList.toggle("hidden", !item);
  document.getElementById("planItemModalTitle").textContent = item ? "Edit action" : "Add an action";
  openModal("planItemModal");
}

async function ensureStarterActionAfterCv() {
  const path = activePath();
  if (!path || !state.cv.text.trim()) return false;
  if ((state.actionItems || []).some(function(item) { return item.path_id === path.id; })) return false;
  if (cvStarterActionPromise) return cvStarterActionPromise;
  cvStarterActionPromise = (async function() {
    if (cloud && session) {
      const existingResult = await cloud.from("action_plan_items").select("id")
        .eq("user_id", session.user.id).eq("path_id", path.id).limit(1);
      if (existingResult.error) throw existingResult.error;
      if ((existingResult.data || []).length) return false;
    }
    const hasJobs = Boolean(path.jobs && path.jobs.length);
    const target = path.target || path.name || "your target role";
    const row = {
      id: crypto.randomUUID(),
      user_id: session && session.user.id,
      path_id: path.id,
      analysis_id: null,
      finding_index: null,
      evidence_id: null,
      title: "Review your CV against " + target,
      skill: "Career positioning",
      description: hasJobs
        ? "Run a cited analysis for this path, then turn the highest-value evidence gap into your next concrete task."
        : "Add one relevant job description for " + target + ", then run a cited analysis to identify your highest-value evidence gap.",
      status: "not_started",
      priority: "high",
      target_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      completed_at: null,
      updated_at: new Date().toISOString()
    };
    if (cloud && session) {
      const insertResult = await cloud.from("action_plan_items").insert(row).select().single();
      if (insertResult.error) throw insertResult.error;
      Object.assign(row, insertResult.data);
    }
    state.actionItems = state.actionItems || [];
    state.actionItems.unshift(row);
    if (config.localPreview) localStorage.setItem(cacheKey(), JSON.stringify(state));
    return true;
  })();
  try {
    return await cvStarterActionPromise;
  } finally {
    cvStarterActionPromise = null;
  }
}

async function ensureActionAfterAnalysis(analysis, path) {
  if (!analysis || !analysis.id || !path || !(analysis.findings || []).length) return false;
  if ((state.actionItems || []).some(function(item) { return item.analysis_id === analysis.id; })) return false;
  if (analysisActionPromises.has(analysis.id)) return analysisActionPromises.get(analysis.id);
  const promise = (async function() {
    if (cloud && session) {
      const existingResult = await cloud.from("action_plan_items").select("id")
        .eq("user_id", session.user.id).eq("analysis_id", analysis.id).limit(1);
      if (existingResult.error) throw existingResult.error;
      if ((existingResult.data || []).length) return false;
    }
    const confidenceRank = { missing: 0, uncertain: 1, partial: 2, strong: 3 };
    const prioritized = analysis.findings.map(function(finding, index) {
      return { finding: finding, index: index };
    }).sort(function(left, right) {
      return (confidenceRank[left.finding.confidence] ?? 4) - (confidenceRank[right.finding.confidence] ?? 4);
    })[0];
    const finding = prioritized.finding;
    const skill = String(finding.skill || "your highest-priority gap").slice(0, 160);
    const needsNewEvidence = finding.confidence === "missing" || finding.confidence === "uncertain";
    const actionInstruction = needsNewEvidence
      ? "Create or document one concrete example that demonstrates " + skill + ". Add the result as evidence, then rerun the cited analysis."
      : "Strengthen your existing " + skill + " evidence with the scope, decisions, outcome, and measurable impact, then rerun the cited analysis.";
    const row = {
      id: crypto.randomUUID(),
      user_id: session && session.user.id,
      path_id: path.id,
      analysis_id: analysis.id,
      finding_index: prioritized.index,
      evidence_id: null,
      title: ((needsNewEvidence ? "Build evidence for " : "Strengthen evidence for ") + skill).slice(0, 240),
      skill: skill,
      description: (actionInstruction + " Finding: " + (finding.explanation || "")).slice(0, 10000),
      status: "not_started",
      priority: needsNewEvidence ? "high" : "medium",
      target_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      completed_at: null,
      updated_at: new Date().toISOString()
    };
    if (cloud && session) {
      const insertResult = await cloud.from("action_plan_items").insert(row).select().single();
      if (insertResult.error) throw insertResult.error;
      Object.assign(row, insertResult.data);
    }
    state.actionItems = state.actionItems || [];
    state.actionItems.unshift(row);
    if (config.localPreview) localStorage.setItem(cacheKey(), JSON.stringify(state));
    return true;
  })();
  analysisActionPromises.set(analysis.id, promise);
  try {
    return await promise;
  } finally {
    analysisActionPromises.delete(analysis.id);
  }
}

async function ensureLatestAnalysisAction() {
  const analysis = (state.analyses || []).find(function(item) { return item.status === "succeeded"; });
  if (!analysis || (state.actionItems || []).some(function(item) { return item.analysis_id === analysis.id; })) return false;
  const path = state.paths.find(function(item) { return item.id === analysis.pathId; });
  if (!path) return false;
  return ensureActionAfterAnalysis(analysis, path);
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
      if (payload.error) {
        const supportId = typeof payload.request_id === "string" ? payload.request_id.slice(0, 8) : "";
        return payload.error + (supportId ? " Support ID: " + supportId : "");
      }
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
document.getElementById("nextActionButton").addEventListener("click", function() { runOverviewAction(this.dataset.action); });
document.getElementById("readinessExplainer").addEventListener("click", function() {
  const details = document.getElementById("readinessDetails");
  const visible = details.classList.toggle("is-visible");
  this.setAttribute("aria-expanded", String(visible));
});
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
    if (event.target === backdrop && !["betaConsentModal", "resetPasswordModal"].includes(backdrop.id)) closeModal(backdrop.id);
  });
});
document.getElementById("editPathButton").addEventListener("click", function() { openPathModal(activePath()); });
document.getElementById("exportButton").addEventListener("click", exportAccount);
document.getElementById("addPlanItemButton").addEventListener("click", function() { openPlanItemModal(); });
document.querySelectorAll("[data-plan-filter]").forEach(function(button) {
  button.addEventListener("click", function() {
    activePlanFilter = button.dataset.planFilter;
    document.querySelectorAll("[data-plan-filter]").forEach(function(item) { item.classList.toggle("is-active", item === button); });
    renderActionPlan(activePath());
  });
});
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
  message.classList.remove("is-success");
  if (!requireCaptcha("signup", message)) return;
  message.textContent = "Joining the waitlist…";
  const result = await cloud.functions.invoke("join-waitlist", {
    body: {
      email: document.getElementById("signupEmail").value.trim(),
      displayName: document.getElementById("signupName").value.trim(),
      turnstileToken: captchaTokens.signup
    }
  });
  resetTurnstile("signup");
  if (result.error || !result.data || !result.data.joined) {
    message.textContent = result.data && result.data.error || "We could not join the waitlist right now. Please try again.";
    return;
  }
  message.classList.add("is-success");
  message.textContent = result.data.alreadyJoined ? "You are already on the Masari waitlist." : "You are on the list. We will contact you when access opens.";
  this.reset();
});

document.getElementById("showSignupButton").addEventListener("click", function() {
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
  message.classList.remove("is-success");
  if (password !== confirmation) { message.textContent = "The passwords do not match."; return; }
  if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    message.textContent = "Use at least 10 characters with an upper-case letter, lower-case letter, and number.";
    return;
  }
  const button = document.getElementById("resetPasswordSubmit");
  button.disabled = true;
  message.textContent = passwordSetupMode === "invite" ? "Securing your account…" : "Updating your password…";
  const result = await cloud.auth.updateUser({ password: password });
  if (result.error) {
    message.textContent = result.error.message;
    button.disabled = false;
    return;
  }
  const invited = passwordSetupMode === "invite";
  passwordSetupMode = "";
  history.replaceState({}, "", window.location.pathname + window.location.search);
  closeModal("resetPasswordModal");
  this.reset();
  button.disabled = false;
  toast(invited ? "Password created. Welcome to Masari." : "Your password has been updated");
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
    let actionCreated = false;
    let actionWarning = "";
    try { actionCreated = await ensureStarterActionAfterCv(); }
    catch (actionError) { actionWarning = actionError.message || "Workspace created, but the starter action could not be saved"; }
    const userUpdate = await cloud.auth.updateUser({ data: { display_name: state.profile.displayName } });
    if (userUpdate.error) throw userUpdate.error;
    message.textContent = "";
    showSurface("app");
    render();
    toast(actionWarning || (actionCreated ? "Workspace ready and your first action plan was created" : "Your workspace is ready"));
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
  clearAnalysisTimers();
  setAnalysisStatus(path.id, "preparing", "Preparing your private evidence set…", requestId);
  analysisTimers.push(window.setTimeout(function() {
    setAnalysisStatus(path.id, "comparing", "Comparing your evidence with the target role…", requestId);
  }, 1200));
  analysisTimers.push(window.setTimeout(function() {
    setAnalysisStatus(path.id, "generating", "Generating cited findings and checking every source…", requestId);
  }, 5000));
  try {
    await saveQueue;
    const result = await cloud.functions.invoke("analyze-career", {
      headers: { "x-request-id": requestId },
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
    clearAnalysisTimers();
    let actionCreated = false;
    let actionWarning = "";
    try { actionCreated = await ensureActionAfterAnalysis(analysis, path); }
    catch (actionError) { actionWarning = actionError.message || "Analysis saved, but its action could not be created"; }
    setAnalysisStatus(path.id, "completed", actionCreated
      ? "Your cited findings were saved and one action was added to your plan."
      : "Your cited findings were saved privately.", requestId);
    renderAnalysisResult(path);
    renderActionPlan(path);
    toast(actionWarning || (actionCreated
      ? "Cited analysis saved and 1 action was added to your plan"
      : result.data.replayed ? "Saved analysis restored" : "Cited analysis saved privately"));
  } catch (error) {
    clearAnalysisTimers();
    const message = await functionErrorMessage(error, "Analysis failed");
    setAnalysisStatus(path.id, "failed", message, requestId);
    toast(message);
  } finally { button.disabled = false; button.textContent = "Run cited analysis"; }
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

document.getElementById("importJobButton").addEventListener("click", async function() {
  const url = document.getElementById("jobSource").value.trim();
  const status = document.getElementById("jobImportStatus");
  if (!url) { status.textContent = "Enter a supported job URL first."; return; }
  this.disabled = true;
  status.textContent = "Importing…";
  try {
    const result = await cloud.functions.invoke("import-job", { body: { url: url } });
    if (result.error || !result.data?.job) throw result.error || new Error(result.data?.error || "Import failed");
    const job = result.data.job;
    document.getElementById("jobTitle").value = job.title;
    document.getElementById("jobCompany").value = job.company;
    document.getElementById("jobLocation").value = job.location;
    document.getElementById("jobDescription").value = job.description;
    document.getElementById("jobSource").value = job.sourceUrl;
    status.textContent = "Imported. Review before saving.";
  } catch (error) {
    status.textContent = await functionErrorMessage(error, "Import failed. Paste the description instead.");
  } finally { this.disabled = false; }
});

document.getElementById("jobForm").addEventListener("submit", function(event) {
  event.preventDefault();
  const path = activePath();
  if (!path) { toast("Create a job path first"); closeModal("jobModal"); return; }
  const id = document.getElementById("jobId").value || crypto.randomUUID();
  const existing = path.jobs.find(function(job) { return job.id === id; });
  const jobCount = state.paths.reduce(function(total, item) { return total + item.jobs.length; }, 0);
  if (!existing && !canAdd("job_descriptions", jobCount)) { toast("Your private-beta job-description limit has been reached."); return; }
  const record = {
    id: id, title: document.getElementById("jobTitle").value.trim(),
    company: document.getElementById("jobCompany").value.trim(),
    location: document.getElementById("jobLocation").value.trim(),
    source: document.getElementById("jobSource").value.trim(),
    description: document.getElementById("jobDescription").value.trim(),
    status: document.getElementById("jobStatus").value,
    closingDate: document.getElementById("jobClosingDate").value,
    appliedAt: document.getElementById("jobAppliedAt").value,
    notes: document.getElementById("jobNotes").value.trim(),
    createdAt: existing ? existing.createdAt : new Date().toISOString()
  };
  if (existing) Object.assign(existing, record); else path.jobs.unshift(record);
  saveState(); closeModal("jobModal"); render(); toast("Job description added to this path");
});

document.getElementById("planItemForm").addEventListener("submit", async function(event) {
  event.preventDefault();
  const id = document.getElementById("planItemId").value || crypto.randomUUID();
  const existing = state.actionItems.find(function(item) { return item.id === id; });
  const findingValue = document.getElementById("planFindingIndex").value;
  const evidenceId = document.getElementById("planEvidenceId").value || null;
  const row = {
    id: id,
    user_id: session && session.user.id,
    path_id: activePath() && activePath().id || null,
    analysis_id: document.getElementById("planAnalysisId").value || null,
    finding_index: findingValue === "" ? null : Number(findingValue),
    evidence_id: evidenceId,
    title: document.getElementById("planItemTitle").value.trim(),
    skill: document.getElementById("planItemSkill").value.trim(),
    description: document.getElementById("planItemDescription").value.trim(),
    status: existing ? existing.status : "not_started",
    priority: document.getElementById("planItemPriority").value,
    target_date: document.getElementById("planItemTargetDate").value || null,
    completed_at: existing && existing.completed_at || null,
    updated_at: new Date().toISOString()
  };
  try {
    if (cloud && session) {
      const result = await cloud.from("action_plan_items").upsert(row).select().single();
      if (result.error) throw result.error;
      Object.assign(row, result.data);
      if (row.analysis_id && row.finding_index !== null && evidenceId) {
        const linkResult = await cloud.from("analysis_evidence_links").upsert({
          user_id: session.user.id,
          analysis_id: row.analysis_id,
          finding_index: row.finding_index,
          evidence_id: evidenceId
        }, { onConflict: "user_id,analysis_id,finding_index,evidence_id" }).select().single();
        if (linkResult.error) throw linkResult.error;
        state.evidenceLinks = (state.evidenceLinks || []).filter(function(link) { return link.id !== linkResult.data.id; });
        state.evidenceLinks.push(linkResult.data);
      }
    }
    state.actionItems = state.actionItems.filter(function(item) { return item.id !== id; });
    state.actionItems.unshift(row);
    closeModal("planItemModal");
    setView("plan");
    toast("Action saved");
  } catch (error) { toast(error.message || "Action could not be saved"); }
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
    await saveState();
    let actionCreated = false;
    let actionWarning = "";
    try { actionCreated = await ensureStarterActionAfterCv(); }
    catch (actionError) { actionWarning = actionError.message || "CV saved, but the starter action could not be created"; }
    render();
    toast(actionWarning || (actionCreated ? "CV saved and your first action plan was created" : "CV extracted and saved privately"));
  } catch (error) { document.getElementById("cvStatus").textContent = "Could not extract PDF"; toast(error.message || "PDF extraction failed"); }
});

document.getElementById("saveCvButton").addEventListener("click", async function() {
  this.disabled = true;
  try {
    state.cv.text = document.getElementById("cvText").value.trim();
    state.cv.uploadedAt = state.cv.uploadedAt || new Date().toISOString();
    await saveState();
    const actionCreated = await ensureStarterActionAfterCv();
    render();
    document.getElementById("cvSaveMessage").textContent = actionCreated
      ? "CV saved · first action plan created"
      : "CV evidence saved";
    toast(actionCreated ? "CV saved and your first action plan was created" : "CV evidence saved");
  } catch (error) {
    toast(error.message || "CV evidence could not be saved");
  } finally {
    this.disabled = false;
  }
});

document.getElementById("guidanceJobSelect").addEventListener("change", function() {
  const jobId = this.value;
  renderCvGuidance((state.cvGuidance || []).find(function(item) { return item.job_id === jobId; }));
});
document.getElementById("deletePlanItemButton").addEventListener("click", async function() {
  const id = document.getElementById("planItemId").value;
  if (!id) return;
  try {
    if (cloud && session) {
      const result = await cloud.from("action_plan_items").delete().eq("id", id).eq("user_id", session.user.id);
      if (result.error) throw result.error;
    }
    state.actionItems = state.actionItems.filter(function(item) { return item.id !== id; });
    closeModal("planItemModal");
    renderActionPlan(activePath());
    toast("Action deleted");
  } catch (error) { toast(error.message || "Action could not be deleted"); }
});
document.getElementById("generateCvGuidanceButton").addEventListener("click", async function() {
  const jobId = document.getElementById("guidanceJobSelect").value;
  if (!jobId) { toast("Add and select a job first"); return; }
  if (!state.cv.text) { toast("Add your CV before requesting guidance"); return; }
  this.disabled = true;
  this.textContent = "Generating…";
  try {
    await saveQueue;
    const result = await cloud.functions.invoke("cv-guidance", { body: { jobId: jobId } });
    if (result.error || !result.data?.guidance) throw result.error || new Error("Guidance failed");
    state.cvGuidance.unshift(result.data.guidance);
    renderCvGuidance(result.data.guidance);
    toast("Job-specific CV guidance saved");
  } catch (error) {
    toast(await functionErrorMessage(error, "CV guidance could not be created"));
  } finally {
    this.disabled = false;
    this.textContent = "Generate truthful guidance";
  }
});

function reportPayload() {
  const path = activePath();
  const analysis = path && (state.analyses || []).find(function(item) {
    return item.pathId === path.id && item.status === "succeeded";
  });
  return {
    generated_at: new Date().toISOString(),
    path: path ? { name: path.name, target: path.target, description: path.description } : null,
    analysis: analysis ? { summary: analysis.summary, findings: analysis.findings, completed_at: analysis.completedAt } : null,
    actions: (state.actionItems || []).filter(function(item) { return path && item.path_id === path.id; }).map(function(item) {
      return {
        title: item.title, skill: item.skill, description: item.description,
        status: item.status, priority: item.priority, target_date: item.target_date
      };
    }),
    privacy_note: "CV text and private evidence details are excluded."
  };
}

document.getElementById("downloadReportButton").addEventListener("click", function() {
  downloadJson(reportPayload(), "masari-progress-report.json");
});
document.getElementById("printReportButton").addEventListener("click", function() { window.print(); });
document.getElementById("createShareLinkButton").addEventListener("click", async function() {
  const path = activePath();
  const analysis = path && (state.analyses || []).find(function(item) {
    return item.pathId === path.id && item.status === "succeeded";
  });
  if (!path || !analysis) { toast("Run a cited analysis before sharing a report"); return; }
  this.disabled = true;
  try {
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(tokenBytes).map(function(byte) { return byte.toString(16).padStart(2, "0"); }).join("");
    const tokenHash = await contentHash(token);
    const row = {
      user_id: session.user.id,
      path_id: path.id,
      analysis_id: analysis.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
    };
    const result = await cloud.from("shared_reports").insert(row).select().single();
    if (result.error) throw result.error;
    state.sharedReports.unshift(result.data);
    const shareUrl = window.location.origin + "/report.html#" + token;
    renderSharedReports();
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast("Private report link copied. It expires in 7 days.");
    } catch (_clipboardError) {
      window.prompt("Copy this private report link. It expires in 7 days.", shareUrl);
      toast("Private report link created. It expires in 7 days.");
    }
  } catch (error) {
    toast(error.message || "Share link could not be created");
  } finally { this.disabled = false; }
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
  restoreAnalysisStatus();
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
          const restoredAction = await ensureLatestAnalysisAction().catch(function() { return false; });
          document.querySelector(".storage-status span:last-child").textContent = "Encrypted cloud workspace";
          document.getElementById("saveState").textContent = "Saved privately";
          showSignedInSurface();
          if (restoredAction) toast("Added 1 action from your latest cited analysis");
          if (authEvent === "PASSWORD_RECOVERY") openPasswordSetup("recovery");
          else if (passwordSetupMode === "invite") openPasswordSetup("invite");
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
    const restoredAction = await ensureLatestAnalysisAction().catch(function() { return false; });
    document.getElementById("saveState").textContent = "Saved privately";
    showSignedInSurface();
    if (restoredAction) toast("Added 1 action from your latest cited analysis");
    if (passwordSetupMode === "invite") openPasswordSetup("invite");
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
