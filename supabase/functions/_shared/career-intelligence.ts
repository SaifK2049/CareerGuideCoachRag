type Row = Record<string, any>;

export type CareerIntelligenceInput = {
  profile: Row | null;
  paths: Row[];
  jobs: Row[];
  knowledge: Row[];
  latestAnalysis: Row | null;
  interviewSessions: Row[];
  actionPlanItems: Row[];
  graphNodes: Row[];
  taxonomyNodes: Row[];
  taxonomyEdges: Row[];
  market: Row[];
  portfolio: Row[];
  credentials: Row[];
  companyProfiles: Row[];
};

export type CareerIntelligenceResult = {
  twin: Row;
  recommendations: Row[];
  fingerprint: string;
};

function normalized(value: unknown): string {
  return String(value || "").trim();
}

function canonical(value: unknown): string {
  return normalized(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const candidate = key(value);
    if (!candidate || seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

function asArray(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function sourceLabels(analysis: Row | null): Map<string, Row> {
  return new Map(asArray(analysis?.sources).map((source) => [normalized(source.label), source]));
}

function evidenceReference(type: string, id: unknown, label = ""): Row {
  return {
    type,
    id: normalized(id),
    ...(label ? { label } : {}),
  };
}

function technicalStrengths(input: CareerIntelligenceInput): Row[] {
  const grouped = new Map<string, Row>();
  for (const item of input.knowledge) {
    const skill = normalized(item.skill);
    if (!skill) continue;
    const key = canonical(skill);
    const confidence = Math.max(1, Math.min(3, Number(item.confidence || 1)));
    const current = grouped.get(key) || {
      skill,
      confidence: 0,
      evidence_count: 0,
      evidence_refs: [],
    };
    current.confidence = Math.max(current.confidence, confidence / 3);
    current.evidence_count += 1;
    current.evidence_refs.push(evidenceReference("knowledge_evidence", item.id, item.title));
    grouped.set(key, current);
  }

  for (const finding of asArray(input.latestAnalysis?.findings)) {
    if (finding.confidence !== "strong") continue;
    const skill = normalized(finding.skill);
    const key = canonical(skill);
    if (!key) continue;
    const current = grouped.get(key) || {
      skill,
      confidence: 0.8,
      evidence_count: 0,
      evidence_refs: [],
    };
    current.confidence = Math.max(current.confidence, 0.8);
    current.analysis_explanation = normalized(finding.explanation);
    current.evidence_refs.push(
      evidenceReference("career_analysis", input.latestAnalysis?.id, skill),
    );
    grouped.set(key, current);
  }

  for (const asset of input.portfolio) {
    const overall = Number(asset.analysis?.overall_score || 0);
    for (const technology of Array.isArray(asset.technologies) ? asset.technologies : []) {
      const skill = normalized(technology);
      const key = canonical(skill);
      if (!key) continue;
      const confidence = asset.analysed_at ? Math.max(0.55, Math.min(0.9, overall / 100)) : 0.45;
      const current = grouped.get(key) || { skill, confidence: 0, evidence_count: 0, evidence_refs: [] };
      current.confidence = Math.max(current.confidence, confidence);
      current.evidence_count += 1;
      current.evidence_refs.push(evidenceReference("portfolio_asset", asset.id, asset.title));
      grouped.set(key, current);
    }
  }

  for (const credential of input.credentials) {
    for (const credentialSkill of Array.isArray(credential.skills) ? credential.skills : []) {
      const skill = normalized(credentialSkill);
      const key = canonical(skill);
      if (!key) continue;
      const confidence = credential.verification_status === "verified" ? 1 : 0.55;
      const current = grouped.get(key) || { skill, confidence: 0, evidence_count: 0, evidence_refs: [] };
      current.confidence = Math.max(current.confidence, confidence);
      current.evidence_count += 1;
      current.evidence_refs.push(evidenceReference("career_credential", credential.id, credential.name));
      grouped.set(key, current);
    }
  }

  return [...grouped.values()]
    .sort((left, right) => right.confidence - left.confidence || right.evidence_count - left.evidence_count)
    .slice(0, 12);
}

function behaviouralStrengths(input: CareerIntelligenceInput): Row[] {
  const strengths = input.interviewSessions.flatMap((session) =>
    asArray(session.assessment?.strengths).map((strength) => ({
      strength: normalized(strength.title),
      detail: normalized(strength.detail),
      confidence: session.assessment_status === "succeeded" ? 0.8 : 0.5,
      evidence_refs: [evidenceReference("interview_practice_session", session.id, session.title)],
    }))
  );
  return uniqueBy(strengths, (item) => canonical(item.strength)).slice(0, 10);
}

function missingCompetencies(input: CareerIntelligenceInput): Row[] {
  return asArray(input.latestAnalysis?.findings)
    .filter((finding) => finding.confidence === "missing" || finding.confidence === "partial")
    .map((finding) => ({
      skill: normalized(finding.skill),
      status: finding.confidence,
      explanation: normalized(finding.explanation),
      citations: Array.isArray(finding.citations) ? finding.citations.map(String) : [],
      evidence_refs: [
        evidenceReference("career_analysis", input.latestAnalysis?.id, finding.skill),
      ],
    }))
    .filter((item) => item.skill)
    .slice(0, 12);
}

function matchingJobs(skill: string, jobs: Row[]): Row[] {
  const needle = skill.toLowerCase();
  return jobs.filter((job) =>
    [job.title, job.description, job.employment_type, job.work_arrangement]
      .some((value) => normalized(value).toLowerCase().includes(needle))
  );
}

function supportingStrengths(skill: string, strengths: Row[]): Row[] {
  const tokens = new Set(canonical(skill).split("-").filter((token) => token.length > 2));
  return strengths.filter((strength) => {
    const candidate = canonical(strength.skill);
    return [...tokens].some((token) => candidate.includes(token));
  }).slice(0, 3);
}

function matchingTaxonomyNodes(skill: string, nodes: Row[]): Row[] {
  const key = canonical(skill);
  return nodes.filter((node) => {
    const labels = [node.preferred_label, ...(Array.isArray(node.aliases) ? node.aliases : [])];
    return labels.some((label) => {
      const candidate = canonical(label);
      return candidate === key || candidate.includes(key) || key.includes(candidate);
    });
  }).slice(0, 8);
}

function recommendationRows(
  input: CareerIntelligenceInput,
  gaps: Row[],
  strengths: Row[],
): Row[] {
  const labels = sourceLabels(input.latestAnalysis);
  const graphSkills = new Map(
    input.graphNodes
      .filter((node) => node.node_type === "skill")
      .map((node) => [canonical(node.label), node.id]),
  );

  return gaps.slice(0, 8).map((gap) => {
    const jobs = matchingJobs(gap.skill, input.jobs);
    const companies = [...new Set(jobs.map((job) => normalized(job.company)).filter(Boolean))];
    const citations = gap.citations
      .map((label: string) => labels.get(label))
      .filter(Boolean)
      .map((source: Row) => ({
        label: source.label,
        source_type: source.source_type,
        source_id: source.source_id,
        title: source.title,
      }));
    const support = supportingStrengths(gap.skill, strengths);
    const jobRefs = jobs.map((job) => evidenceReference("job_description", job.id, job.title));
    const taxonomyMatches = matchingTaxonomyNodes(gap.skill, input.taxonomyNodes);
    const taxonomyIds = new Set(taxonomyMatches.map((node) => node.id));
    const connectedIds = new Set(
      input.taxonomyEdges.flatMap((edge) => {
        if (taxonomyIds.has(edge.from_node_id)) return [edge.to_node_id];
        if (taxonomyIds.has(edge.to_node_id)) return [edge.from_node_id];
        return [];
      }),
    );
    const taxonomyConnections = input.taxonomyNodes.filter((node) => connectedIds.has(node.id));
    const credentialOptions = taxonomyConnections.filter((node) =>
      ["certification", "course"].includes(node.node_type)
    );
    const ownedCredentials = input.credentials.filter((credential) =>
      [credential.name, credential.issuer, ...(credential.skills || [])]
        .some((value) => normalized(value).toLowerCase().includes(normalized(gap.skill).toLowerCase()))
    );
    const market = input.market.filter((signal) =>
      [signal.subject, signal.job_family, signal.industry]
        .some((value) => normalized(value).toLowerCase().includes(normalized(gap.skill).toLowerCase()))
    ).slice(0, 20);
    const portfolioSupport = input.portfolio.filter((asset) =>
      (asset.technologies || []).some((technology: unknown) =>
        canonical(technology) === canonical(gap.skill)
      )
    );
    const estimatedDelta = Math.min(18, 3 + jobs.length * 2 + market.length);
    const arabicTitle = gap.status === "missing"
      ? `ابنِ دليلاً على مهارة ${gap.skill}`
      : `عزّز دليلك على مهارة ${gap.skill}`;
    const arabicSummary = jobs.length || market.length
      ? `تظهر مهارة ${gap.skill} في ${jobs.length} من الوظائف المحفوظة و${market.length} من إشارات سوق العمل الموثقة.`
      : `تحتاج مهارة ${gap.skill} إلى دليل أقوى ضمن مسارك المهني الحالي.`;

    return {
      recommendation_type: "skill",
      title: `${gap.status === "missing" ? "Build" : "Strengthen"} evidence for ${gap.skill}`,
      summary: gap.explanation ||
        `${gap.skill} is not yet supported strongly enough for the current target path.`,
      localized: {
        en: {
          title: `${gap.status === "missing" ? "Build" : "Strengthen"} evidence for ${gap.skill}`,
          summary: gap.explanation ||
            `${gap.skill} is not yet supported strongly enough for the current target path.`,
        },
        ar: { title: arabicTitle, summary: arabicSummary },
      },
      rationale: {
        why: gap.explanation,
        why_ar: arabicSummary,
        required_by_saved_jobs: jobs.map((job) => ({
          id: job.id,
          title: job.title,
          company: job.company,
          path_id: job.path_id,
        })),
        supporting_strengths: support.map((item) => ({
          skill: item.skill,
          confidence: item.confidence,
        })),
        certifications_that_validate_it: [
          ...ownedCredentials.map((credential) => ({
            name: credential.name,
            issuer: credential.issuer,
            verification_status: credential.verification_status,
            source: "user_credential",
          })),
          ...credentialOptions.map((node) => ({
            name: node.preferred_label,
            issuer: node.metadata?.issuer || "",
            verification_status: "not_owned",
            source: node.taxonomy,
            source_url: node.metadata?.source_url || "",
          })),
        ],
        related_taxonomy_skills: taxonomyConnections
          .filter((node) => node.node_type === "skill")
          .map((node) => ({
            label: node.preferred_label,
            taxonomy: node.taxonomy,
            external_id: node.external_id,
          })),
        learning_resources: taxonomyConnections
          .filter((node) => node.node_type === "course" && node.metadata?.source_url)
          .map((node) => ({
            title: node.preferred_label,
            url: node.metadata.source_url,
            taxonomy: node.taxonomy,
          })),
        companies_that_value_it: companies,
        market_signals: market.map((signal) => ({
          signal_type: signal.signal_type,
          country_code: signal.country_code,
          value_numeric: signal.value_numeric,
          value_unit: signal.value_unit,
          confidence: signal.confidence,
          source_name: signal.source_name,
          source_url: signal.source_url,
          observed_to: signal.observed_to,
        })),
        portfolio_evidence: portfolioSupport.map((asset) => ({
          id: asset.id,
          title: asset.title,
          overall_score: asset.analysis?.overall_score ?? null,
        })),
        analysis_citations: citations,
        limitations: market.length
          ? "Impact combines the user's saved jobs with cited market observations; it is a directional match estimate, not hiring probability."
          : jobs.length
            ? "Impact is based on the user's saved jobs because no matching sourced market observation is available."
            : "The current analysis identifies this gap, but neither a saved job nor sourced market observation contains an exact text match.",
        limitations_ar: market.length
          ? "يجمع الأثر بين الوظائف المحفوظة وإشارات سوق العمل الموثقة، وهو تقدير اتجاهي للتطابق وليس احتمالاً للتوظيف."
          : "يعتمد الأثر على الأدلة المتصلة حالياً ولا يمثل احتمالاً للتوظيف.",
      },
      impact: {
        saved_jobs_addressed: jobs.length,
        companies_addressed: companies.length,
        estimated_match_score_delta: estimatedDelta,
        employability_delta: {
          direction: estimatedDelta > 8 ? "material" : estimatedDelta > 3 ? "moderate" : "limited",
          estimated_match_score_points: estimatedDelta,
          calibrated_hiring_probability: false,
        },
        basis: market.length ? "saved_job_and_sourced_market_evidence" : "saved_job_evidence",
      },
      effort: {
        relative: gap.status === "missing" ? "high" : "medium",
        estimated_hours: null,
        basis: "A calibrated time estimate requires a selected course or project.",
      },
      evidence_refs: [
        evidenceReference("career_analysis", input.latestAnalysis?.id, gap.skill),
        ...jobRefs,
        ...support.flatMap((item) => item.evidence_refs || []),
        ...taxonomyMatches.map((node) => evidenceReference("career_taxonomy_node", node.id, node.preferred_label)),
        ...market.map((signal) => evidenceReference("labour_market_observation", signal.id, signal.subject)),
        ...portfolioSupport.map((asset) => evidenceReference("portfolio_asset", asset.id, asset.title)),
        ...ownedCredentials.map((credential) => evidenceReference("career_credential", credential.id, credential.name)),
      ],
      graph_node_ids: graphSkills.get(canonical(gap.skill))
        ? [graphSkills.get(canonical(gap.skill))]
        : [],
      source_analysis_id: input.latestAnalysis?.id || null,
      confidence: gap.status === "missing" ? 0.8 : 0.7,
    };
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildCareerIntelligence(
  input: CareerIntelligenceInput,
): Promise<CareerIntelligenceResult> {
  const profile = input.profile || {};
  const strengths = technicalStrengths(input);
  const behaviours = behaviouralStrengths(input);
  const gaps = missingCompetencies(input);
  const activePath = input.paths.find((path) => path.id === profile.active_path_id) || input.paths[0];
  const aspirations = uniqueBy(
    [
      normalized(profile.career_goal)
        ? { aspiration: normalized(profile.career_goal), source: "profile" }
        : null,
      ...input.paths.map((path) => ({
        aspiration: normalized(path.target),
        source: "career_path",
        path_id: path.id,
      })),
    ].filter(Boolean) as Row[],
    (item) => canonical(item.aspiration),
  );
  const completedActions = input.actionPlanItems.filter((item) => item.status === "completed");
  const jobCompanies = new Set(input.jobs.map((job) => canonical(job.company)).filter(Boolean));
  const preferredIndustries = [...new Set(input.companyProfiles
    .filter((company) => jobCompanies.has(canonical(company.canonical_name)))
    .flatMap((company) => Array.isArray(company.industries) ? company.industries : [])
    .map(normalized)
    .filter(Boolean))].slice(0, 12);
  const evidenceRefs = [
    ...(normalized(profile.cv_text)
      ? [evidenceReference("cv", profile.user_id, profile.cv_file_name || "Current CV")]
      : []),
    ...input.knowledge.map((item) => evidenceReference("knowledge_evidence", item.id, item.title)),
    ...input.jobs.map((job) => evidenceReference("job_description", job.id, job.title)),
    ...input.interviewSessions.map((session) =>
      evidenceReference("interview_practice_session", session.id, session.title)
    ),
    ...completedActions.map((item) => evidenceReference("action_plan_item", item.id, item.title)),
    ...input.portfolio.map((item) => evidenceReference("portfolio_asset", item.id, item.title)),
    ...input.credentials.map((item) => evidenceReference("career_credential", item.id, item.name)),
  ];
  const coverageSignals = [
    Boolean(normalized(profile.cv_text)),
    input.paths.length > 0,
    input.jobs.length > 0,
    input.knowledge.length > 0,
    Boolean(input.latestAnalysis),
    input.interviewSessions.some((session) => session.status === "completed"),
    input.portfolio.some((asset) => Boolean(asset.analysed_at)),
    input.credentials.some((credential) => credential.verification_status === "verified"),
  ];
  const confidence = coverageSignals.filter(Boolean).length / coverageSignals.length;
  const trajectory = activePath
    ? `${normalized(profile.experience_level) || "Current experience"} toward ${activePath.target}`
    : normalized(profile.career_goal) || "Add a target career path to establish a trajectory.";
  const trajectoryAr = activePath
    ? `${normalized(profile.experience_level) || "خبرتك الحالية"} نحو ${activePath.target}`
    : normalized(profile.career_goal) || "أضف مساراً مهنياً مستهدفاً لتحديد اتجاهك.";
  const summaryParts = [
    activePath ? `The current direction is ${activePath.target}.` : "No active career path is selected.",
    strengths.length
      ? `${strengths.length} technical strength${strengths.length === 1 ? "" : "s"} have structured evidence.`
      : "Technical strengths still need structured evidence.",
    gaps.length
      ? `${gaps.length} priority competenc${gaps.length === 1 ? "y" : "ies"} require stronger evidence.`
      : "The latest evidence-backed analysis has no unresolved competency gaps.",
    completedActions.length
      ? `${completedActions.length} action-plan item${completedActions.length === 1 ? " is" : "s are"} complete.`
      : "No action-plan completion is recorded yet.",
  ];

  const fingerprintPayload = {
    profile: {
      updated_at: profile.updated_at,
      active_path_id: profile.active_path_id,
      career_goal: profile.career_goal,
      experience_level: profile.experience_level,
      country: profile.country,
      guidance_locale: profile.guidance_locale,
      cv_uploaded_at: profile.cv_uploaded_at,
    },
    paths: input.paths.map((item) => [item.id, item.updated_at]),
    jobs: input.jobs.map((item) => [item.id, item.updated_at, item.application_status]),
    knowledge: input.knowledge.map((item) => [item.id, item.updated_at, item.confidence]),
    analysis: input.latestAnalysis
      ? [input.latestAnalysis.id, input.latestAnalysis.completed_at]
      : null,
    interviews: input.interviewSessions.map((item) => [
      item.id,
      item.updated_at,
      item.assessment_status,
    ]),
    actions: input.actionPlanItems.map((item) => [item.id, item.updated_at, item.status]),
    portfolio: input.portfolio.map((item) => [item.id, item.updated_at, item.analysed_at]),
    credentials: input.credentials.map((item) => [item.id, item.updated_at, item.verification_status]),
    taxonomy: input.taxonomyNodes.map((item) => [item.id, item.metadata?.source_version, item.updated_at]),
    market: input.market.map((item) => [item.id, item.observed_to, item.updated_at]),
    company_profiles: input.companyProfiles.map((item) => [item.id, item.updated_at]),
  };
  const fingerprint = await sha256(JSON.stringify(fingerprintPayload));

  return {
    fingerprint,
    twin: {
      status: "ready",
      current_experience_level: normalized(profile.experience_level),
      trajectory,
      trajectory_ar: trajectoryAr,
      guidance_locale: profile.guidance_locale === "ar" ? "ar" : "en",
      preferred_industries: preferredIndustries,
      technical_strengths: strengths,
      behavioural_strengths: behaviours,
      missing_competencies: gaps,
      long_term_aspirations: aspirations,
      summary: summaryParts.join(" "),
      summary_ar: activePath
        ? `اتجاهك الحالي هو ${activePath.target}. لديك ${strengths.length} من نقاط القوة التقنية الموثقة و${gaps.length} من فجوات الكفاءة ذات الأولوية. تم إكمال ${completedActions.length} من عناصر خطة العمل.`
        : `أضف مساراً مهنياً مستهدفاً لبناء توأمك المهني. لديك ${strengths.length} من نقاط القوة التقنية الموثقة و${gaps.length} من فجوات الكفاءة.`,
      evidence_refs: evidenceRefs,
      input_fingerprint: fingerprint,
      confidence,
      model: "deterministic-v2-foundation",
    },
    recommendations: recommendationRows(input, gaps, strengths),
  };
}
