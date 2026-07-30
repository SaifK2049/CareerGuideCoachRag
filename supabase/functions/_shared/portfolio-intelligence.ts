type Row = Record<string, any>;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function evidence(label: string, url: string): Row {
  return { type: "public_repository", label, url };
}

export function analyseGithubRepository(
  repository: Row,
  languages: Row,
  readme: Row | null,
  workflows: Row[],
  commits: Row[],
): Row {
  const languageNames = Object.keys(languages || {});
  const hasReadme = Boolean(readme);
  const hasTests = languageNames.length > 0 && (
    /test|spec/i.test(String(repository.description || "")) ||
    Boolean(repository.has_test_evidence)
  );
  const hasCi = workflows.length > 0;
  const recentCommits = commits.filter((commit) => {
    const date = Date.parse(commit?.commit?.author?.date || "");
    return Number.isFinite(date) && date > Date.now() - 180 * 86400000;
  }).length;
  const documentation = hasReadme ? 85 : repository.description ? 35 : 10;
  const testing = hasTests ? 70 : 20;
  const ciCd = hasCi ? 85 : 15;
  const organisation = clamp(
    30 + (repository.description ? 15 : 0) + (repository.license ? 10 : 0) +
    (repository.topics?.length ? 15 : 0) + (repository.default_branch ? 10 : 0),
  );
  const technologyDiversity = clamp(languageNames.length * 18);
  const activityConsistency = clamp(Math.min(commits.length, 20) * 4 + recentCommits * 2);
  const architecture = clamp(
    organisation * 0.45 + documentation * 0.3 + technologyDiversity * 0.25,
  );
  const dimensions = {
    documentation,
    testing,
    ci_cd: ciCd,
    architecture,
    code_organisation: organisation,
    technology_diversity: technologyDiversity,
    activity_consistency: activityConsistency,
  };
  const overall = clamp(
    Object.values(dimensions).reduce((sum, score) => sum + Number(score), 0) /
      Object.keys(dimensions).length,
  );
  const recommendations: Row[] = [];
  if (!hasReadme) recommendations.push({ priority: "high", action: "Add a README with the problem, architecture, setup, and measurable outcome." });
  if (!hasTests) recommendations.push({ priority: "high", action: "Add automated tests that demonstrate the critical behaviour." });
  if (!hasCi) recommendations.push({ priority: "medium", action: "Add a CI workflow that runs tests and quality checks on each change." });
  if (!repository.license) recommendations.push({ priority: "low", action: "Clarify reuse by adding an appropriate licence." });
  if (!recommendations.length) recommendations.push({ priority: "medium", action: "Add an architecture decision record explaining one meaningful trade-off." });
  return {
    methodology_version: "github-public-signals-v1",
    overall_score: overall,
    dimensions,
    technologies: languageNames,
    signals: {
      stars: Number(repository.stargazers_count || 0),
      forks: Number(repository.forks_count || 0),
      open_issues: Number(repository.open_issues_count || 0),
      sampled_commits: commits.length,
      recent_sampled_commits: recentCommits,
      workflow_count: workflows.length,
      readme_present: hasReadme,
    },
    recommendations,
    limitations: "This report uses public repository metadata and a bounded activity sample. It does not inspect private code, infer developer ability, or replace human review.",
    evidence_refs: [
      evidence("Repository metadata", repository.html_url),
      ...(hasReadme ? [evidence("README", readme?.html_url || repository.html_url)] : []),
      ...(hasCi ? [evidence("Automation workflows", `${repository.html_url}/actions`)] : []),
    ],
  };
}

export function githubCoordinates(value: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
    return { owner, repo: repo.replace(/\.git$/i, "") };
  } catch {
    return null;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
