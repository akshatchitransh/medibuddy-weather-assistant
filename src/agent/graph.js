import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AgentState } from "./state.js";
import { extractIntentAndEntities } from "./extractor.js";
import { geocodeCity, fetchWeatherData } from "../weather/openMeteo.js";
import { evaluateSOPs } from "../sopEngine/sopEvaluator.js";
import {
  generateGroundedResponse,
  generateNoSopMatchResponse,
  generateLocationErrorResponse,
  generateWeatherApiErrorResponse,
  generateClarificationResponse,
  verifyGrounding,
} from "./generator.js";

/**
 * ==============================================================================
 * LANGGRAPH AGENT GRAPH IMPLEMENTATION
 * Features authentic conditional branching across extraction, geocoding,
 * weather API health, SOP policy matching, and factual verification.
 * ==============================================================================
 */

// 1. Node: Extract Intent & Entities (with multi-turn context carrying)
async function extractIntentNode(state) {
  const latestMessage = state.userInput || (state.messages?.[state.messages.length - 1]?.content) || "";
  const extracted = await extractIntentAndEntities(latestMessage, state);

  return {
    userInput: latestMessage,
    intent: {
      activity: extracted.activity,
      target_group: extracted.target_group,
      timeframe: extracted.timeframe,
    },
    location: {
      name: extracted.location_name,
      resolved: false,
      error: null,
    },
    status: "INTENT_EXTRACTED",
  };
}

// 2. Node: Geocode Location and Fetch Open-Meteo Weather Data
async function weatherNode(state) {
  const cityName = state.location?.name;

  // Step A: Geocode
  const geoResult = await geocodeCity(cityName);
  if (!geoResult.success) {
    return {
      location: {
        name: cityName,
        resolved: false,
        error: geoResult.error,
      },
      status: "LOCATION_NOT_FOUND",
    };
  }

  const loc = geoResult.location;

  // Step B: Fetch Weather from Open-Meteo
  const weatherResult = await fetchWeatherData(
    loc.latitude,
    loc.longitude,
    state.intent?.timeframe || "now"
  );

  if (!weatherResult.success) {
    return {
      location: {
        name: loc.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        country: loc.country,
        resolved: true,
        error: null,
      },
      weather: {
        fetched: false,
        error: weatherResult.error || "WEATHER_API_UNREACHABLE",
      },
      status: "WEATHER_ERROR",
    };
  }

  return {
    location: {
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      country: loc.country,
      admin1: loc.admin1,
      resolved: true,
      error: null,
    },
    weather: {
      fetched: true,
      effectiveMetrics: weatherResult.data.effectiveMetrics,
      currentMetrics: weatherResult.data.currentMetrics,
      units: weatherResult.data.units,
      windowLabel: weatherResult.data.windowLabel,
      error: null,
    },
    status: "WEATHER_FETCHED",
  };
}

// 3. Node: Evaluate SOP Policies (Dynamic external rules & conflict resolution)
async function evaluateSopsNode(state) {
  const evaluation = evaluateSOPs({
    activity: state.intent?.activity,
    target_group: state.intent?.target_group,
    weatherMetrics: state.weather?.effectiveMetrics || {},
  });

  return {
    sopEvaluation: evaluation,
    status: evaluation.matched ? "SOP_MATCHED" : "NO_SOP_MATCH",
  };
}

// 4. Node: Grounded Response Generation (Strictly cites SOP policies and weather)
async function groundedResponseNode(state) {
  const genResult = await generateGroundedResponse({
    locationName: state.location?.name,
    activity: state.intent?.activity,
    timeframe: state.intent?.timeframe,
    weatherData: state.weather,
    sopEvaluation: state.sopEvaluation,
  });

  return {
    response: genResult.response,
    citations: genResult.citations,
    status: "RESPONSE_GENERATED",
  };
}

