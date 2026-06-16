import { useState, useEffect, useCallback, useRef } from "react";

const PROVINCES = [
  "All Provinces", "Gauteng", "Western Cape", "KwaZulu-Natal",
  "Eastern Cape", "Limpopo", "Mpumalanga", "North West",
  "Free State", "Northern Cape", "National"
];

const KEYWORDS = [
  "voter registration", "IEC", "polling station", "municipal election",
  "ward committee", "ballot", "voters roll", "registration drive",
  "how to vote", "voter ID", "registration deadline", "electoral commission"
];

const PROVINCE_STATS_DEFAULT = [
  { name: "Gauteng", mentions: 0, sentiment: 70, color: "#00C896" },
  { name: "Western Cape", mentions: 0, sentiment: 75, color: "#00A8E8" },
  { name: "KwaZulu-Natal", mentions: 0, sentiment: 60, color: "#FFB800" },
  { name: "Eastern Cape", mentions: 0, sentiment: 50, color: "#FF6B6B" },
  { name: "Limpopo", mentions: 0, sentiment: 55, color: "#A78BFA" },
  { name: "Mpumalanga", mentions: 0, sentiment: 52, color: "#F97316" },
];

const sentimentColor = (s) => ({
  positive: "#00C896", negative: "#FF6B6B", neutral: "#94A3B8",
  confused: "#FFB800", urgent: "#F97316", official: "#00A8E8", query: "#A78BFA"
}[s] || "#94A3B8");

const categoryIcon = (c) => ({
  official: "🏛️", registration: "✅", query: "❓",
  concern: "⚠️", deadline: "⏰", barrier: "🚧"
}[c] || "📌");

async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
}

function ProvinceBar({ name, mentions, sentiment, color, max }) {
  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontSize: "12px", color: "#CBD5E1" }}>{name}</span>
        <span style={{ fontSize: "12px", color, fontWeight: 600 }}>{mentions}</span>
      </div>
      <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "4px", height: "6px", overflow: "hidden" }}>
        <div style={{ width: max > 0 ? `${(mentions / max) * 100}%` : "0%", height: "100%", background: color, borderRadius: "4px", transition: "width 1s ease" }} />
      </div>
    </div>
  );
}

function TrendBar({ data }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "60px" }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{
            width: "100%",
            height: `${(d.count / max) * 52}px`,
            background: `rgba(0,200,150,${0.3 + (d.count / max) * 0.7})`,
            borderRadius: "3px 3px 0 0",
            transition: "height 0.5s ease",
            minHeight: "4px"
          }} />
        </div>
      ))}
    </div>
  );
}

