import { getActiveSOPs } from "./sopLoader.js";

/**
 * SOP Evaluator & Conflict Resolution Engine
 * Evaluates external rules against extracted user intent and live weather metrics.
 */

const SEVERITY_WEIGHTS = {
  CRITICAL: 5,
  DANGER: 4,
  CAUTION: 3,
  ADVISORY: 2,
  FAVORABLE: 1,
};

/**
 * Evaluate weather conditions against a single condition clause.
 */
function evaluateClause(metricValue, clause) {
  if (clause === undefined || clause === null) return true;
  if (typeof metricValue !== "number" || isNaN(metricValue)) return false;

  if (clause.gte !== undefined && metricValue < clause.gte) return false;
  if (clause.gt !== undefined && metricValue <= clause.gt) return false;
  if (clause.lte !== undefined && metricValue > clause.lte) return false;
  if (clause.lt !== undefined && metricValue >= clause.lt) return false;
  if (clause.eq !== undefined && metricValue !== clause.eq) return false;

  if (Array.isArray(clause.between)) {
    const [min, max] = clause.between;
    if (metricValue < min || metricValue > max) return false;
  }

  if (Array.isArray(clause.in)) {
    if (!clause.in.includes(metricValue)) return false;
  }

  return true;
}

/**
 * Check if the entire conditions block is satisfied by weather metrics.
 */
function checkConditions(conditions, metrics) {
  if (!conditions) return true;

  // Handle any_of list
  if (Array.isArray(conditions.any_of)) {
    return conditions.any_of.some(subCondition => checkConditions(subCondition, metrics));
  }

  // Handle composite block
  if (conditions.composite) {
    return checkConditions(conditions.composite, metrics);
  }

  // Handle direct field checks
  for (const [field, clause] of Object.entries(conditions)) {
    if (field === "type" || field === "any_of" || field === "composite") continue;

    const metricVal = metrics[field];
    if (!evaluateClause(metricVal, clause)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if an activity matches the SOP target_activities.
 */
function matchActivity(sopActivities, userActivity) {
  if (!sopActivities || sopActivities.includes("all")) return true;
  if (!userActivity) return false;

  const ua = userActivity.toLowerCase().trim();
  return sopActivities.some(target => {
    const t = target.toLowerCase().trim();
    return ua.includes(t) || t.includes(ua);
  });
}

/**
 * Check if target group matches.
 */
function matchTargetGroup(sopGroups, userGroup) {
  if (!sopGroups || sopGroups.includes("all")) return true;
  if (!userGroup) return true; // If user didn't specify, default policies apply

  const ug = userGroup.toLowerCase().trim();
  return sopGroups.some(target => {
    const t = target.toLowerCase().trim();
    return ug.includes(t) || t.includes(ug);
  });
}

/**
 * Main SOP Matching Engine
 * @param {object} params
 * @param {string} params.activity - e.g. "cycling", "picnic", "jogging"
 * @param {string} [params.target_group="all"] - e.g. "elderly", "children", "pets"
 * @param {object} params.weatherMetrics - Live Open-Meteo current or hourly metrics
 * @param {string} [params.sopFilePath] - Optional custom path for test fixtures
 * @returns {{matched: boolean, primarySop: object|null, secondarySops: Array<object>, allMatches: Array<object>, conflictResolution: object|null}}
 */
export function evaluateSOPs({ activity, target_group = "all", weatherMetrics, sopFilePath }) {
  const allSops = getActiveSOPs(sopFilePath);
  const matchedSops = [];

  for (const sop of allSops) {
    // 1. Scope and Activity filter
    const isGlobalScope = sop.scope === "global" || sop.target_activities?.includes("all");
    const activityMatches = isGlobalScope || matchActivity(sop.target_activities, activity);

    if (!activityMatches) continue;

    // 2. Target Group filter
    const groupMatches = matchTargetGroup(sop.target_groups, target_group);
    if (!groupMatches) continue;

    // 3. Meteorological condition validation
    const weatherMatches = checkConditions(sop.conditions, weatherMetrics);
    if (weatherMatches) {
      matchedSops.push(sop);
    }
  }

  if (matchedSops.length === 0) {
    return {
      matched: false,
      primarySop: null,
      secondarySops: [],
      allMatches: [],
      conflictResolution: null,
    };
  }

  // Conflict Resolution Strategy:
  // Rank by Severity (CRITICAL > DANGER > CAUTION > ADVISORY > FAVORABLE), then by explicit priority
  matchedSops.sort((a, b) => {
    const weightA = SEVERITY_WEIGHTS[a.severity] || 0;
    const weightB = SEVERITY_WEIGHTS[b.severity] || 0;
    if (weightB !== weightA) {
      return weightB - weightA; // Higher severity first
    }
    return (b.priority || 0) - (a.priority || 0); // Higher priority first
  });

  const primarySop = matchedSops[0];
  const secondarySops = matchedSops.slice(1);

  return {
    matched: true,
    primarySop,
    secondarySops,
    allMatches: matchedSops,
    conflictResolution: {
      strategy: "Rank by Life-Safety Severity (CRITICAL > DANGER > CAUTION > ADVISORY > FAVORABLE) followed by SOP priority score.",
      primaryReason: `Selected ${primarySop.id} (${primarySop.severity}) as primary binding safety policy over ${secondarySops.length} secondary match(es).`,
      coWarningsCount: secondarySops.length,
    }
  };
}
