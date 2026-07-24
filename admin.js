const adminConfig = window.CAREER_RAG_CONFIG || {};
const adminCloud = adminConfig.supabaseUrl && adminConfig.supabasePublishableKey && window.supabase
  ? window.supabase.createClient(adminConfig.supabaseUrl, adminConfig.supabasePublishableKey)
  : null;
let adminSession = null;
let adminView = "overview";
let userPage = 1;
let waitlistPage = 1;
let feedbackPage = 1;
const pageSize = 25;

function adminSafe(value) { const div = document.createElement("div"); div.textContent = value == null ? "" : String(value); return div.innerHTML; }
function number(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
function date(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "—"; }
function percentChange(current, previous) { if (!previous) return current ? "New in this period" : "No change"; const change = Math.round((current - previous) / previous * 100); return (change > 0 ? "+" : "") + change + "% vs previous"; }
function isoDate(value) { return value.toISOString().slice(0, 10); }
function range() { return { from: document.getElementById("rangeFrom").value + "T00:00:00.000Z", to: document.getElementById("rangeTo").value + "T23:59:59.999Z" }; }
function setMessage(message, error) { const box = document.getElementById("pageMessage"); box.textContent = message || ""; box.style.color = error ? "var(--danger)" : "var(--muted)"; }

async function invoke(body, download) {
  const result = await adminCloud.functions.invoke("admin-analytics", { body: { ...range(), ...body } });
  if (result.error) {
    const context = result.error.context;
    if (context && context.status === 403) showDenied();
    let message = result.error.message || "Analytics could not be loaded";
    try { if (context) { const details = await context.clone().json(); message = details.error || message; } } catch (_error) {}
    throw new Error(message);
  }
  if (download) return result.data;
  return result.data;
}

function metric(label, value, note) { return `<div><dt>${adminSafe(label)}</dt><dd>${adminSafe(value)}</dd><small>${adminSafe(note || "")}</small></div>`; }
function compact(label, value) { return `<div class="compact-row"><span>${adminSafe(String(label).replaceAll("_", " "))}</span><strong>${adminSafe(value)}</strong></div>`; }
function successRate(completed, failed) { const total = Number(completed || 0) + Number(failed || 0); return total ? Math.round(Number(completed || 0) / total * 100) + "%" : "—"; }

function renderChart(items) {
  const box = document.getElementById("activityChart");
  if (!items.length) { box.innerHTML = '<p class="empty">No activity events in this range.</p>'; return; }
  const width = 760, height = 220, pad = 28;
  const max = Math.max(1, ...items.flatMap((item) => [Number(item.new_users), Number(item.active_users)]));
  function points(key) { return items.map((item, index) => `${pad + index * (width - pad * 2) / Math.max(1, items.length - 1)},${height - pad - Number(item[key]) / max * (height - pad * 2)}`).join(" "); }
  const labels = items.filter((_item, index) => index === 0 || index === items.length - 1 || index % Math.max(1, Math.floor(items.length / 5)) === 0).map((item) => {
    const index = items.indexOf(item); return `<text class="chart-label" x="${pad + index * (width - pad * 2) / Math.max(1, items.length - 1)}" y="214" text-anchor="middle">${adminSafe(String(item.bucket).slice(5, 10))}</text>`;
  }).join("");
  box.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="New and active users over time"><line class="chart-grid" x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}"/><line class="chart-grid" x1="${pad}" y1="${pad}" x2="${width-pad}" y2="${pad}"/><polyline class="chart-active" points="${points("active_users")}"/><polyline class="chart-new" points="${points("new_users")}"/>${labels}</svg><div class="chart-legend"><span><i></i>Active users</span><span><i class="new"></i>New users</span></div>`;
}