// 5. Node: Numerical Fact & SOP Grounding Verification (Enforced in Code)
async function verifyGroundingNode(state) {
  const verification = verifyGrounding(state.response, state.weather?.effectiveMetrics);

  return {
    verification,
    status: verification.passed ? "SUCCESS" : "VERIFICATION_FLAGGED",
  };
}

// --- Terminal / Honest Fallback Nodes ---

async function clarificationNode(state) {
  const res = generateClarificationResponse(state.intent?.activity);
  return {
    response: res.response,
    citations: res.citations,
    status: "CLARIFICATION_NEEDED",
  };
}

async function locationErrorNode(state) {
  const res = generateLocationErrorResponse(state.location?.name);
  return {
    response: res.response,
    citations: res.citations,
    status: "LOCATION_NOT_FOUND",
  };
}

async function weatherErrorNode(state) {
  const res = generateWeatherApiErrorResponse(state.location?.name, state.weather?.error);
  return {
    response: res.response,
    citations: res.citations,
    status: "WEATHER_ERROR",
  };
}

async function noSopMatchNode(state) {
  const res = generateNoSopMatchResponse({
    locationName: state.location?.name,
    activity: state.intent?.activity,
    weatherData: state.weather,
  });
  return {
    response: res.response,
    citations: res.citations,
    status: "NO_SOP_MATCH",
  };
}

// ==============================================================================
// CONDITIONAL ROUTING FUNCTIONS (BRANCHING)
// ==============================================================================

function routeAfterExtraction(state) {
  // If location is completely missing and wasn't in previous turns, route to clarification
  if (!state.location?.name) {
    return "clarificationNode";
  }
  return "weatherNode";
}

function routeAfterWeather(state) {
  if (state.status === "LOCATION_NOT_FOUND") {
    return "locationErrorNode";
  }
  if (state.status === "WEATHER_ERROR" || !state.weather?.fetched) {
    return "weatherErrorNode";
  }
  return "evaluateSopsNode";
}

function routeAfterSopEval(state) {
  if (!state.sopEvaluation?.matched) {
    return "noSopMatchNode";
  }
  return "groundedResponseNode";
}

// ==============================================================================
// ASSEMBLE STATE GRAPH
// ==============================================================================

const workflow = new StateGraph(AgentState)
  // Register Nodes
  .addNode("extractIntentNode", extractIntentNode)
  .addNode("clarificationNode", clarificationNode)
  .addNode("weatherNode", weatherNode)
  .addNode("locationErrorNode", locationErrorNode)
  .addNode("weatherErrorNode", weatherErrorNode)
  .addNode("evaluateSopsNode", evaluateSopsNode)
  .addNode("noSopMatchNode", noSopMatchNode)
  .addNode("groundedResponseNode", groundedResponseNode)
  .addNode("verifyGroundingNode", verifyGroundingNode)

  // Starting edge
  .addEdge(START, "extractIntentNode")

  // Conditional Branch 1: Intent -> Clarification or Weather Fetch
  .addConditionalEdges("extractIntentNode", routeAfterExtraction, [
    "clarificationNode",
    "weatherNode",
  ])

  // Conditional Branch 2: Weather -> Location Error, Weather Error, or Evaluate SOPs
  .addConditionalEdges("weatherNode", routeAfterWeather, [
    "locationErrorNode",
    "weatherErrorNode",
    "evaluateSopsNode",
  ])

  // Conditional Branch 3: SOP Match -> Fallback or Grounded Response
  .addConditionalEdges("evaluateSopsNode", routeAfterSopEval, [
    "noSopMatchNode",
    "groundedResponseNode",
  ])

  // Verification & Endings
  .addEdge("groundedResponseNode", "verifyGroundingNode")
  .addEdge("verifyGroundingNode", END)
  .addEdge("clarificationNode", END)
  .addEdge("locationErrorNode", END)
  .addEdge("weatherErrorNode", END)
  .addEdge("noSopMatchNode", END);

// Checkpointer for conversational session state persistence
export const checkpointer = new MemorySaver();

// Compile the runnable graph
export const weatherAdvisoryGraph = workflow.compile({
  checkpointer,
});
