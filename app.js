const STORAGE_KEY = "career-rag-workspace-v1";
const config = window.CAREER_RAG_CONFIG || {};
const cloud = config.supabaseUrl && config.supabasePublishableKey && window.supabase
  ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey)
  : null;
let session = null;
let cloudReady = false;
let saveQueue = Promise.resolve();

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
  ]
};

let state = loadState();
let activeView = "overview";

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || structuredClone(demoState); }
  catch (error) { return structuredClone(demoState); }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const label = document.getElementById("saveState");
  if (label) label.textContent = session ? "Saving…" : "Local preview";
  if (session && cloudReady) {
    saveQueue = saveQueue.then(persistCloudState).catch(function(error) {
      if (label) label.textContent = "Cloud save failed";
      toast(error.message || "Could not save to the cloud");
    });
  }
}

function emptyState() {
  return { activePathId: "", cv: { fileName: "", text: "", uploadedAt: "" }, paths: [], knowledge: [] };
}

async function loadCloudState() {
  const userId = session.user.id;
  const results = await Promise.all([
    cloud.from("career_profiles").select("*").eq("user_id", userId).maybeSingle(),
    cloud.from("career_paths").select("*").eq("user_id", userId).order("created_at"),
    cloud.from("job_descriptions").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    cloud.from("knowledge_evidence").select("*").eq("user_id", userId).order("created_at", { ascending: false })
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
    activePathId: profile && profile.active_path_id || (paths[0] && paths[0].id) || "",
    cv: { fileName: profile && profile.cv_file_name || "", text: profile && profile.cv_text || "", uploadedAt: profile && profile.cv_uploaded_at || "" },
    paths: paths,
    knowledge: (results[3].data || []).map(function(item) {
      return { id: item.id, skill: item.skill, title: item.title, level: item.confidence, evidence: item.evidence };
    })
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function deleteMissing(table, ids) {
  let query = cloud.from(table).delete().eq("user_id", session.user.id);
  if (ids.length) query = query.not("id", "in", "(" + ids.join(",") + ")");
  const result = await query;
  if (result.error) throw result.error;
}

async function persistCloudState() {
  const userId = session.user.id;
  const pathRows = state.paths.map(function(path) { return { id: path.id, user_id: userId, name: path.name, target: path.target, description: path.description || "", updated_at: new Date().toISOString() }; });
  const jobRows = state.paths.flatMap(function(path) {
    return path.jobs.map(function(job) { return { id: job.id, user_id: userId, path_id: path.id, title: job.title, company: job.company || "", location: job.location || "", source_url: job.source || "", description: job.description, updated_at: new Date().toISOString() }; });
  });
  const evidenceRows = state.knowledge.map(function(item) { return { id: item.id, user_id: userId, skill: item.skill, title: item.title, confidence: item.level, evidence: item.evidence, updated_at: new Date().toISOString() }; });
  for (const item of [[pathRows, "career_paths"], [jobRows, "job_descriptions"], [evidenceRows, "knowledge_evidence"]]) {
    if (item[0].length) {
      const result = await cloud.from(item[1]).upsert(item[0]);
      if (result.error) throw result.error;
    }
  }
  const profileResult = await cloud.from("career_profiles").upsert({
    user_id: userId, active_path_id: state.activePathId || null, cv_file_name: state.cv.fileName || "",
    cv_text: state.cv.text || "", cv_uploaded_at: state.cv.uploadedAt || null, updated_at: new Date().toISOString()
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

function safe(value) {
  return String(value || "").replace(/[&<>'"]/g, function(char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char];
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

function render() {
  const path = activePath();
  if (!path) {
    document.getElementById("activePathName").textContent = "Create a job path";
    document.getElementById("activePathDescription").textContent = "Add a target role, then collect job descriptions against it.";
    document.getElementById("activePathTarget").textContent = "No target selected";
    document.getElementById("activePathJobCount").textContent = "0 jobs tracked";
    document.getElementById("jobsStat").textContent = "0";
    document.getElementById("knowledgeStat").textContent = state.knowledge.length;
    document.getElementById("documentsStat").textContent = ragDocuments().length;
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

function exportRag() {
  const payload = { schema_version: "1.0", exported_at: new Date().toISOString(), workspace: "Masari", active_path: activePath() ? activePath().name : "", documents: ragDocuments() };
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  link.download = "masari-knowledge.json";
  link.click();
  toast(payload.documents.length + " RAG documents exported");
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
  return pages.join("\n\n");
}

function setView(view) {
  activeView = view;
  document.querySelectorAll(".view").forEach(function(section) { section.classList.toggle("is-visible", section.id === view + "View"); });
  document.querySelectorAll(".nav-item").forEach(function(button) { button.classList.toggle("is-active", button.dataset.view === view); });
  render();
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
document.querySelectorAll(".modal-backdrop").forEach(function(backdrop) { backdrop.addEventListener("click", function(event) { if (event.target === backdrop) closeModal(backdrop.id); }); });
document.getElementById("editPathButton").addEventListener("click", function() { openPathModal(activePath()); });
document.getElementById("exportButton").addEventListener("click", exportRag);
document.getElementById("authButton").addEventListener("click", async function() {
  if (!cloud) { toast("Copy config.example.js to config.js and add your Supabase project settings"); return; }
  if (session) { await cloud.auth.signOut(); return; }
  openModal("authModal");
});

document.getElementById("authForm").addEventListener("submit", async function(event) {
  event.preventDefault();
  const result = await cloud.auth.signInWithPassword({
    email: document.getElementById("authEmail").value.trim(),
    password: document.getElementById("authPassword").value
  });
  document.getElementById("authMessage").textContent = result.error ? result.error.message : "";
  if (!result.error) closeModal("authModal");
});

document.getElementById("signUpButton").addEventListener("click", async function() {
  const result = await cloud.auth.signUp({
    email: document.getElementById("authEmail").value.trim(),
    password: document.getElementById("authPassword").value
  });
  document.getElementById("authMessage").textContent = result.error ? result.error.message : "Account created. Check your email if confirmation is enabled.";
});

document.getElementById("analyzeButton").addEventListener("click", async function() {
  if (!cloud || !session) { toast("Sign in to run private RAG analysis"); return; }
  const button = this;
  button.disabled = true;
  button.textContent = "Analyzing…";
  try {
    await saveQueue;
    const result = await cloud.functions.invoke("analyze-career", {
      body: { pathId: state.activePathId, targetRole: activePath() && activePath().target, documents: ragDocuments() }
    });
    if (result.error) throw result.error;
    const box = document.getElementById("ragResult");
    box.innerHTML = '<div class="empty-state"><strong>Private RAG analysis</strong><p>' + safe(result.data.summary) + '</p>' +
      (result.data.findings || []).map(function(item) { return '<p><strong>' + safe(item.skill) + ' · ' + safe(item.confidence) + '</strong> ' + safe(item.explanation) + ' <span class="skill-badge warn">' + safe((item.citations || []).join(", ")) + '</span></p>'; }).join("") + '</div>';
  } catch (error) { toast(error.message || "Analysis failed"); }
  finally { button.disabled = false; button.textContent = "Run RAG analysis"; }
});

document.getElementById("pathForm").addEventListener("submit", function(event) {
  event.preventDefault();
  const id = document.getElementById("pathId").value || crypto.randomUUID();
  const existing = state.paths.find(function(path) { return path.id === id; });
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
  const record = { id: id, title: document.getElementById("jobTitle").value.trim(), company: document.getElementById("jobCompany").value.trim(), location: document.getElementById("jobLocation").value.trim(), source: document.getElementById("jobSource").value.trim(), description: document.getElementById("jobDescription").value.trim(), createdAt: new Date().toISOString() };
  if (existing) Object.assign(existing, record); else path.jobs.unshift(record);
  saveState(); closeModal("jobModal"); render(); toast("Job description added to this path");
});

document.getElementById("knowledgeForm").addEventListener("submit", function(event) {
  event.preventDefault();
  const id = document.getElementById("knowledgeId").value || crypto.randomUUID();
  const existing = state.knowledge.find(function(item) { return item.id === id; });
  const record = { id: id, skill: document.getElementById("knowledgeSkill").value.trim(), title: document.getElementById("knowledgeTitle").value.trim(), level: Number(document.getElementById("knowledgeLevel").value), evidence: document.getElementById("knowledgeEvidence").value.trim() };
  if (existing) Object.assign(existing, record); else state.knowledge.unshift(record);
  saveState(); closeModal("knowledgeModal"); render(); toast("Knowledge evidence saved");
});

document.getElementById("cvFile").addEventListener("change", async function(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  document.getElementById("cvStatus").textContent = "Extracting PDF…";
  try {
    state.cv = { fileName: file.name, text: await extractPdf(file), uploadedAt: new Date().toISOString() };
    if (cloud && session) {
      const upload = await cloud.storage.from("private-cvs").upload(session.user.id + "/" + file.name, file, { upsert: true, contentType: "application/pdf" });
      if (upload.error) throw upload.error;
    }
    saveState(); render(); toast("CV extracted and saved locally");
  } catch (error) { document.getElementById("cvStatus").textContent = "Could not extract PDF"; toast(error.message || "PDF extraction failed"); }
});

document.getElementById("saveCvButton").addEventListener("click", function() {
  state.cv.text = document.getElementById("cvText").value.trim();
  state.cv.uploadedAt = state.cv.uploadedAt || new Date().toISOString();
  saveState(); render(); document.getElementById("cvSaveMessage").textContent = "CV evidence saved"; toast("CV evidence saved");
});

document.getElementById("clearWorkspaceButton").addEventListener("click", function() {
  if (!window.confirm("Clear the CV, paths, jobs, and knowledge entries from this browser?")) return;
  state = emptyState();
  saveState(); render(); toast("Workspace cleared");
});

document.getElementById("deleteAccountButton").addEventListener("click", async function() {
  if (!cloud || !session) { toast("Sign in before deleting an account"); return; }
  if (!window.confirm("Permanently delete your account, CV files, job data, evidence, and analysis history? This cannot be undone.")) return;
  const result = await cloud.functions.invoke("delete-account", { body: { confirmation: "DELETE" } });
  if (result.error) { toast(result.error.message || "Account deletion failed"); return; }
  localStorage.removeItem(STORAGE_KEY);
  state = emptyState();
  await cloud.auth.signOut({ scope: "local" });
  render();
  toast("Account and private data deleted");
});

async function initializeCloud() {
  if (!cloud) {
    render();
    document.getElementById("saveState").textContent = "Local preview";
    return;
  }
  const result = await cloud.auth.getSession();
  session = result.data.session;
  cloud.auth.onAuthStateChange(function(_event, nextSession) {
    window.setTimeout(async function() {
      session = nextSession;
      cloudReady = false;
      if (session) {
        await loadCloudState();
        cloudReady = true;
        document.getElementById("authButton").textContent = "Sign out";
        document.querySelector(".storage-status span:last-child").textContent = "Encrypted cloud workspace";
        document.getElementById("saveState").textContent = "Saved privately";
      } else {
        state = loadState();
        document.getElementById("authButton").textContent = "Sign in";
        document.getElementById("saveState").textContent = "Local preview";
      }
      render();
    }, 0);
  });
  if (session) {
    await loadCloudState();
    cloudReady = true;
    document.getElementById("authButton").textContent = "Sign out";
    document.getElementById("saveState").textContent = "Saved privately";
  }
  render();
}

initializeCloud().catch(function(error) {
  render();
  toast(error.message || "Cloud connection failed");
});
