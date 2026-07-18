const reportConfig = window.CAREER_RAG_CONFIG || {};
const reportClient = window.supabase.createClient(reportConfig.supabaseUrl, reportConfig.supabasePublishableKey);
const reportRoot = document.getElementById("publicReport");

function reportSafe(value) {
  return String(value || "").replace(/[&<>'"]/g, function(char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char];
  });
}

async function loadSharedReport() {
  const token = window.location.hash.slice(1);
  history.replaceState({}, "", window.location.pathname);
  const result = await reportClient.functions.invoke("shared-report", { body: { token: token } });
  if (result.error || !result.data?.report) {
    reportRoot.innerHTML = '<div class="panel"><p class="eyebrow">Masari shared report</p><h1>Report unavailable</h1><p class="muted-copy">This link is invalid, expired, or has been revoked.</p></div>';
    return;
  }
  const report = result.data.report;
  reportRoot.innerHTML = '<article class="public-report"><p class="eyebrow">Masari career progress report</p><h1>' +
    reportSafe(report.path.name) + '</h1><p class="report-target">' + reportSafe(report.path.target) +
    '</p><p class="muted-copy">' + reportSafe(report.analysis.summary) + '</p><h2>Cited findings</h2><div class="public-findings">' +
    (report.analysis.findings || []).map(function(item) {
      return '<section><strong>' + reportSafe(item.skill) + '</strong><span class="skill-badge">' +
        reportSafe(item.confidence) + '</span><p>' + reportSafe(item.explanation) + '</p></section>';
    }).join("") + '</div><h2>Action plan</h2><div class="public-actions">' +
    (report.actions || []).map(function(item) {
      return '<section><strong>' + reportSafe(item.title) + '</strong><span>' + reportSafe(item.status.replace("_", " ")) +
        '</span><p>' + reportSafe(item.description) + '</p></section>';
    }).join("") + '</div><p class="report-expiry">Link expires ' + reportSafe(new Date(report.expiresAt).toLocaleDateString()) +
    ' · CV and private evidence details are excluded.</p></article>';
}

loadSharedReport();