export default function VoterWatchLive() {
  const [feedItems, setFeedItems] = useState([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [liveCount, setLiveCount] = useState(0);

  const [selectedProvince, setSelectedProvince] = useState("All Provinces");
  const [selectedItem, setSelectedItem] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("feed");
  const [provinceStats, setProvinceStats] = useState(PROVINCE_STATS_DEFAULT);
  const [trendData, setTrendData] = useState([]);

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
  const refreshTimer = useRef(null);

  // ── Fetch real RSS feed data ──
  const fetchFeed = useCallback(async () => {
    try {
      setFeedLoading(true);
      setFeedError(null);
      const res = await fetch("/api/feed");
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setFeedItems(data.items || []);
      setLiveCount(data.liveCount || 0);
      setLastFetched(new Date());

      // Build province stats from real data
      const counts = {};
      data.items.forEach(item => {
        counts[item.province] = (counts[item.province] || 0) + 1;
      });
      setProvinceStats(prev => prev.map(p => ({
        ...p,
        mentions: counts[p.name] || 0
      })));

      // Build trend data (last 7 fetch snapshots stored in state)
      setTrendData(prev => {
        const next = [...prev, { count: data.items.length, time: new Date() }].slice(-7);
        return next;
      });

    } catch (err) {
      setFeedError(err.message);
    } finally {
      setFeedLoading(false);
    }
  }, []);

  // Fetch on mount and refresh every 5 minutes
  useEffect(() => {
    fetchFeed();
    refreshTimer.current = setInterval(fetchFeed, 5 * 60 * 1000);
    return () => clearInterval(refreshTimer.current);
  }, [fetchFeed]);

  const filteredFeed = selectedProvince === "All Provinces"
    ? feedItems
    : feedItems.filter(d => d.province === selectedProvince);

  const maxMentions = Math.max(...provinceStats.map(p => p.mentions), 1);
  const positiveCount = feedItems.filter(d => d.sentiment === "positive").length;
  const concernCount = feedItems.filter(d => d.sentiment === "negative").length;
  const sentimentPct = feedItems.length > 0 ? Math.round((positiveCount / feedItems.length) * 100) : 0;

  const analyzeItem = useCallback(async (item) => {
    setSelectedItem(item);
    setAiAnalysis("");
    setAiLoading(true);
    try {
      const prompt = `You are an election monitoring analyst for South Africa's municipal voter registration campaign.

Analyse this ${item.live ? "LIVE" : "example"} article from ${item.source} in ${item.province}:

HEADLINE: "${item.title}"
${item.description ? `EXCERPT: "${item.description}"` : ""}
SENTIMENT: ${item.sentiment} | CATEGORY: ${item.category}

Respond in exactly this format:
SUMMARY: (one sentence explaining what this means for voter registration)

KEY IMPLICATIONS:
• (implication 1)
• (implication 2)

RECOMMENDED ACTION: (one concrete action for the monitoring team)`;

      const result = await callGemini(apiKey, prompt);
      setAiAnalysis(result);
    } catch (err) {
      setAiAnalysis(`Analysis unavailable: ${err.message}\n\nCheck your Gemini API key in the .env file.`);
    }
    setAiLoading(false);
  }, [apiKey]);

  const generateDailyBrief = useCallback(async () => {
    setSummaryLoading(true);
    setAiSummary("");
    setActiveTab("brief");
    try {
      const headlines = feedItems.slice(0, 15).map(d =>
        `- [${d.province}] ${d.title} (${d.sentiment})`
      ).join("\n");

      const prompt = `You are an election monitoring analyst producing a daily brief for VoterWatch SA.

Today's tracked content (${feedItems.length} items, ${liveCount} live from SA news feeds):
${headlines}

STATS: ${positiveCount} positive sentiment | ${concernCount} concern flags | ${sentimentPct}% positive overall

Write a professional daily monitoring brief with these sections:
EXECUTIVE SUMMARY
TOP TRENDS BY PROVINCE  
KEY CONCERNS REQUIRING ATTENTION
RECOMMENDED ACTIONS FOR TODAY

Be specific, concise, and actionable. This goes to IEC liaisons and funders.`;

      const result = await callGemini(apiKey, prompt);
      setAiSummary(result);
    } catch (err) {
      setAiSummary(`Brief failed: ${err.message}`);
    }
    setSummaryLoading(false);
  }, [apiKey, feedItems, liveCount, positiveCount, concernCount, sentimentPct]);

  const s = {
    app: { minHeight: "100vh", background: "#080E1A", fontFamily: "'DM Sans', sans-serif", color: "#E2E8F0" },
    header: { borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.4)", position: "sticky", top: 0, zIndex: 100, gap: "12px", flexWrap: "wrap" },
    main: { padding: "20px 24px", maxWidth: "1400px", margin: "0 auto" },
    statsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" },
    statCard: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px" },
    grid: { display: "grid", gridTemplateColumns: "1fr 340px", gap: "16px", alignItems: "start" },
    card: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", overflow: "hidden" },
    tabRow: { display: "flex", gap: "4px", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap", alignItems: "center" },
    tab: (a) => ({ padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: a ? 600 : 400, background: a ? "rgba(0,200,150,0.15)" : "transparent", color: a ? "#00C896" : "#64748B", border: a ? "1px solid rgba(0,200,150,0.3)" : "1px solid transparent", cursor: "pointer" }),
    select: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#CBD5E1", borderRadius: "8px", padding: "6px 10px", fontSize: "12px", cursor: "pointer", outline: "none" },
    feedItem: (sel) => ({ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer", background: sel ? "rgba(0,200,150,0.06)" : "transparent", borderLeft: sel ? "2px solid #00C896" : "2px solid transparent" }),
    badge: (color) => ({ fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: `${color}20`, color, fontWeight: 600 }),
    liveBadge: { fontSize: "10px", padding: "2px 7px", borderRadius: "4px", background: "rgba(0,200,150,0.15)", color: "#00C896", fontWeight: 700, border: "1px solid rgba(0,200,150,0.3)" },
    actionBtn: { display: "inline-flex", alignItems: "center", gap: "6px", padding: "7px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: "pointer", border: "none", background: "linear-gradient(135deg, #00C896, #00A8E8)", color: "#080E1A" },
    placeholder: { padding: "32px", textAlign: "center", color: "#475569", fontSize: "12px" },
    refreshBtn: { padding: "5px 10px", borderRadius: "6px", fontSize: "11px", cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#64748B" },
  };

  if (!apiKey || apiKey === "your_gemini_key_here") {
    return (
      <div style={{ ...s.app, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "40px", maxWidth: "500px" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🗝️</div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#F1F5F9", marginBottom: "12px" }}>Gemini API Key Required</div>
          <div style={{ fontSize: "13px", color: "#64748B", lineHeight: 1.8, textAlign: "left", background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "20px" }}>
            <strong style={{ color: "#CBD5E1" }}>Get your FREE key:</strong><br /><br />
            1. Go to <strong style={{ color: "#00A8E8" }}>aistudio.google.com</strong><br />
            2. Sign in with your Google account<br />
            3. Click <strong style={{ color: "#00C896" }}>"Get API Key"</strong> → <strong style={{ color: "#00C896" }}>"Create API Key"</strong><br />
            4. Copy the key (starts with AIza...)<br /><br />
            Then add it to your Vercel environment variables as:<br />
            <code style={{ background: "rgba(255,255,255,0.1)", padding: "4px 8px", borderRadius: "4px", display: "block", marginTop: "8px" }}>VITE_GEMINI_API_KEY = your_key_here</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes spin { to { transform: rotate(360deg) } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        button:hover { opacity: 0.85; }
        a { color: #00A8E8; text-decoration: none; }
        a:hover { text-decoration: underline; }
      `}</style>

      {/* Header */}
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "36px", height: "36px", background: "linear-gradient(135deg,#00C896,#00A8E8)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", flexShrink: 0 }}>🗳️</div>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#F1F5F9" }}>VoterWatch SA</div>
            <div style={{ fontSize: "11px", color: "#64748B" }}>
              Live Municipal Election Monitor
              {liveCount > 0 && <span style={{ color: "#00C896", marginLeft: "6px" }}>· {liveCount} live articles</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <select style={s.select} value={selectedProvince} onChange={e => setSelectedProvince(e.target.value)}>
            {PROVINCES.map(p => <option key={p}>{p}</option>)}
          </select>
          <button style={s.refreshBtn} onClick={fetchFeed} disabled={feedLoading}>
            {feedLoading ? "⏳" : "🔄"} Refresh
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#64748B" }}>
            <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: feedLoading ? "#FFB800" : "#00C896", animation: "pulse 2s infinite" }} />
            {lastFetched ? lastFetched.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : "Loading..."}
          </div>
        </div>
      </div>

      <div style={s.main}>
        {/* Stats */}
        <div style={s.statsRow}>
          {[
            { label: "Articles Tracked", value: feedItems.length.toString(), change: `${liveCount} live from SA news`, color: "#00C896" },
            { label: "Positive Sentiment", value: `${sentimentPct}%`, change: `${positiveCount} positive items`, color: "#00A8E8" },
            { label: "Concern Flags", value: concernCount.toString(), change: "Negative sentiment items", color: "#FFB800" },
            { label: "Provinces Covered", value: `${new Set(feedItems.map(i => i.province)).size}/9`, change: "Active in feed", color: "#A78BFA" },
          ].map((stat, i) => (
            <div key={i} style={s.statCard}>
              <div style={{ fontSize: "11px", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "8px" }}>{stat.label}</div>
              <div style={{ fontSize: "28px", fontWeight: 700, color: stat.color, letterSpacing: "-1px", lineHeight: 1 }}>
                {feedLoading ? "—" : stat.value}
              </div>
              <div style={{ fontSize: "11px", color: stat.color + "99", marginTop: "4px" }}>{stat.change}</div>
            </div>
          ))}
        </div>

        {/* Error banner */}
        {feedError && (
          <div style={{ padding: "10px 14px", background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.2)", borderRadius: "8px", marginBottom: "16px", fontSize: "12px", color: "#FF6B6B" }}>
            ⚠️ Could not fetch live feed: {feedError} — showing cached or example data
          </div>
        )}

        {/* Main grid */}
        <div style={s.grid}>
          <div style={s.card}>
            <div style={s.tabRow}>
              {["feed", "brief", "trends"].map(tab => (
                <button key={tab} style={s.tab(activeTab === tab)} onClick={() => setActiveTab(tab)}>
                  {{ feed: "📡 Live Feed", brief: "📋 Daily Brief", trends: "📈 Trends" }[tab]}
                </button>
              ))}
              {activeTab === "brief" && (
                <button style={{ ...s.actionBtn, marginLeft: "auto" }} onClick={generateDailyBrief} disabled={summaryLoading || feedItems.length === 0}>
                  {summaryLoading ? "⏳ Generating..." : "✨ Generate AI Brief"}
                </button>
              )}
            </div>

            {/* FEED TAB */}
            {activeTab === "feed" && (
              <div style={{ maxHeight: "560px", overflowY: "auto" }}>
                {feedLoading && (
                  <div style={s.placeholder}>
                    <div style={{ fontSize: "24px", animation: "pulse 1s infinite", marginBottom: "8px" }}>📡</div>
                    Fetching live SA news feeds…
                  </div>
                )}
                {!feedLoading && filteredFeed.length === 0 && (
                  <div style={s.placeholder}>
                    <div style={{ fontSize: "24px", marginBottom: "8px" }}>🔍</div>
                    No voter registration content found for {selectedProvince} right now.<br />
                    <span style={{ color: "#334155" }}>Try "All Provinces" or check back later.</span>
                  </div>
                )}
                {!feedLoading && filteredFeed.map(item => (
                  <div key={item.id} style={s.feedItem(selectedItem?.id === item.id)} onClick={() => analyzeItem(item)}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px", flexWrap: "wrap" }}>
                      <span>{categoryIcon(item.category)}</span>
                      <span style={s.badge(sentimentColor(item.sentiment))}>{item.sentiment}</span>
                      <span style={{ fontSize: "11px", color: "#00A8E8", fontWeight: 500 }}>{item.source}</span>
                      {item.live && <span style={s.liveBadge}>LIVE</span>}
                      <span style={{ fontSize: "11px", color: "#334155", marginLeft: "auto" }}>{item.time}</span>
                    </div>
                    <div style={{ fontSize: "13px", color: "#E2E8F0", lineHeight: 1.4, marginBottom: "4px" }}>
                      {item.link
                        ? <a href={item.link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{item.title}</a>
                        : item.title}
                    </div>
                    <div style={{ fontSize: "11px", color: "#475569" }}>{item.province}</div>
                  </div>
                ))}
              </div>
            )}

            {/* BRIEF TAB */}
            {activeTab === "brief" && (
              <div style={{ maxHeight: "560px", overflowY: "auto" }}>
                {!aiSummary && !summaryLoading && (
                  <div style={{ ...s.placeholder, padding: "48px 24px" }}>
                    <div style={{ fontSize: "32px", marginBottom: "10px" }}>📋</div>
                    <div>Click "Generate AI Brief" to produce today's monitoring summary</div>
                    <div style={{ color: "#334155", marginTop: "6px" }}>Based on {feedItems.length} live articles</div>
                  </div>
                )}
                {summaryLoading && (
                  <div style={{ ...s.placeholder, padding: "48px 24px" }}>
                    <div style={{ fontSize: "24px", animation: "pulse 1.5s infinite", marginBottom: "8px" }}>✨</div>
                    Gemini is analysing {feedItems.length} articles across SA provinces…
                  </div>
                )}
                {aiSummary && (
                  <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.9, whiteSpace: "pre-wrap", padding: "16px" }}>
                    {aiSummary}
                  </div>
                )}
              </div>
            )}

            {/* TRENDS TAB */}
            {activeTab === "trends" && (
              <div style={{ padding: "16px" }}>
                {trendData.length > 1 && (
                  <div style={{ marginBottom: "20px" }}>
                    <div style={{ fontSize: "12px", color: "#64748B", marginBottom: "10px" }}>ARTICLE VOLUME — LAST {trendData.length} FETCHES</div>
                    <TrendBar data={trendData} />
                  </div>
                )}
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "12px", color: "#64748B", marginBottom: "12px" }}>MENTIONS BY PROVINCE</div>
                  {provinceStats.map(p => <ProvinceBar key={p.name} {...p} max={maxMentions} />)}
                </div>
                <div style={{ padding: "12px", background: "rgba(0,200,150,0.06)", borderRadius: "8px", border: "1px solid rgba(0,200,150,0.15)" }}>
                  <div style={{ fontSize: "11px", color: "#00C896", fontWeight: 600, marginBottom: "8px" }}>TRACKED KEYWORDS</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {KEYWORDS.map(k => (
                      <span key={k} style={{ fontSize: "10px", padding: "3px 8px", background: "rgba(255,255,255,0.05)", borderRadius: "4px", color: "#94A3B8" }}>{k}</span>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: "16px", padding: "12px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", fontSize: "11px", color: "#475569", lineHeight: 1.7 }}>
                  <strong style={{ color: "#64748B" }}>DATA SOURCES</strong><br />
                  News24 · Daily Maverick · GroundUp · SABC News · IOL · EWN<br />
                  Auto-refreshes every 5 minutes · Filtered for SA voter registration content
                </div>
              </div>
            )}
          </div>

          {/* Right panel */}
          <div>
            <div style={s.card}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1" }}>✨ AI Analysis</div>
                <div style={{ fontSize: "10px", color: "#475569" }}>Powered by Gemini</div>
              </div>
              <div style={{ padding: "14px 16px" }}>
                {!selectedItem && !aiLoading && (
                  <div style={{ ...s.placeholder, padding: "32px 0" }}>
                    <div style={{ fontSize: "28px", marginBottom: "8px" }}>👆</div>
                    Click any article in the feed to get an instant AI analysis
                  </div>
                )}
                {selectedItem && (
                  <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "10px", padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: "6px" }}>
                    <strong style={{ color: "#CBD5E1" }}>{selectedItem.source}</strong>
                    {selectedItem.live && <span style={{ ...s.liveBadge, marginLeft: "6px" }}>LIVE</span>}
                    <br />{selectedItem.province}<br />
                    <span style={{ color: sentimentColor(selectedItem.sentiment) }}>{selectedItem.sentiment}</span>
                  </div>
                )}
                {aiLoading && (
                  <div style={{ ...s.placeholder, padding: "24px 0" }}>
                    <div style={{ animation: "pulse 1s infinite", fontSize: "20px" }}>🔍</div>
                    <div style={{ marginTop: "8px" }}>Analysing with Gemini…</div>
                  </div>
                )}
                {aiAnalysis && !aiLoading && (
                  <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                    {aiAnalysis}
                  </div>
                )}
              </div>
            </div>

            <div style={{ ...s.card, marginTop: "12px" }}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#CBD5E1" }}>🗺️ Province Pulse</div>
              </div>
              <div style={{ padding: "12px 16px" }}>
                {provinceStats.map(p => (
                  <div key={p.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{ fontSize: "12px", color: "#94A3B8" }}>{p.name}</span>
                    <span style={{ fontSize: "11px", color: p.mentions > 0 ? "#00C896" : "#334155", fontWeight: 600 }}>
                      {feedLoading ? "—" : p.mentions > 0 ? `${p.mentions} article${p.mentions > 1 ? "s" : ""}` : "no items"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
