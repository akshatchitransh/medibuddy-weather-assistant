import { Annotation } from "@langchain/langgraph";

/**
 * LangGraph Agent State Definition
 * Defines channels for conversational memory, extracted parameters,
 * weather data, SOP evaluation results, and grounding verification.
 */

export const AgentState = Annotation.Root({
  sessionId: Annotation({
    reducer: (prev, next) => next ?? prev ?? "default",
    default: () => "default",
  }),

  // Message history accumulator
  messages: Annotation({
    reducer: (prev, next) => (prev || []).concat(next || []),
    default: () => [],
  }),

  // Current turn user input
  userInput: Annotation({
    reducer: (prev, next) => next ?? prev ?? "",
    default: () => "",
  }),

  // Extracted intent and demographic entities
  intent: Annotation({
    reducer: (prev, next) => ({ ...(prev || {}), ...(next || {}) }),
    default: () => ({
      activity: null,
      target_group: "all",
      timeframe: "now",
    }),
  }),

  // Location resolution
  location: Annotation({
    reducer: (prev, next) => (next ? { ...(prev || {}), ...next } : prev),
    default: () => ({
      name: null,
      latitude: null,
      longitude: null,
      resolved: false,
      error: null,
    }),
  }),

  // Live weather payload from Open-Meteo
  weather: Annotation({
    reducer: (prev, next) => (next ? { ...(prev || {}), ...next } : prev),
    default: () => ({
      fetched: false,
      effectiveMetrics: null,
      currentMetrics: null,
      units: {},
      windowLabel: "Current",
      error: null,
    }),
  }),

  // SOP matching & conflict resolution results
  sopEvaluation: Annotation({
    reducer: (prev, next) => (next ? { ...(prev || {}), ...next } : prev),
    default: () => ({
      matched: false,
      primarySop: null,
      secondarySops: [],
      allMatches: [],
      conflictResolution: null,
    }),
  }),

  // Final response text
  response: Annotation({
    reducer: (prev, next) => next ?? prev ?? "",
    default: () => "",
  }),

  // SOP citations list
  citations: Annotation({
    reducer: (prev, next) => next ?? prev ?? [],
    default: () => [],
  }),

  // Execution status
  status: Annotation({
    reducer: (prev, next) => next ?? prev ?? "INIT",
    default: () => "INIT",
  }),

  // Grounding verification report
  verification: Annotation({
    reducer: (prev, next) => next ?? prev ?? null,
    default: () => null,
  }),
});