async function loadOverview() {
  const response = await invoke({ operation: "overview" });
  const data = response.data || {};
  const t = data.totals || {};
  document.getElementById("overviewMetrics").innerHTML = [
    metric("Total users", number(t.total_users)), metric("New users", number(t.new_users), percentChange(t.new_users, t.previous_new_users)),
    metric("Active users", number(t.active_users), percentChange(t.active_users, t.previous_active_users)), metric("Onboarded", number(t.onboarded_users)),
    metric("Premium", number(t.premium_users)), metric("Waitlist", number(t.waitlist_signups)), metric("Feedback", number(t.feedback_items)),
  ].join("");
  document.getElementById("trendGranularity").textContent = (data.range?.granularity || "day") + "ly";
  renderChart(data.trend || []);
  const activation = data.activation || [];
  const top = Number(activation[0]?.count || 1);
  document.getElementById("activationFunnel").innerHTML = activation.map((item) => `<div class="funnel-row"><span>${adminSafe(item.stage.replaceAll("_", " "))}</span><div class="funnel-track"><i style="width:${Math.round(Number(item.count) / top * 100)}%"></i></div><strong>${number(item.count)}</strong></div>`).join("") || '<p class="empty">No accounts joined in this range.</p>';
  document.getElementById("featureRows").innerHTML = (data.features || []).map((item) => `<tr><td>${adminSafe(item.workflow.replaceAll("_", " "))}</td><td>${number(item.users)}</td><td>${number(item.completed)}</td><td>${number(item.failed)}</td><td>${successRate(item.completed, item.failed)}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">No workflow events yet.</td></tr>';
  document.getElementById("applicationPipeline").innerHTML = (data.applications || []).map((item) => compact(item.status, number(item.count))).join("") || '<p class="empty">No applications.</p>';
  const plans = (data.plans || []).map((item) => compact(item.plan + " · " + item.status, number(item.count))).join("");
  const feedback = (data.feedback_categories || []).map((item) => compact("Feedback · " + item.category, number(item.count))).join("");
  document.getElementById("planFeedbackSummary").innerHTML = plans + feedback || '<p class="empty">No plan or feedback data.</p>';
}

function pagination(container, page, total, callback) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  container.innerHTML = `<button type="button" ${page <= 1 ? "disabled" : ""}>Previous</button><span>Page ${page} of ${pages}</span><button type="button" ${page >= pages ? "disabled" : ""}>Next</button>`;
  const buttons = container.querySelectorAll("button"); buttons[0].onclick = () => callback(page - 1); buttons[1].onclick = () => callback(page + 1);
}

async function loadUsers(page) {
  userPage = page || 1;
  const response = await invoke({ operation: "users", page: userPage, pageSize, search: document.getElementById("userSearch").value, plan: document.getElementById("userPlan").value, onboarding: document.getElementById("userOnboarding").value });
  document.getElementById("userCount").textContent = number(response.total) + " users";
  document.getElementById("userRows").innerHTML = (response.items || []).map((item) => `<tr><td><strong>${adminSafe(item.display_name || item.email)}</strong><span>${adminSafe(item.email)} · ${adminSafe(item.user_id)}</span></td><td>${date(item.created_at)}</td><td>${date(item.last_active_at)}</td><td>${adminSafe(item.plan_code)}</td><td>${item.onboarding_complete ? "Complete" : "Incomplete"}</td><td>${number(item.job_count)}</td><td>${number(item.analysis_count)}</td><td>${number(item.interview_count)}</td></tr>`).join("") || '<tr><td colspan="8" class="empty">No users match these filters.</td></tr>';
  pagination(document.getElementById("userPagination"), userPage, response.total, loadUsers);
}

async function loadFeedback(page) {
  feedbackPage = page || 1;
  const response = await invoke({ operation: "feedback", page: feedbackPage, pageSize, search: document.getElementById("feedbackSearch").value, category: document.getElementById("feedbackCategory").value });
  document.getElementById("feedbackCount").textContent = number(response.total) + " items";
  document.getElementById("feedbackRows").innerHTML = (response.items || []).map((item) => `<article class="feedback-item"><header><strong>${adminSafe(item.category)}</strong><time>${date(item.created_at)}</time></header><p>${adminSafe(item.message)}</p><footer>${adminSafe(item.email)} · ${adminSafe(item.view_name || "unknown view")} · ${adminSafe(item.app_version || "unknown version")}</footer></article>`).join("") || '<p class="empty">No feedback matches these filters.</p>';
  pagination(document.getElementById("feedbackPagination"), feedbackPage, response.total, loadFeedback);
}

async function sendWaitlistInvite(button) {
  const email = button.dataset.email || "this person";
  if (!window.confirm(`Send a Orynta account invitation to ${email}?`)) return;
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    await invoke({ operation: "invite", signupId: button.dataset.inviteId });
    await loadWaitlist(waitlistPage);
    setMessage(`Invitation sent to ${email}.`);
  } catch (error) {
    setMessage(error.message, true);
    try { await loadWaitlist(waitlistPage); } catch (_reloadError) {}
  }
}

async function loadWaitlist(page) {
  waitlistPage = page || 1;
  const response = await invoke({ operation: "waitlist", page: waitlistPage, pageSize, search: document.getElementById("waitlistSearch").value, status: document.getElementById("waitlistStatus").value });
  document.getElementById("waitlistCount").textContent = number(response.total) + " signups";
  document.getElementById("waitlistRows").innerHTML = (response.items || []).map((item) => {
    const canInvite = item.status === "pending" || item.status === "failed";
    const action = canInvite
      ? `<button class="invite-button" type="button" data-invite-id="${adminSafe(item.id)}" data-email="${adminSafe(item.email)}">${item.status === "failed" ? "Retry invite" : "Send invite"}</button>`
      : `<span>${item.status === "joined" ? "Account active" : item.status === "invited" ? "Sent" : "Processing"}</span>`;
    return `<tr><td><strong>${adminSafe(item.display_name || item.email)}</strong><span>${adminSafe(item.email)}</span></td><td>${date(item.created_at)}</td><td>${adminSafe(item.source)}</td><td>${adminSafe(item.status)}</td><td>${date(item.invited_at)}</td><td>${action}</td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">No waitlist signups match these filters.</td></tr>';
  document.querySelectorAll("[data-invite-id]").forEach((button) => button.onclick = () => sendWaitlistInvite(button));
  pagination(document.getElementById("waitlistPagination"), waitlistPage, response.total, loadWaitlist);
}

async function loadSystem() {
  const response = await invoke({ operation: "system" }); const data = response.data || {};
  const operations = data.operations || []; const success = operations.reduce((sum, item) => sum + Number(item.succeeded || 0), 0); const failed = operations.reduce((sum, item) => sum + Number(item.failed || 0), 0);
  document.getElementById("systemMetrics").innerHTML = [metric("Operations", number(success + failed)), metric("Succeeded", number(success)), metric("Failed", number(failed)), metric("Success rate", successRate(success, failed)), metric("Stalled analyses", number(data.stalled?.analyses)), metric("Stripe errors", number(data.stripe_errors))].join("");
  document.getElementById("operationRows").innerHTML = operations.map((item) => `<tr><td>${adminSafe(item.operation.replaceAll("_", " "))}</td><td>${number(item.succeeded)}</td><td>${number(item.failed)}</td><td>${adminSafe(item.success_rate)}%</td><td>${number(item.p50_latency_ms)} ms</td><td>${number(item.p95_latency_ms)} ms</td><td>${number(item.input_tokens)}</td><td>${number(item.output_tokens)}</td></tr>`).join("") || '<tr><td colspan="8" class="empty">No operational events in this range.</td></tr>';
  document.getElementById("failureRows").innerHTML = (data.failures || []).map((item) => compact(item.operation + " · " + item.error_code, number(item.count))).join("") || '<p class="empty">No failures.</p>';
  document.getElementById("modelRows").innerHTML = (data.models || []).map((item) => compact(item.model, number(item.requests) + " requests · " + number(Number(item.input_tokens) + Number(item.output_tokens)) + " tokens")).join("") || '<p class="empty">No model usage.</p>';
}

async function loadCurrent() { setMessage("Loading…"); try { if (adminView === "overview") await loadOverview(); else if (adminView === "users") await loadUsers(userPage); else if (adminView === "waitlist") await loadWaitlist(waitlistPage); else if (adminView === "feedback") await loadFeedback(feedbackPage); else await loadSystem(); setMessage(""); } catch (error) { setMessage(error.message, true); } }
function setView(view) { adminView = view; document.querySelectorAll(".admin-view").forEach((section) => section.classList.toggle("is-visible", section.id === view + "View")); document.querySelectorAll("[data-admin-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.adminView === view)); const labels = { overview: ["Overview", "Product adoption and account health"], users: ["Users", "Account activity and entitlements"], waitlist: ["Waitlist", "Early-access signups and invitations"], feedback: ["Feedback", "Private beta submissions"], system: ["System", "Workflow reliability and AI usage"] }; document.getElementById("adminTitle").textContent = labels[view][0]; document.getElementById("adminSubtitle").textContent = labels[view][1]; document.querySelector(".admin-sidebar").classList.remove("is-open"); loadCurrent(); }
function showDenied() { document.getElementById("adminAuth").classList.add("hidden"); document.getElementById("adminShell").classList.add("hidden"); document.getElementById("adminDenied").classList.remove("hidden"); }
async function signOut() { await adminCloud.auth.signOut(); location.reload(); }

document.getElementById("adminLoginForm").addEventListener("submit", async function(event) { event.preventDefault(); const message = document.getElementById("adminLoginMessage"); message.textContent = "Signing in…"; const result = await adminCloud.auth.signInWithPassword({ email: document.getElementById("adminEmail").value, password: document.getElementById("adminPassword").value }); if (result.error) { message.textContent = result.error.message; return; } adminSession = result.data.session; await initialize(); });
document.querySelectorAll("[data-admin-view]").forEach((button) => button.onclick = () => setView(button.dataset.adminView));
document.querySelectorAll("[data-days]").forEach((button) => button.onclick = () => { const days = Number(button.dataset.days); const to = new Date(); const from = new Date(to.getTime() - (days - 1) * 86400000); document.getElementById("rangeFrom").value = isoDate(from); document.getElementById("rangeTo").value = isoDate(to); document.querySelectorAll("[data-days]").forEach((item) => item.classList.toggle("is-active", item === button)); loadCurrent(); });
document.getElementById("rangeForm").onsubmit = (event) => { event.preventDefault(); document.querySelectorAll("[data-days]").forEach((item) => item.classList.remove("is-active")); loadCurrent(); };
document.getElementById("userFilters").onsubmit = (event) => { event.preventDefault(); loadUsers(1); };
document.getElementById("waitlistFilters").onsubmit = (event) => { event.preventDefault(); loadWaitlist(1); };
document.getElementById("feedbackFilters").onsubmit = (event) => { event.preventDefault(); loadFeedback(1); };
document.querySelectorAll("[data-export]").forEach((button) => button.onclick = async () => { try { setMessage("Preparing export…"); const filters = button.dataset.export === "users" ? { search: document.getElementById("userSearch").value, plan: document.getElementById("userPlan").value, onboarding: document.getElementById("userOnboarding").value } : button.dataset.export === "feedback" ? { search: document.getElementById("feedbackSearch").value, category: document.getElementById("feedbackCategory").value } : {}; const data = await invoke({ operation: "export", dataset: button.dataset.export, ...filters }, true); const blob = data instanceof Blob ? data : new Blob([data], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `masari-${button.dataset.export}.csv`; link.click(); URL.revokeObjectURL(url); setMessage(""); } catch (error) { setMessage(error.message, true); } });
document.getElementById("adminSignOut").onclick = signOut; document.getElementById("deniedSignOut").onclick = signOut;
document.getElementById("adminMenu").onclick = function() { const sidebar = document.querySelector(".admin-sidebar"); const open = sidebar.classList.toggle("is-open"); this.setAttribute("aria-expanded", String(open)); };

async function initialize() {
  if (!adminCloud) { document.getElementById("adminLoginMessage").textContent = "Orynta is not configured."; return; }
  const sessionResult = await adminCloud.auth.getSession(); adminSession = sessionResult.data.session;
  if (!adminSession) return;
  const to = new Date(); const from = new Date(to.getTime() - 29 * 86400000); document.getElementById("rangeFrom").value = isoDate(from); document.getElementById("rangeTo").value = isoDate(to);
  document.getElementById("adminIdentity").textContent = adminSession.user.email || "Administrator";
  try { await invoke({ operation: "overview" }); document.getElementById("adminAuth").classList.add("hidden"); document.getElementById("adminDenied").classList.add("hidden"); document.getElementById("adminShell").classList.remove("hidden"); await loadOverview(); } catch (error) { if (!document.getElementById("adminDenied").classList.contains("hidden")) return; document.getElementById("adminLoginMessage").textContent = error.message; }
}
initialize();
