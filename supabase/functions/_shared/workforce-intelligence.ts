type Row = Record<string, any>;

function text(value: unknown): string {
  return String(value || "").trim();
}

function source(signal: Row): Row {
  return {
    id: signal.id,
    source_name: signal.source_name,
    source_url: signal.source_url,
    observed_from: signal.observed_from,
    observed_to: signal.observed_to,
    methodology: signal.methodology,
    confidence: signal.confidence,
  };
}

export function buildGovernmentWorkforceDashboard(
  organization: Row,
  observations: Row[],
  programmes: Row[],
  cohortDashboard: Row,
): Row {
  if (organization.organization_type !== "government") return { available: false };
  const relevant = observations.filter((signal) =>
    !organization.country_code || signal.country_code === organization.country_code
  );
  const latestShortages = [...relevant
    .filter((signal) => signal.signal_type === "skill_demand")
    .sort((left, right) => String(right.observed_to).localeCompare(String(left.observed_to)))
    .reduce((signals, signal) => {
      const key = [
        signal.country_code,
        signal.city,
        signal.industry,
        signal.job_family,
        signal.experience_level,
        signal.subject,
      ].map(text).join("|").toLowerCase();
      if (!signals.has(key)) signals.set(key, signal);
      return signals;
    }, new Map<string, Row>()).values()];
  const shortages = latestShortages
    .sort((left, right) =>
      Number(right.value_numeric || 0) - Number(left.value_numeric || 0) ||
      Number(right.confidence || 0) - Number(left.confidence || 0)
    )
    .slice(0, 15)
    .map((signal) => ({
      skill: signal.subject,
      country_code: signal.country_code,
      city: signal.city,
      industry: signal.industry,
      job_family: signal.job_family,
      demand_value: signal.value_numeric,
      demand_unit: signal.value_unit,
      source: source(signal),
    }));
  const trends = relevant
    .filter((signal) =>
      ["hiring_trend", "industry_growth", "technology_adoption"].includes(signal.signal_type)
    )
    .sort((left, right) => String(right.observed_to).localeCompare(String(left.observed_to)))
    .slice(0, 20)
    .map((signal) => ({
      subject: signal.subject,
      signal_type: signal.signal_type,
      country_code: signal.country_code,
      city: signal.city,
      industry: signal.industry,
      job_family: signal.job_family,
      value_numeric: signal.value_numeric,
      value_unit: signal.value_unit,
      source: source(signal),
    }));
  const grouped = new Map<string, Row[]>();
  for (const signal of relevant) {
    if (!["skill_demand", "hiring_trend", "industry_growth"].includes(signal.signal_type)) continue;
    const key = [signal.country_code, signal.city, signal.industry, signal.job_family, signal.signal_type, signal.subject]
      .map(text).join("|").toLowerCase();
    const values = grouped.get(key) || [];
    values.push(signal);
    grouped.set(key, values);
  }
  const forecasts = [...grouped.values()].flatMap((values) => {
    const ordered = values
      .filter((item) => Number.isFinite(Number(item.value_numeric)))
      .sort((left, right) => String(right.observed_to).localeCompare(String(left.observed_to)));
    if (ordered.length < 2) return [];
    const latest = ordered[0];
    const previous = ordered[1];
    const delta = Number(latest.value_numeric) - Number(previous.value_numeric);
    return [{
      subject: latest.subject,
      signal_type: latest.signal_type,
      country_code: latest.country_code,
      city: latest.city,
      industry: latest.industry,
      job_family: latest.job_family,
      latest_value: latest.value_numeric,
      previous_value: previous.value_numeric,
      value_unit: latest.value_unit,
      direction: delta > 0 ? "rising" : delta < 0 ? "falling" : "stable",
      delta,
      basis: "Change between the two latest comparable sourced observations; this is not a predictive forecast.",
      sources: [source(latest), source(previous)],
    }];
  }).sort((left, right) => Math.abs(Number(right.delta)) - Math.abs(Number(left.delta))).slice(0, 15);
  const sourceCoverage = [...new Map(relevant.map((signal) => [
    `${signal.source_name}:${signal.source_url}`,
    {
      source_name: signal.source_name,
      source_url: signal.source_url,
      latest_observation: signal.observed_to,
    },
  ])).values()].sort((left, right) =>
    String(right.latest_observation).localeCompare(String(left.latest_observation))
  );
  return {
    available: true,
    country_code: organization.country_code,
    region: organization.region,
    workforce_trends: trends,
    regional_skill_shortages: shortages,
    skills_forecasting: forecasts,
    programmes: programmes.map((programme) => ({
      id: programme.id,
      name: programme.name,
      programme_type: programme.programme_type,
      status: programme.status,
      starts_on: programme.starts_on,
      ends_on: programme.ends_on,
    })),
    programme_completion: cohortDashboard?.privacy?.suppressed
      ? {
          available: false,
          reason: cohortDashboard.privacy.reason,
          minimum_group_size: cohortDashboard.privacy.minimum_group_size,
        }
      : {
          available: true,
          completion_rate: cohortDashboard?.engagement?.completion_rate ?? null,
          completed_actions: cohortDashboard?.engagement?.completed_actions ?? 0,
          placement_rate: cohortDashboard?.programme_effectiveness?.placement_rate ?? null,
        },
    source_coverage: sourceCoverage,
    limitations: [
      "Labour-market outputs include only published observations with explicit sources and coverage windows.",
      "Signal trajectories compare historical observations; they are not population forecasts or causal estimates.",
      "Participant outcomes remain consent-aware and suppressed below the configured minimum group size.",
    ],
    generated_at: new Date().toISOString(),
  };
}
