import dotenv from "dotenv";

dotenv.config();

let cachedModel = null;
let providerName = "deterministic-fallback";

/**
 * Initialize and get the configured LLM instance.
 * Supports Google Gemini, OpenAI, or falls back to deterministic generator if no API key is provided.
 */
export async function getLLM() {
  if (cachedModel !== null) {
    return { model: cachedModel, provider: providerName };
  }

  // 1. Google Gemini Provider
  if (process.env.GEMINI_API_KEY) {
    try {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      cachedModel = new ChatGoogleGenerativeAI({
        model: "gemini-1.5-flash",
        apiKey: process.env.GEMINI_API_KEY,
        temperature: 0.2, // Low temperature for high adherence
        maxOutputTokens: 1024,
      });
      providerName = "Google Gemini (gemini-1.5-flash)";
      console.log(`[LLM Layer] Active provider: ${providerName}`);
      return { model: cachedModel, provider: providerName };
    } catch (err) {
      console.warn(`[LLM Layer] Failed to initialize Gemini:`, err.message);
    }
  }

  // 2. OpenAI Provider
  if (process.env.OPENAI_API_KEY) {
    try {
      const { ChatOpenAI } = await import("@langchain/openai");
      cachedModel = new ChatOpenAI({
        model: "gpt-4o-mini",
        apiKey: process.env.OPENAI_API_KEY,
        temperature: 0.2,
      });
      providerName = "OpenAI (gpt-4o-mini)";
      console.log(`[LLM Layer] Active provider: ${providerName}`);
      return { model: cachedModel, provider: providerName };
    } catch (err) {
      console.warn(`[LLM Layer] Failed to initialize OpenAI:`, err.message);
    }
  }

  // 3. Deterministic Policy Fallback (When no paid API key is present)
  providerName = "deterministic-policy-engine";
  return { model: null, provider: providerName };
}

/**
 * Get current active LLM provider name
 */
export function getActiveProviderName() {
  return providerName;
}
