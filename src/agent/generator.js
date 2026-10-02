/**
 * Grounded Response Generator & Fact Verification Engine
 * Enforces strict SOP traceability, factual numerical grounding,
 * and deterministic verification against hallucinated metrics.
 */

/**
 * Format a grounded, policy-traceable response when SOPs match.
 */
export function generateGroundedResponse({
  locationName,
  activity,
  timeframe,
  weatherData,
  sopEvaluation,
}) {
  const { primarySop, secondarySops } = sopEvaluation;
  const metrics = weatherData.effectiveMetrics;
  const units = weatherData.units;
  const windowLabel = weatherData.windowLabel || "Current Conditions";

  const temp = `${metrics.temperature_2m}${units.temperature_2m || "°C"}`;
  const wind = `${metrics.wind_speed_10m} ${units.wind_speed_10m || "km/h"}`;
  const rain = `${metrics.precipitation} ${units.precipitation || "mm"}`;
  const rainProb = `${metrics.precipitation_probability}${units.precipitation_probability || "%"}`;
  const uv = `${metrics.uv_index}`;

  const citations = [primarySop.id, ...(secondarySops || []).map(s => s.id)];

  let text = `### Weather Advisory: ${locationName} (${windowLabel})\n\n`;

  // 1. Live Weather Data Grounding Block (strictly from Open-Meteo)
  text += `**Live Weather Metrics (Open-Meteo):**\n`;
  text += `- **Temperature:** ${temp}\n`;
  text += `- **Wind Speed:** ${wind} (Gusts: ${metrics.wind_gusts_10m} ${units.wind_speed_10m || "km/h"})\n`;
  text += `- **Precipitation:** ${rain} (Probability: ${rainProb})\n`;
  text += `- **UV Index:** ${uv}\n\n`;

  // 2. Binding Policy Citation & Severity Badge
  const severityBadge = getSeverityBadge(primarySop.severity);
  text += `#### ${severityBadge} **Policy Citation: [${primarySop.id}: ${primarySop.title}]**\n`;
  text += `*Category: ${primarySop.category.replace(/_/g, " ").toUpperCase()}*\n\n`;

  // 3. Guidance grounded directly from SOP policy text
  text += `**Official Safety Guidance:**\n`;
  text += `${primarySop.guidance}\n\n`;

  // 4. Actionable Steps directly from SOP policy
  if (Array.isArray(primarySop.required_actions) && primarySop.required_actions.length > 0) {
    text += `**Mandated Safety Actions:**\n`;
    for (const act of primarySop.required_actions) {
      text += `- ${act}\n`;
    }
    text += `\n`;
  }

  // 5. Co-Advisories (When multiple SOPs matched)
  if (secondarySops && secondarySops.length > 0) {
    text += `---\n`;
    text += `**Additional Weather Co-Advisories Triggered:**\n`;
    for (const sec of secondarySops) {
      text += `- **[${sec.id}: ${sec.title}]** (${sec.severity}): ${sec.guidance}\n`;
    }
    text += `\n`;
  }

  text += `> *Advisory generated strictly per MediBuddy Standard Operating Procedures. Not model-invented advice.*`;

  return {
    response: text,
    citations,
    metricsQuoted: {
      temperature_2m: metrics.temperature_2m,
      wind_speed_10m: metrics.wind_speed_10m,
      wind_gusts_10m: metrics.wind_gusts_10m,
      precipitation: metrics.precipitation,
      precipitation_probability: metrics.precipitation_probability,
      uv_index: metrics.uv_index,
    }
  };
}

/**
 * Format honest fallback when no SOP policy covers the question.
 */
export function generateNoSopMatchResponse({ locationName, activity, weatherData }) {
  const metrics = weatherData?.effectiveMetrics;
  let weatherNote = "";
  if (metrics) {
    weatherNote = ` Current recorded weather for ${locationName}: Temperature ${metrics.temperature_2m}°C, Wind ${metrics.wind_speed_10m} km/h, Precipitation ${metrics.precipitation} mm, UV Index ${metrics.uv_index}.`;
  }

  const actLabel = activity ? `for "${activity}"` : "for this scenario";

  return {
    response: `We currently do not have a verified Standard Operating Procedure (SOP) safety policy covering ${actLabel} under these specific conditions.${weatherNote}\n\nBecause MediBuddy does not permit the assistant to invent safety recommendations without a written operational policy, we cannot advise on this activity at this time. Please consult local municipal or sports authority advisories.`,
    citations: [],
  };
}

