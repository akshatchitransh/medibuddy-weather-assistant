import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import { weatherAdvisoryGraph } from "./agent/graph.js";
import { getActiveSOPs, appendSOP } from "./sopEngine/sopLoader.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// In-memory session tracking for active conversation threads
const activeSessions = new Map();

/**
 * Health check endpoint
 */
app.get("/api/health", (req, res) => {
  const sops = getActiveSOPs();
  res.json({
    status: "healthy",
    engine: "LangGraph JS",
    activeSopCount: sops.length,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get all active SOPs (Dynamic reflection)
 */
app.get("/api/sops", (req, res) => {
  try {
    const sops = getActiveSOPs();
    res.json({
      total: sops.length,
      sops,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Live SOP Injection Endpoint
 * Allows reviewers or admins to add an 11th SOP on the spot without restarting the server!
 */
app.post("/api/sops", (req, res) => {
  try {
    const newSop = req.body;
    if (!newSop || !newSop.id || !newSop.title) {
      return res.status(400).json({ error: "SOP 'id' and 'title' are required." });
    }

    const updatedList = appendSOP(newSop);
    res.json({
      success: true,
      message: `Successfully registered SOP [${newSop.id}: ${newSop.title}]`,
      totalSops: updatedList.length,
      sops: updatedList,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Main Chat Endpoint
 * Invokes the LangGraph StateGraph with session-based memory checkpointer.
 */
app.post("/api/chat", async (req, res) => {
  const { sessionId = "default-session", message } = req.body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "Valid 'message' string is required." });
  }

  try {
    const threadConfig = {
      configurable: {
        thread_id: sessionId,
      }
    };

    // Invoke LangGraph state graph with turn messages
    const result = await weatherAdvisoryGraph.invoke({
      sessionId,
      userInput: message.trim(),
      messages: [{ role: "user", content: message.trim() }],
    }, threadConfig);

    // Save message turn in session log
    const sessionHistory = activeSessions.get(sessionId) || [];
    sessionHistory.push({
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    });
    sessionHistory.push({
      role: "assistant",
      content: result.response,
      citations: result.citations,
      status: result.status,
      timestamp: new Date().toISOString(),
    });
    activeSessions.set(sessionId, sessionHistory);

    res.json({
      sessionId,
      status: result.status,
      response: result.response,
      citations: result.citations || [],
      location: result.location,
      intent: result.intent,
      weather: result.weather?.fetched ? {
        effectiveMetrics: result.weather.effectiveMetrics,
        currentMetrics: result.weather.currentMetrics,
        units: result.weather.units,
        windowLabel: result.weather.windowLabel,
      } : null,
      sopEvaluation: result.sopEvaluation ? {
        matched: result.sopEvaluation.matched,
        primarySop: result.sopEvaluation.primarySop ? {
          id: result.sopEvaluation.primarySop.id,
          title: result.sopEvaluation.primarySop.title,
          severity: result.sopEvaluation.primarySop.severity,
          category: result.sopEvaluation.primarySop.category,
        } : null,
        secondaryCount: result.sopEvaluation.secondarySops?.length || 0,
        conflictResolution: result.sopEvaluation.conflictResolution,
      } : null,
      verification: result.verification,
    });
  } catch (err) {
    console.error(`[API /chat Error]:`, err);
    res.status(500).json({
      error: "Internal Graph Execution Error",
      details: err.message,
    });
  }
});

/**
 * Reset Session Memory
 */
app.post("/api/reset-session", (req, res) => {
  const { sessionId = "default-session" } = req.body;
  activeSessions.delete(sessionId);
  res.json({
    success: true,
    message: `Session ${sessionId} memory reset.`,
  });
});

// Serve frontend static assets if built
const frontendDist = path.resolve(process.cwd(), "frontend", "dist");
app.use(express.static(frontendDist));

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(frontendDist, "index.html"), (err) => {
    if (err) {
      res.send(`<h2>MediBuddy Weather Advisory API is running on port ${PORT}.</h2><p>Frontend is available at http://localhost:${PORT}</p>`);
    }
  });
});

if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`=======================================================`);
    console.log(` MediBuddy Weather-Advisory Assistant (LangGraph Engine)`);
    console.log(` Express API Server listening locally on: http://localhost:${PORT}`);
    console.log(` On Your Network (Mobile testing):      http://10.254.122.85:${PORT}`);
    console.log(` Dynamic SOPs loaded: ${getActiveSOPs().length}`);
    console.log(`=======================================================`);
  });
}

export default app;
