type Row = Record<string, any>;

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function values(value: unknown): string[] {
  return Array.isArray(value) ? value.map(normalized).filter(Boolean) : [];
}

function tokens(value: unknown): Set<string> {
  return new Set(
    normalized(value).split(/[^a-z0-9+#.]+/).filter((token) => token.length > 2),
  );
}

function overlap(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((item) => rightSet.has(item)))];
}

function reference(type: string, id: unknown, label = ""): Row {
  return { type, id: String(id || ""), ...(label ? { label } : {}) };
}

export function buildMentorMatches(
  userId: string,
  profile: Row,
  twin: Row,
  mentors: Row[],
): Row[] {
  const aspirations = (Array.isArray(twin.aspirations) ? twin.aspirations : [])
    .map((item: Row) => normalized(item.aspiration));
  const gaps = (Array.isArray(twin.missing_competencies) ? twin.missing_competencies : [])
    .map((item: Row) => normalized(item.skill));
  const strengths = (Array.isArray(twin.technical_strengths) ? twin.technical_strengths : [])
    .map((item: Row) => normalized(item.skill));
  const goalTokens = tokens([profile.career_goal, ...aspirations].join(" "));
  const userCountry = normalized(profile.country);
  const experience = normalized(profile.experience_level);

  return mentors.filter((mentor) => mentor.user_id !== userId).map((mentor) => {
    const mentorSkills = values(mentor.skills);
    const mentorIndustries = values(mentor.industries);
    const mentorLocations = values(mentor.locations);
    const mentorLanguages = values(mentor.languages);
    const mentorExperience = values(mentor.experience_levels);
    const skillMatches = overlap(gaps, mentorSkills);
    const adjacentStrengths = overlap(strengths, mentorSkills);
    const industryMatches = mentorIndustries.filter((industry) =>
      [...goalTokens].some((token) => industry.includes(token) || token.includes(industry))
    );
    const locationMatches = userCountry
      ? mentorLocations.filter((location) => location.includes(userCountry) || userCountry.includes(location))
      : [];
    const experienceMatch = experience && mentorExperience.includes(experience);
    const verifiedBoost = mentor.verification_status === "verified" ? 10 : 0;
    const score = Math.min(
      100,
      15 +
      skillMatches.length * 15 +
      adjacentStrengths.length * 5 +
      industryMatches.length * 10 +
      locationMatches.length * 8 +
      (experienceMatch ? 7 : 0) +
      verifiedBoost,
    );
    return {
      user_id: userId,
      mentor_user_id: mentor.user_id,
      mentor_profile_id: mentor.id,
      score,
      dimensions: {
        goal_alignment: Math.min(100, industryMatches.length * 35 + skillMatches.length * 15),
        skill_alignment: Math.min(100, skillMatches.length * 30 + adjacentStrengths.length * 10),
        location_alignment: locationMatches.length ? 100 : 0,
        language_alignment: mentorLanguages.length ? 50 : 0,
        experience_alignment: experienceMatch ? 100 : 40,
        verification: mentor.verification_status === "verified" ? 100 : 40,
      },
      rationale: {
        skill_gaps_supported: skillMatches,
        adjacent_strengths: adjacentStrengths,
        industries_aligned: industryMatches,
        locations_aligned: locationMatches,
        mentor_languages: mentorLanguages,
        why: skillMatches.length
          ? `This mentor lists ${skillMatches.join(", ")} among the skills they can support.`
          : "The match is based on broader goal, industry, location, and experience alignment.",
        limitations: "This score uses self-declared mentor profile fields and the current Career Twin. It does not predict relationship quality or availability.",
      },
      evidence_refs: [
        reference("career_twin", twin.id, twin.trajectory),
        reference("mentor_profile", mentor.id, mentor.headline),
      ],
      status: "suggested",
    };
  }).sort((left, right) => right.score - left.score).slice(0, 12);
}
