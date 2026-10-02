import dotenv from "dotenv";

dotenv.config();

const GEMINI_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash",
].filter(Boolean);

let activeWorkingModelName = null;
let providerName = "deterministic-fallback";

/**
 * Invoke LLM with automatic multi-model failover.
 * If one model encounters a 429 quota exhaustion or transient error,
 * the invoker immediately tries the next candidate in the pool.
 * @param {string} prompt
 * @returns {Promise<{text: string|null, provider: string}>}
 */
export async function invokeLLM(prompt) {
  // 1. Google Gemini Provider
  if (process.env.GEMINI_API_KEY) {
    try {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");

      // Prioritize previously working model, then fallback candidates
      const orderedCandidates = activeWorkingModelName
        ? [activeWorkingModelName, ...GEMINI_CANDIDATES.filter(m => m !== activeWorkingModelName)]
        : GEMINI_CANDIDATES;

      for (const modelName of orderedCandidates) {
        try {
          const modelInstance = new ChatGoogleGenerativeAI({
            model: modelName,
            apiKey: process.env.GEMINI_API_KEY,
            temperature: 0.2,
            maxOutputTokens: 1024,
          });

          const response = await modelInstance.invoke(prompt);
          const text = typeof response === "string" ? response : (response.content || String(response));

          activeWorkingModelName = modelName;
          providerName = `Google Gemini (${modelName})`;
          return { text, provider: providerName };
        } catch (candidateErr) {
          console.warn(`[LLM Layer] Candidate '${modelName}' failed (${candidateErr.message?.slice(0, 100)}). Trying next candidate...`);
        }
      }
    } catch (err) {
      console.warn(`[LLM Layer] Google GenAI module import error:`, err.message);
    }
  }

  // 2. OpenAI Provider
  if (process.env.OPENAI_API_KEY) {
    try {
      const { ChatOpenAI } = await import("@langchain/openai");
      const modelInstance = new ChatOpenAI({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        apiKey: process.env.OPENAI_API_KEY,
        temperature: 0.2,
      });

      const response = await modelInstance.invoke(prompt);
      const text = typeof response === "string" ? response : (response.content || String(response));
      providerName = "OpenAI (gpt-4o-mini)";
      return { text, provider: providerName };
    } catch (err) {
      console.warn(`[LLM Layer] OpenAI invocation failed:`, err.message);
    }
  }

  // 3. Fallback
  return { text: null, provider: "deterministic-policy-engine" };
}

/**
 * Backwards compatibility helper for getLLM()
 */
export async function getLLM() {
  if (process.env.GEMINI_API_KEY) {
    const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
    const model = new ChatGoogleGenerativeAI({
      model: activeWorkingModelName || GEMINI_CANDIDATES[0] || "gemini-3.1-flash-lite",
      apiKey: process.env.GEMINI_API_KEY,
      temperature: 0.2,
      maxOutputTokens: 1024,
    });
    return { model, provider: `Google Gemini (${activeWorkingModelName || GEMINI_CANDIDATES[0]})` };
  }
  return { model: null, provider: "deterministic-policy-engine" };
}

export function getActiveProviderName() {
  return providerName;
}
