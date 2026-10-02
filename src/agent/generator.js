import { invokeLLM, getActiveProviderName } from "./llm.js";

/**
 * Format a grounded, policy-traceable response when SOPs match.
 * Leverages Google Gemini (or configured LLM) to compose clear, warm,
 * conversational language while enforcing non-negotiable grounding constraints.
 * Otherwise uses structured authoritative template.
 */
export async function generateGroundedResponse({
  locationName,
  activity,
  timeframe,
  weatherData,
  sopEvaluation,
  userQuery = "",
  conversationHistory = [],
  sessionFacts = {},
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

  // Prepare recent conversational context for multi-turn continuity
  const recentTurns = (conversationHistory || [])
    .slice(-4)
    .map(m => `${m.role === "user" ? "User" : "MediBuddy"}: ${m.content.slice(0, 150)}`)
    .join("\n");

  const priorDecisionNote = sessionFacts?.lastSummary
    ? `Prior Session Decision: Last discussed ${sessionFacts.lastActivity || "activity"} in ${sessionFacts.lastLocation || "location"} under [${sessionFacts.lastSopId || ""}: ${sessionFacts.lastSummary}] (${sessionFacts.lastSeverity || ""}).`
    : "";

  // 1. Attempt LLM Generation
  try {
    const prompt = `
You are MediBuddy's Weather-Advisory Assistant (#wehealbycode).
Your job is to provide a clear, warm, conversational response that directly answers the user's question, while remaining strictly grounded in the official Standard Operating Procedure (SOP) and live weather data below.

USER QUESTION: "${userQuery || `Is it safe for ${activity || "outdoor activity"} in ${locationName}?`}"
${recentTurns ? `CONVERSATION HISTORY:\n${recentTurns}\n` : ""}
${priorDecisionNote ? `${priorDecisionNote}\n` : ""}

CONTEXT DATA:
- Location: ${locationName} (${windowLabel})
- Target Activity: ${activity || "outdoor activity"}
- Live Weather Metrics (Open-Meteo):
  * Temperature: ${temp}
  * Wind Speed: ${wind} (Gusts: ${metrics.wind_gusts_10m} km/h)
  * Precipitation: ${rain} (Probability: ${rainProb})
  * UV Index: ${uv}

MATCHED SOP:
- ID: ${primarySop.id}
- Title: ${primarySop.title}
- Severity: ${primarySop.severity}
- Category: ${primarySop.category.replace(/_/g, " ").toUpperCase()}
- Official Policy Guidance: ${primarySop.guidance}
- Required Safety Actions: ${JSON.stringify(primarySop.required_actions || [])}
${secondarySops && secondarySops.length > 0 ? `- Secondary Co-Advisories: ${JSON.stringify(secondarySops.map(s => `[${s.id}: ${s.title}] (${s.severity}): ${s.guidance}`))}` : ""}

GUIDELINES FOR YOUR RESPONSE:
1. Direct Conversational Opening: Speak directly to the user. Answer their specific question in the very first sentence. If this is a follow-up (e.g. asking about "this evening instead" after previously asking about earlier/tomorrow), naturally acknowledge the time shift or contrast with the earlier conditions without repeating yourself.
2. Forecast Transparency: Present the live forecast metrics in a clear, readable bulleted list.
   CRITICAL GROUNDING RULE: You must quote the EXACT numbers given above (${temp}, ${wind}, ${metrics.wind_gusts_10m} km/h gusts, ${rain}, ${rainProb}, UV ${uv}). Do NOT round or modify them.
3. Official Policy Guidance: Clearly state the official guidance and mandated actions faithfully from the SOP.
4. Policy Citation: Cite the binding policy name and ID clearly: [${primarySop.id}: ${primarySop.title}].
5. Tone: Helpful, empathetic, and professional.
6. Required Closing Line: End your response with this exact line:
*Advisory generated strictly per MediBuddy Standard Operating Procedures. Not model-invented advice.*
`;

    const { text: outputText, provider } = await invokeLLM(prompt);

    if (outputText && outputText.trim().length > 0) {
      // Validate that the output didn't hallucinate numbers
      const vCheck = verifyGrounding(outputText, metrics);
      if (vCheck.passed) {
        return {
          response: outputText.trim(),
          citations,
          metricsQuoted: {
            temperature_2m: metrics.temperature_2m,
            wind_speed_10m: metrics.wind_speed_10m,
            wind_gusts_10m: metrics.wind_gusts_10m,
            precipitation: metrics.precipitation,
            precipitation_probability: metrics.precipitation_probability,
            uv_index: metrics.uv_index,
          },
          provider,
        };
      } else {
        console.warn(`[Generator] LLM output flagged by verifyGrounding (${vCheck.enforcementNote}). Re-evaluating...`);
      }
    }
  } catch (llmErr) {
    console.warn(`[Generator] LLM generation error:`, llmErr.message);
  }

  // 2. Authoritative Fallback Template (Clean, Conversational, Beautifully Structured)
  const severityBadge = getSeverityBadge(primarySop.severity);
  const actName = activity || "outdoor activities";
  const isPositive = primarySop.severity === "FAVORABLE";

  let text = `Here is the current safety advisory for **${actName}** in **${locationName}** (${windowLabel}):\n\n`;

  if (isPositive) {
    text += `Good news! Weather conditions are currently safe and favorable for ${actName}.\n\n`;
  } else {
    text += `Please note: Weather conditions require caution or activity modification for ${actName}.\n\n`;
  }

  text += `**Live Weather Metrics (Open-Meteo):**\n`;
  text += `* **Temperature:** ${temp}\n`;
  text += `* **Wind Speed:** ${wind} (Gusts: ${metrics.wind_gusts_10m} ${units.wind_speed_10m || "km/h"})\n`;
  text += `* **Precipitation:** ${rain} (Probability: ${rainProb})\n`;
  text += `* **UV Index:** ${uv}\n\n`;

  text += `${severityBadge} **Policy Citation: [${primarySop.id}: ${primarySop.title}]**\n`;
  text += `*Category: ${primarySop.category.replace(/_/g, " ").toUpperCase()}*\n\n`;

  text += `**Official Safety Guidance:**\n${primarySop.guidance}\n\n`;

  if (Array.isArray(primarySop.required_actions) && primarySop.required_actions.length > 0) {
    text += `**Mandated Safety Actions:**\n`;
    for (const act of primarySop.required_actions) {
      text += `* ${act}\n`;
    }
    text += `\n`;
  }

  if (secondarySops && secondarySops.length > 0) {
    text += `**Additional Co-Advisories Triggered:**\n`;
    for (const sec of secondarySops) {
      text += `* **[${sec.id}: ${sec.title}]** (${sec.severity}): ${sec.guidance}\n`;
    }
    text += `\n`;
  }

  text += `*Advisory generated strictly per MediBuddy Standard Operating Procedures. Not model-invented advice.*`;

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
    },
    provider: "deterministic-policy-engine",
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
    response: `We currently do not have a verified Standard Operating Procedure (SOP) safety policy covering ${actLabel} under these specific conditions.${weatherNote}\n\nBecause MediBuddy does not permit the assistant to invent safety recommendations without a written operational policy, we cannot advise on this activity at this time. Please consult local municipal or sports authority advisories.\n\n*Advisory generated strictly per MediBuddy Standard Operating Procedures. Not model-invented advice.*`,
    citations: [],
  };
}

/**
 * Format honest error response when geocoding fails.
 */
export function generateLocationErrorResponse(locationName) {
  return {
    response: `Unable to retrieve a weather advisory because the location "${locationName || "specified"}" could not be resolved by our geocoding service. Please check the spelling or provide a recognized city name (for example, "in Bhopal" or "in Mumbai").`,
    citations: [],
  };
}

/**
 * Format honest error response when Open-Meteo forecast API is unreachable.
 */
export function generateWeatherApiErrorResponse(locationName, errorMsg) {
  return {
    response: `Unable to generate a safety advisory because live forecast data could not be retrieved from the Open-Meteo weather service at this time (${errorMsg || "network timeout"}). MediBuddy does not provide estimated or guessed forecasts when live data is unavailable. Please try again in a moment.`,
    citations: [],
  };
}

/**
 * Format clarification response when location is missing.
 */
export function generateClarificationResponse(activity) {
  const act = activity ? ` regarding ${activity}` : "";
  return {
    response: `Which city or location are you asking about${act}? Please mention your city (for example: "in Bhopal" or "in Mumbai") so I can evaluate live weather data against our safety policies.`,
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
