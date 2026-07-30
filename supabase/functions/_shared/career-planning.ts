type Row = Record<string, any>;

export type CareerPlanningInput = {
  twin: Row;
  jobs: Row[];
  knowledge: Row[];
  analyses: Row[];
  interviews: Row[];
  actions: Row[];
  portfolio: Row[];
  credentials: Row[];
  market: Row[];
  mobilityProfiles: Row[];
};

export type SimulationRequest = {
  type: "skill" | "certification" | "mobility" | "learning_period" | "projects";
  subject: string;
  destination?: string;
  months?: number;
  projectCount?: number;
  weeklyHours?: number;
};

function text(value: unknown): string {
  return String(value || "").trim();
}

function clamp(value: number, low = 0, high = 100): number {
  return Math.max(low, Math.min(high, Math.round(value)));
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function reference(type: string, id: unknown, label = ""): Row {
  return { type, id: text(id), ...(label ? { label } : {}) };
}

function evidenceScore(input: CareerPlanningInput): number {
  const knowledge = Math.min(30, input.knowledge.length * 6);
  const analysis = input.analyses.some((item) => item.status === "succeeded") ? 25 : 0;
  const actions = Math.min(20, input.actions.filter((item) => item.status === "completed").length * 5);
  const twin = Math.round(Number(input.twin.confidence || 0) * 25);
  return clamp(knowledge + analysis + actions + twin);
}

function portfolioScore(input: CareerPlanningInput): number {
  if (!input.portfolio.length) return 0;
  const dimensions = ["documentation", "testing", "ci_cd", "architecture", "code_organisation", "technology_diversity", "activity_consistency"];
  return clamp(average(input.portfolio.map((asset) => {
    const analysis = asset.analysis || {};
    const scores = dimensions.map((key) => Number(analysis[key]?.score ?? analysis[key] ?? 0))
      .filter((value) => Number.isFinite(value) && value >= 0);
    return scores.length ? average(scores) : 20;
  })));
}

function interviewScore(input: CareerPlanningInput): number {
  const completed = input.interviews.filter((session) => session.status === "completed");
  if (!completed.length) return 0;
  return clamp(average(completed.map((session) => {
    const assessment = session.assessment || {};
    return Number(assessment.overall_score || assessment.score || 50);
  })));
}

function category(score: number, evidenceRefs: Row[], explanation: string): Row {
  return {
    score: clamp(score),
    explanation,
    evidence_refs: evidenceRefs,
  };
}

export function buildReadinessAssessment(input: CareerPlanningInput): Row {
  const technical = evidenceScore(input);
  const portfolio = portfolioScore(input);
  const interview = interviewScore(input);
  const verified = input.credentials.filter((credential) => credential.verification_status === "verified");
  const certification = clamp(verified.length * 25);
  const experience = clamp(Number(input.twin.confidence || 0) * 70 + Math.min(30, input.jobs.length * 3));
  const leadershipEvidence = input.knowledge.filter((item) =>
    /lead|mentor|stakeholder|manage|coach/i.test([item.skill, item.title, item.evidence].join(" "))
  );
  const leadership = clamp(leadershipEvidence.length * 20);
  const communication = clamp(interview * 0.7 + leadership * 0.3);
  const projectAssets = input.portfolio.filter((asset) => asset.provider !== "other");
  const projectQuality = projectAssets.length ? portfolio : 0;
  const evidenceStrength = technical;
  const marketMatches = input.jobs.filter((job) =>
    input.knowledge.some((item) => text(job.description).toLowerCase().includes(text(item.skill).toLowerCase()))
  );
  const competitiveness = clamp(
    Number(input.twin.confidence || 0) * 40 +
    Math.min(30, marketMatches.length * 6) +
    Math.min(30, verified.length * 10),
  );
  const categories = {
    technical_readiness: category(technical, input.knowledge.map((item) => reference("knowledge_evidence", item.id, item.skill)), "Structured skill evidence and cited analyses."),
    portfolio_quality: category(portfolio, input.portfolio.map((item) => reference("portfolio_asset", item.id, item.title)), "Repository and portfolio quality dimensions."),
    communication: category(communication, input.interviews.map((item) => reference("interview_practice_session", item.id, item.title)), "Observed interview performance and communication evidence."),
    leadership: category(leadership, leadershipEvidence.map((item) => reference("knowledge_evidence", item.id, item.title)), "Leadership, mentoring, coaching, and stakeholder evidence."),
    certifications: category(certification, verified.map((item) => reference("career_credential", item.id, item.name)), "Verified, current credentials only."),
    experience: category(experience, input.twin.evidence_refs || [], "Career Twin coverage plus role and application history."),
    evidence_strength: category(evidenceStrength, input.twin.evidence_refs || [], "Coverage and confidence of structured career evidence."),
    project_quality: category(projectQuality, projectAssets.map((item) => reference("portfolio_asset", item.id, item.title)), "Quality of analysed practical project assets."),
    interview_readiness: category(interview, input.interviews.map((item) => reference("interview_practice_session", item.id, item.title)), "Completed interview assessments."),
    market_competitiveness: category(competitiveness, marketMatches.map((item) => reference("job_description", item.id, item.title)), "Saved-job matches and verified evidence; not a hiring probability."),
  };
  const values = Object.values(categories).map((item) => item.score);
  const recommendations = Object.entries(categories)
    .sort((left, right) => left[1].score - right[1].score)
    .slice(0, 3)
    .map(([key, value]) => ({
      category: key,
      current_score: value.score,
      recommendation: `Strengthen ${key.replaceAll("_", " ")} with one new verified evidence item.`,
      evidence_refs: value.evidence_refs,
    }));
  return {
    overall_score: clamp(average(values)),
    categories,
    recommendations,
    evidence_refs: [...new Map(
      Object.values(categories).flatMap((item) => item.evidence_refs)
        .map((item: Row) => [`${item.type}:${item.id}`, item]),
    ).values()],
    methodology_version: "readiness-v1",
    limitations: "Scores measure evidence coverage inside Orynta. They are not ATS scores or hiring probabilities, and missing connected data lowers the score.",
  };
}

function marketFor(input: CareerPlanningInput, request: SimulationRequest): Row[] {
  const destination = text(request.destination).toUpperCase();
  const subject = text(request.subject).toLowerCase();
  return input.market.filter((signal) =>
    (!destination || signal.country_code === destination) &&
    (!subject || [signal.subject, signal.job_family, signal.industry].some((value) =>
      text(value).toLowerCase().includes(subject)
    ))
  );
}

function savedJobMatches(input: CareerPlanningInput, subject: string): Row[] {
  const needle = text(subject).toLowerCase();
  return needle
    ? input.jobs.filter((job) => [job.title, job.description].some((value) => text(value).toLowerCase().includes(needle)))
    : [];
}

function wilsonInterval(successes: number, total: number): { low: number; high: number } {
  const z = 1.96;
  const proportion = successes / total;
  const denominator = 1 + z * z / total;
  const centre = (proportion + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt(
    (proportion * (1 - proportion) + z * z / (4 * total)) / total,
  ) / denominator;
  return {
    low: Math.max(0, Math.round((centre - margin) * 1000) / 10),
    high: Math.min(100, Math.round((centre + margin) * 1000) / 10),
  };
}

function hiringProbability(input: CareerPlanningInput, request: SimulationRequest): Row {
  const comparable = savedJobMatches(input, request.subject)
    .filter((job) => ["offer", "rejected"].includes(job.application_status || job.status));
  if (comparable.length < 20) {
    return {
      available: false,
      reason: `At least 20 comparable terminal application outcomes are required; ${comparable.length} are currently recorded.`,
      minimum_sample_size: 20,
      comparable_outcomes: comparable.length,
      scenario_adjustment_available: false,
    };
  }
  const offers = comparable.filter((job) =>
    (job.application_status || job.status) === "offer"
  ).length;
  const interval = wilsonInterval(offers, comparable.length);
  return {
    available: true,
    estimate_percent: Math.round(offers / comparable.length * 1000) / 10,
    confidence_interval_95: interval,
    comparable_outcomes: comparable.length,
    offers,
    methodology: "personal_comparable_terminal_offer_rate_wilson_v1",
    scenario_adjustment_available: false,
    basis: "Observed offer rate among this user’s comparable saved applications with terminal outcomes.",
    evidence_refs: comparable.map((job) => reference("job_description", job.id, job.title)),
    limitations: "This historical cohort estimate is not an individual hiring decision, guarantee, employer score, or causal estimate of the simulated change. Selection bias and small samples can materially affect it.",
  };
}

function salaryMidpoint(signal: Row): number {
  return (Number(signal.range_low) + Number(signal.range_high)) / 2;
}

function salaryRange(signals: Row[]): Row {
  return {
    range_low: Math.min(...signals.map((item) => Number(item.range_low))),
    range_high: Math.max(...signals.map((item) => Number(item.range_high))),
    midpoint: Math.round(average(signals.map(salaryMidpoint))),
    currency: signals[0].currency,
    observation_count: signals.length,
  };
}

function salaryProjection(signals: Row[], allMarket: Row[], request: SimulationRequest): Row {
  const salary = signals.filter((signal) =>
    signal.signal_type === "salary" && signal.range_low !== null && signal.range_high !== null
  );
  const subject = text(request.subject).toLowerCase();
  const allRelevantSalary = allMarket.filter((signal) =>
    signal.signal_type === "salary" &&
    signal.range_low !== null &&
    signal.range_high !== null &&
    (!subject || [signal.subject, signal.job_family, signal.industry].some((value) =>
      text(value).toLowerCase().includes(subject)
    ))
  );
  const regionalGroups = new Map<string, Row[]>();
  allRelevantSalary.forEach((signal) => {
    const key = [signal.country_code, signal.city, signal.currency].join("|");
    regionalGroups.set(key, [...(regionalGroups.get(key) || []), signal]);
  });
  const regionalComparisons: Row[] = [...regionalGroups.values()].map((group): Row => ({
    country_code: group[0].country_code,
    city: group[0].city,
    ...salaryRange(group),
    sources: group.map((item) => reference("labour_market_observation", item.id, item.source_name)),
  })).sort((left, right) => right.midpoint - left.midpoint);
  const progressionGroups = new Map<string, Row[]>();
  salary.forEach((signal) => {
    const key = text(signal.experience_level || "unspecified");
    progressionGroups.set(key, [...(progressionGroups.get(key) || []), signal]);
  });
  const experienceOrder = ["entry", "junior", "mid", "senior", "lead", "executive", "unspecified"];
  const careerProgression = [...progressionGroups.entries()].map(([experienceLevel, group]) => ({
    experience_level: experienceLevel,
    ...salaryRange(group),
    sources: group.map((item) => reference("labour_market_observation", item.id, item.source_name)),
  })).sort((left, right) =>
    experienceOrder.indexOf(left.experience_level) - experienceOrder.indexOf(right.experience_level)
  );
  if (!salary.length) {
    return {
      available: false,
      reason: "No sourced salary observation matches this scenario.",
      regional_comparisons: regionalComparisons,
      career_progression: careerProgression,
      skill_premium: {
        available: false,
        reason: "A comparable sourced baseline and scenario salary are required before calculating a skill premium.",
      },
      certification_impact: {
        available: false,
        reason: request.type === "certification"
          ? "No comparable salary evidence isolates this credential’s impact."
          : "Certification impact applies only to certification scenarios.",
      },
    };
  }
  const costOfLiving = signals.find((signal) =>
    signal.signal_type === "cost_of_living" && Number.isFinite(Number(signal.value_numeric))
  );
  const result: Row = {
    available: true,
    ...salaryRange(salary),
    sources: salary.map((item) => ({
      id: item.id,
      source_name: item.source_name,
      source_url: item.source_url,
      observed_to: item.observed_to,
    })),
    regional_comparisons: regionalComparisons,
    career_progression: careerProgression,
  };
  const destination = text(request.destination).toUpperCase();
  const jobFamilies = new Set(salary.map((item) => text(item.job_family).toLowerCase()).filter(Boolean));
  const baselineCandidates = allMarket.filter((signal) =>
    signal.signal_type === "salary" &&
    signal.range_low !== null &&
    signal.range_high !== null &&
    (!destination || signal.country_code === destination) &&
    (!jobFamilies.size || jobFamilies.has(text(signal.job_family).toLowerCase())) &&
    ![signal.subject, signal.industry].some((value) => text(value).toLowerCase().includes(subject))
  );
  const explicitBaseline = baselineCandidates.filter((signal) =>
    /\bbaseline\b|\boverall\b|\bgeneral\b/i.test(text(signal.subject))
  );
  const baseline = explicitBaseline.length ? explicitBaseline : baselineCandidates;
  if (baseline.length && baseline[0].currency === result.currency) {
    const baselineRange = salaryRange(baseline);
    const difference = result.midpoint - baselineRange.midpoint;
    result.skill_premium = {
      available: true,
      amount: Math.round(difference),
      percent: baselineRange.midpoint ? Math.round(difference / baselineRange.midpoint * 100) : 0,
      currency: result.currency,
      scenario_midpoint: result.midpoint,
      baseline_midpoint: baselineRange.midpoint,
      basis: "Difference between matching scenario observations and broader same-market job-family observations.",
      sources: [
        ...result.sources,
        ...baseline.map((item) => ({
          id: item.id,
          source_name: item.source_name,
          source_url: item.source_url,
          observed_to: item.observed_to,
        })),
      ],
    };
  } else {
    result.skill_premium = {
      available: false,
      reason: "No comparable same-currency job-family baseline is available.",
    };
  }
  result.certification_impact = request.type === "certification" && result.skill_premium.available
    ? {
      ...result.skill_premium,
      basis: "Directional difference for observations matching this credential; it does not establish that certification caused the difference.",
      causal: false,
    }
    : {
      available: false,
      reason: request.type === "certification"
        ? "No comparable salary evidence isolates this credential’s impact."
        : "Certification impact applies only to certification scenarios.",
    };
  if (costOfLiving && Number(costOfLiving.value_numeric) > 0) {
    result.cost_of_living = {
      index: Number(costOfLiving.value_numeric),
      unit: costOfLiving.value_unit,
      adjusted_range_low: Math.round(result.range_low * 100 / Number(costOfLiving.value_numeric)),
      adjusted_range_high: Math.round(result.range_high * 100 / Number(costOfLiving.value_numeric)),
      explanation: "Directional purchasing-power comparison, normalised to an index baseline of 100.",
      source: {
        id: costOfLiving.id,
        source_name: costOfLiving.source_name,
        source_url: costOfLiving.source_url,
        observed_to: costOfLiving.observed_to,
      },
    };
  }
  return result;
}

function mobilityProjection(
  input: CareerPlanningInput,
  request: SimulationRequest,
  readiness: Row,
  signals: Row[],
): Row {
  if (request.type !== "mobility") return { available: false, reason: "This is not a mobility scenario." };
  const destination = text(request.destination).toUpperCase();
  const profile = input.mobilityProfiles.find((item) => item.country_code === destination);
  if (!profile) {
    return {
      available: false,
      reason: "Select one of the supported EMEA destinations to receive mobility guidance.",
    };
  }
  const demand = signals.filter((signal) =>
    ["skill_demand", "hiring_trend", "industry_growth", "technology_adoption"].includes(signal.signal_type)
  );
  const technical = Number(readiness.categories?.technical_readiness?.score || 0);
  const marketBoost = Math.min(15, demand.length * 3);
  const missing = (input.twin.missing_competencies || []).map((gap: Row) => gap.skill).filter(Boolean);
  return {
    available: true,
    country_code: destination,
    country_name: profile.country_name,
    country_name_ar: profile.country_name_ar,
    skill_readiness: {
      score: clamp(technical + marketBoost),
      basis: "Current technical evidence plus matching sourced destination demand signals.",
      evidence_refs: [
        ...(readiness.categories?.technical_readiness?.evidence_refs || []),
        ...demand.map((signal) => reference("labour_market_observation", signal.id, signal.subject)),
      ],
    },
    visa_considerations: profile.visa_considerations,
    language_requirements: profile.language_requirements,
    market_demand: {
      available: demand.length > 0,
      matching_signals: demand.length,
      observations: demand.slice(0, 10).map((signal) => ({
        subject: signal.subject,
        signal_type: signal.signal_type,
        value_numeric: signal.value_numeric,
        value_unit: signal.value_unit,
        confidence: signal.confidence,
        observed_to: signal.observed_to,
        source_name: signal.source_name,
        source_url: signal.source_url,
      })),
      reason: demand.length ? "" : "No sourced destination-demand observations match the selected goal.",
    },
    recommended_certifications: profile.recommended_certifications || [],
    missing_competencies: missing,
    official_sources: profile.official_sources || [],
    reviewed_on: profile.reviewed_on,
    limitations: "Immigration and professional-licensing rules depend on citizenship, personal circumstances, occupation, and current law. This is planning guidance, not legal advice; verify every requirement with the linked authority.",
    limitations_ar: "تعتمد قواعد الهجرة والترخيص المهني على الجنسية والظروف الشخصية والمهنة والقانون الحالي. هذا إرشاد للتخطيط وليس استشارة قانونية؛ تحقّق من كل متطلب لدى الجهة الرسمية المرتبطة.",
  };
}

function learningResources(subject: string): Row[] {
  const normalized = subject.toLowerCase();
  const catalog: Array<{ pattern: RegExp; title: string; url: string }> = [
    { pattern: /kubernetes/, title: "Kubernetes official tutorials", url: "https://kubernetes.io/docs/tutorials/" },
    { pattern: /\baws\b|amazon web services/, title: "AWS Skill Builder", url: "https://skillbuilder.aws/" },
    { pattern: /\bazure\b/, title: "Microsoft Learn for Azure", url: "https://learn.microsoft.com/training/azure/" },
    { pattern: /google cloud|\bgcp\b/, title: "Google Cloud training", url: "https://cloud.google.com/learn/training" },
    { pattern: /terraform/, title: "HashiCorp Terraform tutorials", url: "https://developer.hashicorp.com/terraform/tutorials" },
    { pattern: /docker|container/, title: "Docker Get Started", url: "https://docs.docker.com/get-started/" },
    { pattern: /python/, title: "Python tutorial", url: "https://docs.python.org/3/tutorial/" },
    { pattern: /security|owasp/, title: "OWASP learning resources", url: "https://owasp.org/www-project-web-security-testing-guide/" },
  ];
  const matching = catalog.filter((item) => item.pattern.test(normalized));
  return (matching.length ? matching : [{
    pattern: /.*/,
    title: "European Digital Skills and Jobs training catalogue",
    url: "https://digital-skills-jobs.europa.eu/en/opportunities/training",
  }]).map((item) => ({
    title: item.title,
    url: item.url,
    provider_type: "official_or_public_institution",
  }));
}

export function buildSimulation(
  input: CareerPlanningInput,
  request: SimulationRequest,
  readiness: Row,
): Row {
  const subject = text(request.subject);
  const jobMatches = savedJobMatches(input, subject);
  const marketSignals = marketFor(input, request);
  const demandSignals = marketSignals.filter((signal) => signal.signal_type === "skill_demand");
  const currentSkills = new Set(input.knowledge.map((item) => text(item.skill).toLowerCase()));
  const alreadySupported = currentSkills.has(subject.toLowerCase());
  const effortHours = request.type === "projects"
    ? Math.max(20, Number(request.projectCount || 1) * 35)
    : request.type === "learning_period"
      ? Math.max(20, Number(request.months || 6) * Number(request.weeklyHours || 6) * 4)
      : request.type === "mobility" ? 24 : request.type === "certification" ? 80 : 60;
  const evidenceDelta = alreadySupported ? 2 : Math.min(12, 3 + jobMatches.length * 2);
  const demandDelta = demandSignals.length ? Math.min(6, demandSignals.length * 2) : 0;
  const matchDelta = clamp(evidenceDelta + demandDelta, 0, 18);
  const baselineScore = Number(readiness.overall_score || 0);
  const eligibleRoles = [...new Set(jobMatches.map((job) => text(job.title)).filter(Boolean))];
  const evidenceRefs = [
    ...jobMatches.map((job) => reference("job_description", job.id, job.title)),
    ...marketSignals.map((signal) => reference("labour_market_observation", signal.id, signal.subject)),
    ...input.knowledge.filter((item) => text(item.skill).toLowerCase() === subject.toLowerCase())
      .map((item) => reference("knowledge_evidence", item.id, item.title)),
  ];
  const weeks = Math.max(1, Math.ceil(effortHours / Math.max(1, Number(request.weeklyHours || 6))));
  const resources = learningResources(subject);
  const roadmap = [
    {
      sequence: 1,
      type: "learn",
      title: `Build foundations for ${subject || request.type}`,
      title_ar: `ابنِ الأساسيات لـ ${subject || request.type}`,
      estimated_hours: Math.ceil(effortHours * 0.35),
      verification_criteria: "Complete a defined resource and capture notes or an assessment result.",
      verification_criteria_ar: "أكمل مورداً محدداً وسجّل الملاحظات أو نتيجة التقييم.",
      resources,
    },
    {
      sequence: 2,
      type: request.type === "certification" ? "certification" : "project",
      title: request.type === "certification"
        ? `Complete and verify the ${subject} credential`
        : `Create practical evidence for ${subject || request.type}`,
      title_ar: request.type === "certification"
        ? `أكمل اعتماد ${subject} وتحقق منه`
        : `أنشئ دليلاً عملياً على ${subject || request.type}`,
      estimated_hours: Math.ceil(effortHours * 0.45),
      verification_criteria: request.type === "certification"
        ? "Link an issuer-hosted credential that can be independently verified."
        : "Produce a reviewable artifact with scope, decisions, tests, and outcomes.",
      verification_criteria_ar: request.type === "certification"
        ? "اربط اعتماداً مستضافاً لدى الجهة المصدرة ويمكن التحقق منه بشكل مستقل."
        : "أنشئ مخرجاً قابلاً للمراجعة يوضح النطاق والقرارات والاختبارات والنتائج.",
      resources,
    },
    {
      sequence: 3,
      type: "verification",
      title: "Verify impact and refresh the Career Twin",
      title_ar: "تحقق من الأثر وحدّث التوأم المهني",
      estimated_hours: Math.ceil(effortHours * 0.2),
      verification_criteria: "Link the artifact, rerun analysis, and compare the readiness baseline.",
      verification_criteria_ar: "اربط المخرج، وأعد تشغيل التحليل، وقارن بخط أساس الجاهزية.",
      resources: [],
    },
  ];
  return {
    scenario: request,
    baseline: {
      readiness_score: baselineScore,
      supported: alreadySupported,
      saved_jobs_matched: jobMatches.length,
    },
    projection: {
      match_score: {
        baseline: baselineScore,
        projected: clamp(baselineScore + matchDelta),
        delta: matchDelta,
        basis: "readiness evidence plus exact saved-job and sourced market matches",
      },
      salary: salaryProjection(marketSignals, input.market, request),
      mobility: mobilityProjection(input, request, readiness, marketSignals),
      hiring_probability: hiringProbability(input, request),
      time_to_transition: {
        estimated_weeks: weeks,
        weekly_hours: Number(request.weeklyHours || 6),
        basis: "scenario effort divided by the selected weekly study capacity",
      },
      new_eligible_roles: eligibleRoles,
      required_effort: { estimated_hours: effortHours, relative: effortHours >= 80 ? "high" : effortHours >= 40 ? "medium" : "low" },
      remaining_skill_gaps: (input.twin.missing_competencies || [])
        .filter((gap: Row) => text(gap.skill).toLowerCase() !== subject.toLowerCase())
        .map((gap: Row) => gap.skill),
    },
    roadmap,
    evidence_refs: evidenceRefs,
    assumptions: [
      "The user completes and verifies every roadmap milestone.",
      "Saved-job requirements remain representative of the selected direction.",
      marketSignals.length
        ? "Market projections use the cited observations and their original coverage windows."
        : "No labour-market projection is shown where sourced observations are unavailable.",
    ],
    confidence: Math.min(0.9, 0.35 + jobMatches.length * 0.08 + marketSignals.length * 0.05 + Number(input.twin.confidence || 0) * 0.25),
    model: "deterministic-v1",
  };
}
