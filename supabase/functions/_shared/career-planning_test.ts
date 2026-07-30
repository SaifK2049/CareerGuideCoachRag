import {
  buildReadinessAssessment,
  buildSimulation,
  type CareerPlanningInput,
} from "./career-planning.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const salarySignal = (
  id: string,
  country: string,
  city: string,
  experience: string,
  subject: string,
  low: number,
  high: number,
) => ({
  id,
  country_code: country,
  city,
  industry: "Technology",
  job_family: "Cloud Engineering",
  experience_level: experience,
  signal_type: "salary",
  subject,
  range_low: low,
  range_high: high,
  currency: "EUR",
  source_name: "Market source",
  source_url: `https://example.com/${id}`,
  observed_to: "2026-06-30",
});

const input: CareerPlanningInput = {
  twin: { confidence: 0.75, missing_competencies: [], evidence_refs: [] },
  jobs: [],
  knowledge: [],
  analyses: [],
  interviews: [],
  actions: [],
  portfolio: [],
  credentials: [],
  market: [
    salarySignal("de-mid", "DE", "Berlin", "mid", "Kubernetes", 80000, 100000),
    salarySignal("de-senior", "DE", "Berlin", "senior", "Kubernetes", 100000, 120000),
    salarySignal("nl-mid", "NL", "Amsterdam", "mid", "Kubernetes", 70000, 90000),
    salarySignal("de-baseline", "DE", "Berlin", "mid", "Platform engineering baseline", 60000, 80000),
    salarySignal("de-cka", "DE", "Berlin", "mid", "CKA", 95000, 105000),
  ],
  mobilityProfiles: [],
};
const readiness = buildReadinessAssessment(input);

Deno.test("salary intelligence provides regional, progression, and premium views", () => {
  const salary = buildSimulation(input, {
    type: "skill",
    subject: "Kubernetes",
    destination: "DE",
    weeklyHours: 6,
  }, readiness).projection.salary;
  assert(salary.available, "salary projection should be available");
  assert(salary.regional_comparisons.length === 2, "two regions should be returned");
  assert(salary.career_progression.length === 2, "two experience levels should be returned");
  assert(salary.skill_premium.available, "a same-market baseline should produce a premium");
  assert(salary.skill_premium.amount === 30000, "premium should use scenario and baseline midpoints");
  assert(salary.certification_impact.available === false, "skill scenarios must not claim credential impact");
});

Deno.test("certification salary impact is directional and non-causal", () => {
  const impact = buildSimulation(input, {
    type: "certification",
    subject: "CKA",
    destination: "DE",
    weeklyHours: 6,
  }, readiness).projection.salary.certification_impact;
  assert(impact.available, "comparable evidence should produce directional impact");
  assert(impact.causal === false, "credential impact must not claim causation");
  assert(impact.sources.length > 1, "impact should preserve scenario and baseline sources");
});

Deno.test("hiring probability requires enough comparable terminal outcomes", () => {
  const jobs = Array.from({ length: 20 }, (_, index) => ({
    id: `job-${index}`,
    title: "Kubernetes engineer",
    description: "Build Kubernetes platforms.",
    application_status: index < 4 ? "offer" : "rejected",
  }));
  const calibrated = buildSimulation({ ...input, jobs }, {
    type: "skill",
    subject: "Kubernetes",
    weeklyHours: 6,
  }, readiness).projection.hiring_probability;
  assert(calibrated.available, "20 comparable terminal outcomes should activate the estimate");
  assert(calibrated.estimate_percent === 20, "estimate should use the observed offer rate");
  assert(calibrated.confidence_interval_95.low < 20, "interval should contain the estimate");
  assert(calibrated.confidence_interval_95.high > 20, "interval should contain the estimate");
  assert(calibrated.scenario_adjustment_available === false, "scenario must not receive an uncalibrated uplift");

  const insufficient = buildSimulation({ ...input, jobs: jobs.slice(0, 19) }, {
    type: "skill",
    subject: "Kubernetes",
    weeklyHours: 6,
  }, readiness).projection.hiring_probability;
  assert(insufficient.available === false, "19 outcomes must remain below the threshold");
  assert(insufficient.minimum_sample_size === 20, "the minimum sample should be explicit");
});
