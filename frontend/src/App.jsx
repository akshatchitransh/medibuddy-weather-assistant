import React, { useState, useEffect, useRef } from "react";
import "./App.css";

function renderInlineFormatting(text) {
  if (!text) return "";
  const parts = [];
  // Tokenize **bold**, [SOP-...], and *italic*
  const regex = /(\*\*[^*]+\*\*|\[SOP-[^\]]+\]|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[SOP-") && token.endsWith("]")) {
      parts.push(<span key={match.index} className="sop-inline-ref">{token}</span>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

function FormattedMessage({ content }) {
  if (!content) return null;

  // Split into block paragraphs
  const rawBlocks = content.split(/\n\s*\n/);

  return (
    <div className="formatted-message-body">
      {rawBlocks.map((block, bIdx) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Headers
        if (trimmed.startsWith("### ")) {
          return <h3 key={bIdx}>{renderInlineFormatting(trimmed.replace("### ", ""))}</h3>;
        }
        if (trimmed.startsWith("#### ")) {
          return <h4 key={bIdx}>{renderInlineFormatting(trimmed.replace("#### ", ""))}</h4>;
        }

        // Callout quotes
        if (trimmed.startsWith("> ") || trimmed.startsWith("| ")) {
          return (
            <blockquote key={bIdx} className="message-callout">
              {renderInlineFormatting(trimmed.replace(/^[>|]\s*/, ""))}
            </blockquote>
          );
        }

        // Lines within block
        const lines = trimmed.split("\n");
        const hasBullets = lines.some(l => l.trim().startsWith("* ") || l.trim().startsWith("- "));

        if (hasBullets) {
          const subElements = [];
          let currentList = [];

          lines.forEach((line, lIdx) => {
            const lTrim = line.trim();
            if (lTrim.startsWith("* ") || lTrim.startsWith("- ")) {
              currentList.push(lTrim.replace(/^[\*\-]\s+/, ""));
            } else {
              if (currentList.length > 0) {
                subElements.push(
                  <ul key={`ul-${lIdx}`} className="message-bullet-list">
                    {currentList.map((item, idx) => (
                      <li key={idx}>{renderInlineFormatting(item)}</li>
                    ))}
                  </ul>
                );
                currentList = [];
              }
              if (lTrim.length > 0) {
                subElements.push(<p key={`p-${lIdx}`}>{renderInlineFormatting(lTrim)}</p>);
              }
            }
          });

          if (currentList.length > 0) {
            subElements.push(
              <ul key={`ul-end`} className="message-bullet-list">
                {currentList.map((item, idx) => (
                  <li key={idx}>{renderInlineFormatting(item)}</li>
                ))}
              </ul>
            );
          }

          return <div key={bIdx} className="mixed-block">{subElements}</div>;
        }

        return <p key={bIdx}>{renderInlineFormatting(trimmed)}</p>;
      })}
    </div>
  );
}

export default function App() {
  const [sessionId, setSessionId] = useState(() => "session-" + Math.random().toString(36).substring(2, 9));
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hello! I am MediBuddy's Weather-Advisory Assistant. Ask me any question regarding outdoor activity safety (e.g., cycling, jogging, picnics, kids at the park), and I will evaluate live Open-Meteo weather data strictly against our verified Standard Operating Procedures (SOPs).",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeWeather, setActiveWeather] = useState(null);
  const [activeLocation, setActiveLocation] = useState(null);
  const [activeSop, setActiveSop] = useState(null);
  const [activeCitations, setActiveCitations] = useState([]);
  const [verification, setVerification] = useState(null);
  const [allSops, setAllSops] = useState([]);
  const [showAddSopModal, setShowAddSopModal] = useState(false);
  const [mobileTab, setMobileTab] = useState("chat"); // "chat" | "inspector"

  // New SOP Form State for Live Interview Test
  const [newSopId, setNewSopId] = useState("SOP-LIVE-011");
  const [newSopTitle, setNewSopTitle] = useState("High Heat Advisory for Outdoor Tennis");
  const [newSopCategory, setNewSopCategory] = useState("outdoor_exercise");
  const [newSopActivity, setNewSopActivity] = useState("tennis");
  const [newSopSeverity, setNewSopSeverity] = useState("DANGER");
  const [newSopConditionMetric, setNewSopConditionMetric] = useState("temperature_2m");
  const [newSopConditionOp, setNewSopConditionOp] = useState("gte");
  const [newSopConditionVal, setNewSopConditionVal] = useState("35.0");
  const [newSopGuidance, setNewSopGuidance] = useState("Temperatures above 35°C on open hard courts dramatically elevate dehydration and heat exhaustion. Restrict tennis to indoor courts or reschedule.");

  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchSops();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function fetchSops() {
    try {
      const res = await fetch("/api/sops");
      if (res.ok) {
        const data = await res.json();
        setAllSops(data.sops || []);
      }
    } catch (err) {
      console.error("Failed to fetch SOPs:", err);
    }
  }

  async function handleSendMessage(e) {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput("");

    // Add user message
    const userMsg = {
      role: "user",
      content: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: userText,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to get response");
      }

      const botMsg = {
        role: "assistant",
        content: data.response,
        citations: data.citations,
        status: data.status,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages(prev => [...prev, botMsg]);

      // Update Inspector Sidebar with live data
      if (data.weather) {
        setActiveWeather(data.weather);
      }
      if (data.location) {
        setActiveLocation(data.location);
      }
      if (data.sopEvaluation?.primarySop) {
        setActiveSop(data.sopEvaluation.primarySop);
      } else {
        setActiveSop(null);
      }
      setActiveCitations(data.citations || []);
      setVerification(data.verification || null);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ Error executing request: ${err.message}. Please ensure the Express backend is running.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResetSession() {
    const newId = "session-" + Math.random().toString(36).substring(2, 9);
    try {
      await fetch("/api/reset-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch (e) {}

    setSessionId(newId);
    setMessages([
      {
        role: "assistant",
        content: "New conversation session initialized. All memory channels have been reset. What outdoor activity safety questions can I answer for you?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
    ]);
    setActiveWeather(null);
    setActiveLocation(null);
    setActiveSop(null);
    setActiveCitations([]);
    setVerification(null);
  }

  async function handleAddLiveSop(e) {
    e.preventDefault();
    const newSopObj = {
      id: newSopId,
      title: newSopTitle,
      category: newSopCategory,
      scope: "activity_specific",
      target_activities: [newSopActivity],
      target_groups: ["all"],
      severity: newSopSeverity,
      priority: 70,
      conditions: {
        [newSopConditionMetric]: {
          [newSopConditionOp]: parseFloat(newSopConditionVal),
        }
      },
      summary: newSopTitle,
      guidance: newSopGuidance,
      required_actions: [
        "Avoid outdoor activity under these conditions",
        "Hydrate and seek indoor alternatives"
      ]
    };

    try {
      const res = await fetch("/api/sops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSopObj),
      });

      if (res.ok) {
        alert(`Success! [${newSopId}] has been added live to data/sops.yaml without code changes.`);
        setShowAddSopModal(false);
        fetchSops();
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    }
  }

  function handleQuickPrompt(text) {
    setInput(text);
  }

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="brand-group">
          <div className="brand-icon">MB</div>
          <div>
            <div className="brand-title">
              MediBuddy <span>Weather-Advisory Assistant</span>
            </div>
            <div className="brand-tagline">#wehealbycode • LangGraph Policy Engine</div>
          </div>
        </div>

        <div className="header-actions">
          <div className="sop-counter-badge" onClick={() => setShowAddSopModal(true)} title="Click to view or add SOPs">
            <span className="pulse-dot"></span>
            <strong>{allSops.length}</strong>
            <span className="badge-text-full"> Active SOPs Loaded</span>
            <span className="badge-text-short"> SOPs</span>
          </div>

          <button className="btn-secondary" onClick={() => setShowAddSopModal(true)}>
            <span className="btn-text-full">+ Add 11th SOP Live</span>
            <span className="btn-text-short">+ SOP</span>
          </button>

          <button className="btn-outline" onClick={handleResetSession} title="Reset session memory">
            <span className="btn-text-full">Reset Session</span>
            <span className="btn-text-short">🔄</span>
          </button>
        </div>
      </header>

      {/* Mobile Tab Navigation Bar (Shown on small screens) */}
      <nav className="mobile-tab-bar" aria-label="Mobile view navigation">
        <button
          type="button"
          className={`mobile-tab-btn ${mobileTab === "chat" ? "active" : ""}`}
          onClick={() => setMobileTab("chat")}
        >
          <span className="tab-icon">💬</span>
          <span className="tab-text">Advisory Chat</span>
        </button>
        <button
          type="button"
          className={`mobile-tab-btn ${mobileTab === "inspector" ? "active" : ""}`}
          onClick={() => setMobileTab("inspector")}
        >
          <span className="tab-icon">📊</span>
          <span className="tab-text">Weather & SOPs</span>
          {activeWeather?.effectiveMetrics && <span className="tab-live-dot" title="Live weather active" />}
        </button>
      </nav>

      {/* Main Workspace */}
      <div className="workspace">
        {/* Left Column: Conversational Thread */}
        <main className={`chat-pane ${mobileTab === "chat" ? "mobile-active" : "mobile-hidden"}`}>
          {/* Mobile Live Weather Pill Banner */}
          {activeWeather && activeWeather.effectiveMetrics && (
            <div className="mobile-weather-pill" onClick={() => setMobileTab("inspector")} title="Tap to view full telemetry & SOP citations">
              <span className="pill-dot">🟢</span>
              <span className="pill-text">
                <strong>{activeLocation?.name || "Detected"}:</strong> {activeWeather.effectiveMetrics.temperature_2m}°C • Wind: {activeWeather.effectiveMetrics.wind_speed_10m} km/h • {activeSop ? activeSop.id : "Live Telemetry"}
              </span>
              <span className="pill-action">Inspect 📊</span>
            </div>
          )}

          <div className="messages-list">
            {messages.map((m, idx) => (
              <div key={idx} className={`message-row ${m.role}`}>
                <div className="avatar">
                  {m.role === "assistant" ? "🤖" : "👤"}
                </div>
                <div className="message-content">
                  <div className="message-header">
                    <span className="sender-name">
                      {m.role === "assistant" ? "MediBuddy Safety Engine" : "You"}
                    </span>
                    <span className="timestamp">{m.timestamp}</span>
                  </div>

                  <div className="message-text">
                    <FormattedMessage content={m.content} />
                  </div>

                  {m.citations && m.citations.length > 0 && (
                    <div className="citation-tags">
                      <span className="tag-label">Policy Citations:</span>
                      {m.citations.map((c, cIdx) => (
                        <span key={cIdx} className="sop-badge">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="message-row assistant">
                <div className="avatar">🤖</div>
                <div className="message-content loading-card">
                  <div className="spinner"></div>
                  <span>Evaluating live weather data against MediBuddy SOPs...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts Bar */}
          <div className="quick-prompts-bar">
            <span className="quick-label">Try:</span>
            <button className="chip" onClick={() => handleQuickPrompt("Is it safe to bike in Bhopal today?")}>
              🚲 Bike in Bhopal
            </button>
            <button className="chip" onClick={() => handleQuickPrompt("What about this evening instead?")}>
              🌙 "What about this evening?" (Memory)
            </button>
            <button className="chip" onClick={() => handleQuickPrompt("Is today a good day for a picnic in Bhopal?")}>
              🧺 Picnic in Bhopal
            </button>
            <button className="chip" onClick={() => handleQuickPrompt("Should I take my toddler to the playground at noon in Chennai?")}>
              👶 Toddler UV in Chennai
            </button>
            <button className="chip" onClick={() => handleQuickPrompt("Can I read a book on my covered balcony in Delhi?")}>
              ❓ No-SOP Scenario
            </button>
          </div>

          {/* Chat Input Box */}
          <form className="chat-input-form" onSubmit={handleSendMessage}>
            <input
              type="text"
              className="chat-input"
              placeholder="Ask an outdoor activity safety question (e.g., 'Can I cycle in Bhopal today?')"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
            />
            <button type="submit" className="btn-send" disabled={isLoading || !input.trim()}>
              Send
            </button>
          </form>
        </main>

        {/* Right Column: Live Policy & Weather Inspector */}
        <aside className={`inspector-pane ${mobileTab === "inspector" ? "mobile-active" : "mobile-hidden"}`}>
          <div className="mobile-inspector-back">
            <button className="btn-back-to-chat" onClick={() => setMobileTab("chat")}>
              ← Back to Chat
            </button>
            <span className="mobile-inspector-title">Telemetry & SOPs</span>
          </div>

          <div className="inspector-card">
            <div className="card-header">
              <h3>Live Weather Context</h3>
              <span className="api-badge">Open-Meteo Free API</span>
            </div>

            {activeWeather && activeWeather.effectiveMetrics ? (
              <div className="weather-grid">
                <div className="weather-stat">
                  <span className="stat-label">Location</span>
                  <span className="stat-value">{activeLocation?.name || "Detected"}</span>
                </div>
                <div className="weather-stat">
                  <span className="stat-label">Window</span>
                  <span className="stat-value">{activeWeather.windowLabel || "Current"}</span>
                </div>
                <div className="weather-stat highlight">
                  <span className="stat-label">Temperature</span>
                  <span className="stat-value">{activeWeather.effectiveMetrics.temperature_2m}°C</span>
                </div>
                <div className="weather-stat highlight">
                  <span className="stat-label">Wind Speed</span>
                  <span className="stat-value">{activeWeather.effectiveMetrics.wind_speed_10m} km/h</span>
                </div>
                <div className="weather-stat">
                  <span className="stat-label">Wind Gusts</span>
                  <span className="stat-value">{activeWeather.effectiveMetrics.wind_gusts_10m} km/h</span>
                </div>
                <div className="weather-stat">
                  <span className="stat-label">Precipitation</span>
                  <span className="stat-value">{activeWeather.effectiveMetrics.precipitation} mm</span>
                </div>
                <div className="weather-stat">
                  <span className="stat-label">Rain Probability</span>
                  <span className="stat-value">{activeWeather.effectiveMetrics.precipitation_probability}%</span>
                </div>
                <div className="weather-stat">
                  <span className="stat-label">UV Index</span>
                  <span className="stat-value">{activeWeather.effectiveMetrics.uv_index}</span>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                Ask a question with a location to pull live weather metrics from Open-Meteo.
              </div>
            )}
          </div>

          {/* Active SOP Binding Card */}
          <div className="inspector-card">
            <div className="card-header">
              <h3>Active SOP Policy Citation</h3>
              <span className="guardrail-badge">Zero Hallucinations</span>
            </div>

            {activeSop ? (
              <div className="sop-card">
                <div className="sop-header">
                  <span className={`severity-tag ${activeSop.severity.toLowerCase()}`}>
                    {activeSop.severity}
                  </span>
                  <span className="sop-id">{activeSop.id}</span>
                </div>
                <div className="sop-title">{activeSop.title}</div>
                <div className="sop-category">
                  Category: <strong>{activeSop.category}</strong>
                </div>

                {activeCitations.length > 1 && (
                  <div className="co-advisories-note">
                    + {activeCitations.length - 1} secondary co-advisories triggered
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state">
                No active SOP currently triggered for this turn.
              </div>
            )}
          </div>

          {/* Fact Grounding Verification Card */}
          <div className="inspector-card">
            <div className="card-header">
              <h3>Numerical Grounding Guard</h3>
              <span className="code-badge">Enforced in Code</span>
            </div>

            {verification ? (
              <div className="verification-box">
                <div className={`status-pill ${verification.passed ? "passed" : "flagged"}`}>
                  {verification.passed ? "✓ 100% Grounded in Live API Data" : "⚠️ Ungrounded Number Detected"}
                </div>
                <div className="verification-note">{verification.enforcementNote}</div>
              </div>
            ) : (
              <div className="empty-state">
                Numerical grounding verifier runs post-generation on every response.
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Live 11th SOP Modal for Interview Demo */}
      {showAddSopModal && (
        <div className="modal-backdrop" onClick={() => setShowAddSopModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Live SOP Policy Manager</h3>
              <button className="close-btn" onClick={() => setShowAddSopModal(false)}>✕</button>
            </div>

            <div className="modal-body">
              <p className="modal-desc">
                MediBuddy SOPs are decoupled from code in <code>data/sops.yaml</code>.
                Adding or modifying an SOP takes effect immediately without touching Python/Express code or restarting the server.
              </p>

              <form onSubmit={handleAddLiveSop} className="sop-form">
                <div className="form-row">
                  <label>SOP ID</label>
                  <input value={newSopId} onChange={e => setNewSopId(e.target.value)} required />
                </div>
                <div className="form-row">
                  <label>Title</label>
                  <input value={newSopTitle} onChange={e => setNewSopTitle(e.target.value)} required />
                </div>
                <div className="form-row">
                  <label>Target Activity</label>
                  <input value={newSopActivity} onChange={e => setNewSopActivity(e.target.value)} required />
                </div>
                <div className="form-row">
                  <label>Severity</label>
                  <select value={newSopSeverity} onChange={e => setNewSopSeverity(e.target.value)}>
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="DANGER">DANGER</option>
                    <option value="CAUTION">CAUTION</option>
                    <option value="ADVISORY">ADVISORY</option>
                    <option value="FAVORABLE">FAVORABLE</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Condition (Trigger)</label>
                  <div className="condition-inputs">
                    <select value={newSopConditionMetric} onChange={e => setNewSopConditionMetric(e.target.value)}>
                      <option value="temperature_2m">temperature_2m</option>
                      <option value="wind_speed_10m">wind_speed_10m</option>
                      <option value="precipitation">precipitation</option>
                      <option value="uv_index">uv_index</option>
                    </select>
                    <select value={newSopConditionOp} onChange={e => setNewSopConditionOp(e.target.value)}>
                      <option value="gte">&gt;=</option>
                      <option value="lte">&lt;=</option>
                    </select>
                    <input type="number" step="0.1" value={newSopConditionVal} onChange={e => setNewSopConditionVal(e.target.value)} required />
                  </div>
                </div>
                <div className="form-row">
                  <label>Official Safety Guidance</label>
                  <textarea rows="3" value={newSopGuidance} onChange={e => setNewSopGuidance(e.target.value)} required />
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn-outline" onClick={() => setShowAddSopModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    Save & Inject SOP Live
                  </button>
                </div>
              </form>

              <hr className="divider" />
              <h4>Currently Active SOPs ({allSops.length}):</h4>
              <div className="sop-list-preview">
                {allSops.map(s => (
                  <div key={s.id} className="sop-preview-item">
                    <span className="sop-badge">{s.id}</span>
                    <span className="sop-preview-title">{s.title}</span>
                    <span className={`severity-tag ${s.severity.toLowerCase()}`}>{s.severity}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