/**
 * Format honest error response when geocoding fails.
 */
export function generateLocationErrorResponse(locationName) {
  return {
    response: `Unable to retrieve weather advisory because the location "${locationName || "specified"}" could not be resolved by the geocoding service. Please verify the city name or provide a recognized municipal city.`,
    citations: [],
  };
}

/**
 * Format honest error response when Open-Meteo forecast API is unreachable.
 */
export function generateWeatherApiErrorResponse(locationName, errorMsg) {
  return {
    response: `Unable to generate a safety advisory because live forecast data could not be retrieved from the Open-Meteo weather service at this time (${errorMsg || "network timeout"}). MediBuddy does not provide estimated or guessed forecasts when live data is unavailable. Please try again shortly.`,
    citations: [],
  };
}

/**
 * Format clarification response when location is missing.
 */
export function generateClarificationResponse(activity) {
  const act = activity ? ` regarding ${activity}` : "";
  return {
    response: `Which city or location are you asking about${act}? Please mention your city (for example: "in Bhopal" or "in Mumbai") so I can evaluate the live weather data against our safety policies.`,
    citations: [],
  };
}

/**
 * ==============================================================================
 * FACT & NUMBER GROUNDING VERIFICATION (Enforced in Code)
 * ==============================================================================
 * Scans generated text for numeric metrics and validates them against the actual
 * Open-Meteo payload to mathematically prevent hallucinated numbers.
 */
export function verifyGrounding(responseText, effectiveMetrics) {
  if (!effectiveMetrics) {
    return { passed: true, reason: "No metrics to verify against (fallback path)." };
  }

  // Regex to extract numbers followed by common units
  const metricRegex = /(-?\d+(?:\.\d+)?)\s*(?:°C|km\/h|mm|%)/g;
  const numbersQuoted = [];
  let match;

  while ((match = metricRegex.exec(responseText)) !== null) {
    numbersQuoted.push(parseFloat(match[1]));
  }

  const validMetricValues = [
    effectiveMetrics.temperature_2m,
    effectiveMetrics.wind_speed_10m,
    effectiveMetrics.wind_gusts_10m,
    effectiveMetrics.precipitation,
    effectiveMetrics.precipitation_probability,
    effectiveMetrics.relative_humidity_2m,
    effectiveMetrics.uv_index,
  ].filter(v => typeof v === "number" && !isNaN(v));

  const ungroundedNumbers = [];

  for (const num of numbersQuoted) {
    // Check if within 0.5 margin of any actual metric value
    const matchesAny = validMetricValues.some(val => Math.abs(val - num) <= 0.5);
    if (!matchesAny) {
      ungroundedNumbers.push(num);
    }
  }

  const passed = ungroundedNumbers.length === 0;

  return {
    passed,
    numbersQuoted,
    validMetricValues,
    ungroundedNumbers,
    enforcementNote: passed
      ? "All quoted numbers match live Open-Meteo API payload."
      : `Flagged ${ungroundedNumbers.length} ungrounded number(s): ${ungroundedNumbers.join(", ")}`
  };
}

function getSeverityBadge(severity) {
  switch ((severity || "").toUpperCase()) {
    case "CRITICAL":
      return "🚨 **[CRITICAL SEVERITY]**";
    case "DANGER":
      return "⚠️ **[DANGER SEVERITY]**";
    case "CAUTION":
      return "⚡ **[CAUTION SEVERITY]**";
    case "ADVISORY":
      return "ℹ️ **[ADVISORY]**";
    case "FAVORABLE":
      return "✅ **[FAVORABLE CONDITIONS]**";
    default:
      return "📋 **[POLICY ADVISORY]**";
  }
}
