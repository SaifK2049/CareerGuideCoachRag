type Row = Record<string, any>;

function text(value: unknown): string {
  return String(value || "").trim();
}

function list(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
}

function reference(type: string, id: unknown, label = "", url = ""): Row {
  return { type, id: text(id), ...(label ? { label } : {}), ...(url ? { url } : {}) };
}

const TECHNOLOGIES = [
  "AWS", "Azure", "Google Cloud", "GCP", "Kubernetes", "Docker", "Terraform",
  "Python", "Java", "JavaScript", "TypeScript", "React", "Node.js", "PostgreSQL",
  "MySQL", "MongoDB", "Kafka", "Spark", "Snowflake", "Databricks", "Linux",
  "GitHub Actions", "GitLab", "Jenkins", "CI/CD", "GraphQL", "REST",
];

function jobTechnologies(description: string): Row[] {
  const lower = description.toLowerCase();
  return TECHNOLOGIES.filter((technology) => lower.includes(technology.toLowerCase()))
    .map((technology) => ({
      name: technology,
      basis: "saved_job_description",
      confidence: 0.9,
    }));
}

export function buildCompanyBrief(job: Row, profile: Row | null, market: Row[]): Row {
  const profileSources = list(profile?.sources);
  const profileTechnologies = list(profile?.technologies);
  const technologies = profileTechnologies.length
    ? profileTechnologies
    : jobTechnologies(text(job.description));
  const products = list(profile?.products);
  const hiring: Row[] = [
    ...list(profile?.hiring_signals),
    ...market.filter((signal) => ["hiring_trend", "industry_growth", "technology_adoption"].includes(signal.signal_type))
      .map((signal) => ({
        id: signal.id,
        subject: signal.subject,
        signal: signal.subject,
        type: signal.signal_type,
        value: signal.value_numeric,
        unit: signal.value_unit,
        observed_to: signal.observed_to,
        source_name: signal.source_name,
        source_url: signal.source_url,
      })),
  ];
  const news = list(profile?.recent_news);
  const expectations = list(profile?.interview_expectations);
  const competitors = list(profile?.competitors);
  const questions: Row[] = [];
  if (products.length) {
    questions.push({
      question: "Which product or customer problem is the team prioritising this year?",
      why: "The published company profile contains product information that can anchor a specific discussion.",
      evidence_refs: [reference("company_profile", profile?.id, profile?.canonical_name)],
    });
  }
  if (technologies.length) {
    const names = technologies.slice(0, 4).map((item) => text(item.name || item)).filter(Boolean);
    questions.push({
      question: `How does the team make architecture and reliability trade-offs across ${names.join(", ")}?`,
      why: "These technologies appear in the saved job or sourced company profile.",
      evidence_refs: [reference("job_description", job.id, job.title)],
    });
  }
  if (hiring.length) {
    questions.push({
      question: "What capabilities distinguish candidates who succeed during the first six months?",
      why: "The briefing contains current hiring or market signals.",
      evidence_refs: hiring.slice(0, 3).map((item) =>
        reference("labour_market_observation", item.id, item.signal || item.subject, item.source_url)
      ),
    });
  }
  if (news.length) {
    questions.push({
      question: "How is the most recent company development changing this team’s priorities?",
      why: "A dated, sourced news item is available in the company profile.",
      evidence_refs: news.slice(0, 2).map((item) =>
        reference("company_news", item.id || item.url, item.title, item.url)
      ),
    });
  }
  if (!questions.length) {
    questions.push({
      question: "What are the most important outcomes for this role in the first 90 days?",
      why: "This question is grounded in the saved role even though no sourced company profile is available.",
      evidence_refs: [reference("job_description", job.id, job.title)],
    });
  }
  return {
    company_profile_id: profile?.id || null,
    company_name: text(job.company),
    overview: {
      available: Boolean(text(profile?.overview)),
      text: text(profile?.overview),
      website_url: profile?.website_url || null,
      country_code: profile?.country_code || null,
      source_freshness_at: profile?.source_freshness_at || null,
    },
    products,
    technologies,
    hiring_trends: hiring,
    interview_expectations: expectations,
    recent_news: news,
    competitors,
    suggested_questions: questions,
    evidence_refs: [
      reference("job_description", job.id, job.title),
      ...(profile ? [reference("company_profile", profile.id, profile.canonical_name)] : []),
      ...profileSources.map((source) =>
        reference("company_source", source.id || source.url, source.title || source.name, source.url)
      ),
      ...market.map((signal) =>
        reference("labour_market_observation", signal.id, signal.subject, signal.source_url)
      ),
    ],
    limitations: profile
      ? "Company facts are limited to the cited profile sources and their freshness dates. Verify time-sensitive details before the interview."
      : "No published company profile is available. This brief only uses the saved job description and matching sourced market observations; overview, products, news, and competitors remain unavailable.",
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
