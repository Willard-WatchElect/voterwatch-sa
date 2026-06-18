import { useState, useEffect, useCallback, useRef } from "react";

const TOPICS = [
  { key:"voter", label:"🗳️ Voter Registration", description:"Municipal election voter registration across SA", color:"#00C896", aiContext:"You are an election monitoring analyst for South Africa's municipal voter registration campaign. Focus on implications for voter registration efforts and IEC outreach." },
  { key:"youth", label:"🧑 Youth Day & IEC", description:"Youth Day, June 16 and youth voter engagement", color:"#00A8E8", aiContext:"You are a civic monitoring analyst tracking National Youth Day coverage and IEC youth voter engagement in South Africa." }
];

const PROVINCES = ["All Provinces","Gauteng","Western Cape","KwaZulu-Natal","Eastern Cape","Limpopo","Mpumalanga","North West","Free State","Northern Cape","National"];

// SA news sites for Google search filtering
const SA_NEWS_SITES = "site:news24.com OR site:dailymaverick.co.za OR site:groundup.org.za OR site:sabc.co.za OR site:iol.co.za OR site:ewn.co.za OR site:timeslive.co.za OR site:thesouthafrican.com OR site:businessday.co.za OR site:citizen.co.za";

const ELECTION_PERIODS = [
  { label:"2026 — Current Campaign", startDate:"2026-01-01", endDate:"2026-11-04", description:"Municipal elections 4 November 2026" },
  { label:"2021 — Previous Municipal", startDate:"2021-07-01", endDate:"2021-11-01", description:"Municipal elections 1 November 2021" },
  { label:"2016 — Municipal", startDate:"2016-04-01", endDate:"2016-08-03", description:"Municipal elections 3 August 2016" },
];

const sentimentColor = s => ({ positive:"#00C896", negative:"#FF6B6B", neutral:"#94A3B8", urgent:"#F97316", query:"#A78BFA", official:"#00A8E8" }[s]||"#94A3B8");
const categoryIcon = c => ({ official:"🏛️", registration:"✅", query:"❓", concern:"⚠️", deadline:"⏰", barrier:"🚧" }[c]||"📌");

async function callGemini(apiKey, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.7,maxOutputTokens:1200} })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
}

function exportCSV(items, topic) {
  const headers = ["Date","Time","Source","Province","Title","Sentiment","Category","Flagged","Note","Link"];
  const rows = items.map(i => [
    new Date(i.pubDate).toLocaleDateString("en-ZA"),
    new Date(i.pubDate).toLocaleTimeString("en-ZA"),
    i.source, i.province,
    `"${(i.title||"").replace(/"/g,'""')}"`,
    i.sentiment, i.category,
    i.flagged?"YES":"NO",
    `"${(i.note||"").replace(/"/g,'""')}"`,
    i.link||""
  ]);
  const csv = [headers,...rows].map(r=>r.join(",")).join("\n");
  const blob = new Blob([csv],{type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=`VoterWatch-${topic}-${new Date().toISOString().split("T")[0]}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function exportWeeklyReport(items, brief, topic) {
  const date = new Date().toLocaleDateString("en-ZA",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const flagged = items.filter(i=>i.flagged);
  const positive = items.filter(i=>i.sentiment==="positive").length;
  const sentPct = items.length>0?Math.round((positive/items.length)*100):0;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>VoterWatch SA Weekly Report</title>
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;color:#1a1a2e;line-height:1.6}.header{background:#1B3A6B;color:white;padding:32px;border-radius:8px;margin-bottom:24px}.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}.stat{background:#f5f7fa;border-radius:8px;padding:16px;text-align:center}.stat-val{font-size:28px;font-weight:700;color:#007B77}.stat-label{font-size:11px;color:#64748B;text-transform:uppercase}h2{color:#1B3A6B;border-bottom:2px solid #007B77;padding-bottom:6px;margin-top:32px}.article{padding:12px;border-left:3px solid #007B77;margin-bottom:10px;background:#f9fafb;border-radius:0 6px 6px 0}.brief{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:20px;white-space:pre-wrap;font-size:13px;line-height:1.8}.footer{margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center}</style></head>
<body><div class="header"><h1>🗳️ VoterWatch SA — Weekly Report</h1><p>Topic: ${topic} · ${date} · Elections: 4 November 2026</p></div>
<div class="stat-row"><div class="stat"><div class="stat-val">${items.length}</div><div class="stat-label">Articles</div></div><div class="stat"><div class="stat-val">${sentPct}%</div><div class="stat-label">Positive</div></div><div class="stat"><div class="stat-val">${flagged.length}</div><div class="stat-label">Flagged</div></div><div class="stat"><div class="stat-val">${[...new Set(items.map(i=>i.province))].length}</div><div class="stat-label">Provinces</div></div></div>
${brief?`<h2>AI Brief</h2><div class="brief">${brief}</div>`:""}
${flagged.length>0?`<h2>🚨 Critical Flags</h2>${flagged.map(i=>`<div class="article"><strong>${i.source}</strong> · ${i.province}<br/>${i.title}${i.note?`<br/><em>Note: ${i.note}</em>`:""}</div>`).join("")}`:""}
<h2>All Articles</h2>${items.map(i=>`<div class="article">${i.source} · ${i.province} · ${new Date(i.pubDate).toLocaleDateString("en-ZA")}<br/>${i.link?`<a href="${i.link}">${i.title}</a>`:i.title}${i.note?`<br/><em>Note: ${i.note}</em>`:""}</div>`).join("")}
<div class="footer">VoterWatch SA · Confidential · ${date}</div></body></html>`;
  const blob = new Blob([html],{type:"text/html"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=`VoterWatch-Report-${new Date().toISOString().split("T")[0]}.html`;
  a.click(); URL.revokeObjectURL(url);
}

function SentimentChart({ items }) {
  const counts = {positive:0,neutral:0,negative:0,urgent:0,query:0};
  items.forEach(i=>{if(counts[i.sentiment]!==undefined)counts[i.sentiment]++;});
  const total = items.length||1;
  return (
    <div>
      <div style={{fontSize:"11px",color:"#64748B",marginBottom:"10px",textTransform:"uppercase",letterSpacing:"0.8px"}}>SENTIMENT BREAKDOWN</div>
      {Object.entries(counts).filter(([,v])=>v>0).map(([key,val])=>(
        <div key={key} style={{marginBottom:"8px"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:"3px"}}>
            <span style={{fontSize:"11px",color:"#94A3B8",textTransform:"capitalize"}}>{key}</span>
            <span style={{fontSize:"11px",color:sentimentColor(key),fontWeight:600}}>{val} ({Math.round((val/total)*100)}%)</span>
          </div>
          <div style={{background:"rgba(255,255,255,0.06)",borderRadius:"4px",height:"5px",overflow:"hidden"}}>
            <div style={{width:`${(val/total)*100}%`,height:"100%",background:sentimentColor(key),borderRadius:"4px"}}/>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProvinceChart({ items }) {
  const counts = {};
  items.forEach(i=>{counts[i.province]=(counts[i.province]||0)+1;});
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const max = sorted[0]?.[1]||1;
  const colors = ["#00C896","#00A8E8","#FFB800","#FF6B6B","#A78BFA","#F97316"];
  return (
    <div>
      <div style={{fontSize:"11px",color:"#64748B",marginBottom:"10px",textTransform:"uppercase",letterSpacing:"0.8px"}}>MENTIONS BY PROVINCE</div>
      {sorted.map(([province,count],i)=>(
        <div key={province} style={{marginBottom:"8px"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:"3px"}}>
            <span style={{fontSize:"11px",color:"#94A3B8"}}>{province}</span>
            <span style={{fontSize:"11px",color:colors[i],fontWeight:600}}>{count}</span>
          </div>
          <div style={{background:"rgba(255,255,255,0.06)",borderRadius:"4px",height:"5px",overflow:"hidden"}}>
            <div style={{width:`${(count/max)*100}%`,height:"100%",background:colors[i],borderRadius:"4px"}}/>
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendSparkline({ data }) {
  const max = Math.max(...data.map(d=>d.count),1);
  return (
    <div>
      <div style={{fontSize:"11px",color:"#64748B",marginBottom:"10px",textTransform:"uppercase",letterSpacing:"0.8px"}}>ARTICLE VOLUME TREND</div>
      <div style={{display:"flex",alignItems:"flex-end",gap:"4px",height:"50px"}}>
        {data.map((d,i)=>(
          <div key={i} style={{flex:1}}>
            <div style={{width:"100%",height:`${Math.max((d.count/max)*42,4)}px`,background:`rgba(0,200,150,${0.3+(d.count/max)*0.7})`,borderRadius:"2px 2px 0 0"}}/>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── HISTORICAL SEARCH — uses regular Google filtered to SA news sites ──
function HistoricalSearch({ apiKey }) {
  const [period, setPeriod] = useState(ELECTION_PERIODS[1]);
  const [query, setQuery] = useState("voter registration IEC");
  const [analysisResult, setAnalysisResult] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const openGoogleSearch = () => {
    // Regular Google search filtered to SA news sites + date range
    const fullQuery = `${query} South Africa ${SA_NEWS_SITES}`;
    const url = `https://www.google.com/search?q=${encodeURIComponent(fullQuery)}&tbs=cdr:1,cd_min:${period.startDate},cd_max:${period.endDate}`;
    window.open(url, "_blank");
    setSearched(true);
  };

  const generateComparison = async () => {
    setAnalysisLoading(true);
    setAnalysisResult("");
    try {
      const prompt = `You are an election monitoring analyst for VoterWatch SA.

Generate a detailed comparative analysis for:
SEARCH: "${query}"
ELECTION PERIOD: ${period.label} — ${period.description}
DATE RANGE: ${period.startDate} to ${period.endDate}

Based on your knowledge of South African elections and media during this period, provide:

PERIOD OVERVIEW
What was the voter registration and civic engagement landscape like during this election?

KEY MEDIA THEMES
What topics dominated SA news coverage around this topic in this period?

REGISTRATION AND TURNOUT DATA
What do we know about registration rates and voter participation in this cycle?

NOTABLE EVENTS
What specific events, controversies, or milestones shaped this election period?

COMPARISON TO 2026
How does this period compare to the current 2026 municipal campaign? What patterns are repeating?

WHAT TO WATCH
What lessons from this period should VoterWatch SA apply to 2026 monitoring?

Be specific. Reference real SA election data, IEC statistics, and documented media coverage where possible.`;
      const result = await callGemini(apiKey, prompt);
      setAnalysisResult(result);
    } catch(err) {
      setAnalysisResult(`Analysis failed: ${err.message}`);
    }
    setAnalysisLoading(false);
  };

  const inp = {background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#E2E8F0",borderRadius:"8px",padding:"8px 12px",fontSize:"13px",outline:"none",width:"100%",fontFamily:"'DM Sans',sans-serif"};

  return (
    <div style={{padding:"16px"}}>
      <div style={{marginBottom:"14px",padding:"10px 12px",background:"rgba(0,168,232,0.08)",border:"1px solid rgba(0,168,232,0.2)",borderRadius:"8px",fontSize:"12px",color:"#64748B",lineHeight:1.7}}>
        🏛️ <strong style={{color:"#00A8E8"}}>Historical Election Archive</strong><br/>
        Search SA news coverage from previous elections using regular Google — filtered to News24, Daily Maverick, GroundUp, IOL, EWN, TimesLIVE and more. Results open in a new tab.
      </div>

      {/* Period selector */}
      <div style={{marginBottom:"12px"}}>
        <div style={{fontSize:"11px",color:"#64748B",marginBottom:"6px",textTransform:"uppercase",letterSpacing:"0.5px"}}>Select Election Period</div>
        {ELECTION_PERIODS.map(ep=>(
          <div key={ep.label} onClick={()=>{setPeriod(ep);setSearched(false);setAnalysisResult("");}} style={{padding:"10px 12px",borderRadius:"8px",cursor:"pointer",marginBottom:"5px",border:`1px solid ${period.label===ep.label?"rgba(0,168,232,0.4)":"rgba(255,255,255,0.06)"}`,background:period.label===ep.label?"rgba(0,168,232,0.08)":"rgba(255,255,255,0.02)"}}>
            <div style={{fontSize:"12px",fontWeight:600,color:period.label===ep.label?"#00A8E8":"#CBD5E1"}}>{ep.label}</div>
            <div style={{fontSize:"10px",color:"#475569"}}>{ep.description} · {ep.startDate} → {ep.endDate}</div>
          </div>
        ))}
      </div>

      {/* Keyword input */}
      <div style={{marginBottom:"12px"}}>
        <div style={{fontSize:"11px",color:"#64748B",marginBottom:"6px",textTransform:"uppercase",letterSpacing:"0.5px"}}>Search Keywords</div>
        <input style={inp} value={query} onChange={e=>setQuery(e.target.value)} placeholder="e.g. voter registration IEC" />
        <div style={{fontSize:"10px",color:"#334155",marginTop:"4px"}}>Results will be filtered to SA news sites automatically</div>
      </div>

      {/* Action buttons */}
      <div style={{display:"flex",gap:"8px",marginBottom:"14px",flexWrap:"wrap"}}>
        <button onClick={openGoogleSearch} style={{padding:"8px 14px",borderRadius:"8px",fontSize:"12px",fontWeight:600,cursor:"pointer",border:"none",background:"linear-gradient(135deg,#00A8E8,#1B3A6B)",color:"white"}}>
          🔍 Search SA News Archive
        </button>
        <button onClick={generateComparison} disabled={analysisLoading} style={{padding:"8px 14px",borderRadius:"8px",fontSize:"12px",fontWeight:600,cursor:"pointer",border:"none",background:"linear-gradient(135deg,#00C896,#007B77)",color:"#080E1A"}}>
          {analysisLoading?"⏳ Analysing...":"✨ AI Comparative Analysis"}
        </button>
      </div>

      {/* Search confirmation */}
      {searched&&(
        <div style={{padding:"8px 12px",background:"rgba(0,200,150,0.06)",border:"1px solid rgba(0,200,150,0.15)",borderRadius:"8px",marginBottom:"12px",fontSize:"11px",color:"#94A3B8"}}>
          ✅ Google opened in a new tab — results filtered to SA news sites for <strong style={{color:"#00C896"}}>"{query}"</strong> during <strong style={{color:"#00C896"}}>{period.label}</strong>.<br/>
          <span style={{color:"#475569"}}>Tip: If results are thin, try broader keywords like "election IEC" or "voters roll".</span>
        </div>
      )}

      {/* AI Analysis */}
      {analysisLoading&&(
        <div style={{textAlign:"center",padding:"24px",color:"#475569",fontSize:"12px"}}>
          <div style={{fontSize:"20px",animation:"pulse 1s infinite",marginBottom:"8px"}}>✨</div>
          Gemini is analysing the {period.label} election period…
        </div>
      )}
      {analysisResult&&(
        <div style={{fontSize:"12px",color:"#94A3B8",lineHeight:1.8,whiteSpace:"pre-wrap",background:"rgba(255,255,255,0.02)",padding:"14px",borderRadius:"8px",border:"1px solid rgba(255,255,255,0.06)"}}>
          {analysisResult}
        </div>
      )}
    </div>
  );
}

function KeywordManager({ keywords, onSave }) {
  const [local, setLocal] = useState(keywords.join(", "));
  return (
    <div style={{padding:"12px 20px",display:"flex",gap:"10px",alignItems:"flex-start",flexWrap:"wrap"}}>
      <div style={{flex:1,minWidth:"240px"}}>
        <div style={{fontSize:"11px",color:"#64748B",marginBottom:"6px"}}>Edit tracked keywords (comma separated):</div>
        <textarea value={local} onChange={e=>setLocal(e.target.value)} rows={2} style={{width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#E2E8F0",borderRadius:"6px",padding:"7px",fontSize:"11px",fontFamily:"'DM Sans',sans-serif",outline:"none",resize:"none",boxSizing:"border-box"}}/>
      </div>
      <div style={{display:"flex",gap:"6px",paddingTop:"20px"}}>
        <button onClick={()=>onSave(local.split(",").map(k=>k.trim()).filter(Boolean))} style={{padding:"7px 12px",borderRadius:"7px",fontSize:"11px",fontWeight:600,cursor:"pointer",border:"none",background:"linear-gradient(135deg,#00C896,#00A8E8)",color:"#080E1A"}}>Save</button>
        <button onClick={()=>setLocal(keywords.join(", "))} style={{padding:"7px 12px",borderRadius:"7px",fontSize:"11px",cursor:"pointer",border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"#64748B"}}>Reset</button>
      </div>
    </div>
  );
}

// ── MAIN APP ──
export default function VoterWatchV4() {
  const [activeTopic, setActiveTopic] = useState(TOPICS[0]);
  const [feedItems, setFeedItems] = useState([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [liveCount, setLiveCount] = useState(0);
  const [selectedProvince, setSelectedProvince] = useState("All Provinces");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSentiment, setFilterSentiment] = useState("All");
  const [filterSource, setFilterSource] = useState("All");
  const [selectedItem, setSelectedItem] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [articleSummaries, setArticleSummaries] = useState({});
  const [summarisingId, setSummarisingId] = useState(null);
  const [activeTab, setActiveTab] = useState("feed");
  const [trendData, setTrendData] = useState([]);
  const [notes, setNotes] = useState({});
  const [flags, setFlags] = useState({});
  const [editingNote, setEditingNote] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [customKeywords, setCustomKeywords] = useState(null);
  const [showKeywords, setShowKeywords] = useState(false);
  const refreshTimer = useRef(null);
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";

  const fetchFeed = useCallback(async (topicKey, kw) => {
    try {
      setFeedLoading(true);
      setFeedError(null);
      let url = `/api/feed?topic=${topicKey}`;
      if (kw && kw.length > 0) url += `&keywords=${encodeURIComponent(kw.join(","))}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      const enriched = (data.items||[]).map(item => ({...item, flagged:flags[item.id]||false, note:notes[item.id]||""}));
      setFeedItems(enriched);
      setLiveCount(data.liveCount||0);
      setLastFetched(new Date());
      setTrendData(prev=>[...prev,{count:data.items?.length||0}].slice(-10));
    } catch(err) {
      setFeedError(err.message);
    } finally {
      setFeedLoading(false);
    }
  }, [flags, notes]);

  useEffect(()=>{
    clearInterval(refreshTimer.current);
    fetchFeed(activeTopic.key, customKeywords);
    refreshTimer.current = setInterval(()=>fetchFeed(activeTopic.key, customKeywords), 5*60*1000);
    return ()=>clearInterval(refreshTimer.current);
  }, [activeTopic, customKeywords]);

  const switchTopic = (topic) => { setActiveTopic(topic); setActiveTab("feed"); setAiSummary(""); setSelectedProvince("All Provinces"); setSearchQuery(""); setTrendData([]); setSelectedItem(null); setAiAnalysis(""); };
  const toggleFlag = (id) => { setFlags(prev=>({...prev,[id]:!prev[id]})); setFeedItems(prev=>prev.map(i=>i.id===id?{...i,flagged:!i.flagged}:i)); };
  const saveNote = (id) => { setNotes(prev=>({...prev,[id]:noteText})); setFeedItems(prev=>prev.map(i=>i.id===id?{...i,note:noteText}:i)); setEditingNote(null); };

  // 100-word article summary
  const summariseArticle = useCallback(async (item) => {
    if (articleSummaries[item.id]) return;
    setSummarisingId(item.id);
    try {
      const prompt = `Summarise this South African news article in 100 words or less. Be factual and concise. Focus on the key facts relevant to voter registration or civic participation.\n\nHEADLINE: "${item.title}"\n${item.description?`EXCERPT: "${item.description}"`:""}\nSOURCE: ${item.source}, ${item.province}`;
      const result = await callGemini(apiKey, prompt);
      setArticleSummaries(prev=>({...prev,[item.id]:result}));
    } catch(err) {
      setArticleSummaries(prev=>({...prev,[item.id]:`Summary unavailable: ${err.message}`}));
    }
    setSummarisingId(null);
  }, [apiKey, articleSummaries]);

  const analyzeItem = useCallback(async (item) => {
    setSelectedItem(item);
    setAiAnalysis("");
    setAiLoading(true);
    // Also trigger 100-word summary
    summariseArticle(item);
    try {
      const prompt = `${activeTopic.aiContext}\n\nAnalyse this article from ${item.source} in ${item.province}:\n\nHEADLINE: "${item.title}"\n${item.description?`EXCERPT: "${item.description}"\n`:""}\nSENTIMENT: ${item.sentiment} | CATEGORY: ${item.category}${item.note?`\nTEAM NOTE: ${item.note}`:""}\n\nSUMMARY: (one sentence)\n\nKEY IMPLICATIONS:\n• (implication 1)\n• (implication 2)\n\nRECOMMENDED ACTION: (one concrete action)`;
      const result = await callGemini(apiKey, prompt);
      setAiAnalysis(result);
    } catch(err) { setAiAnalysis(`Analysis unavailable: ${err.message}`); }
    setAiLoading(false);
  }, [apiKey, activeTopic, summariseArticle]);

  const generateBrief = useCallback(async () => {
    setSummaryLoading(true); setAiSummary(""); setActiveTab("brief");
    try {
      const flaggedItems = feedItems.filter(i=>i.flagged);
      const headlines = feedItems.slice(0,15).map(i=>`- [${i.province}] ${i.title} (${i.sentiment})${i.flagged?" [FLAGGED]":""}`).join("\n");
      const positive = feedItems.filter(i=>i.sentiment==="positive").length;
      const negative = feedItems.filter(i=>i.sentiment==="negative").length;
      const sentPct = feedItems.length>0?Math.round((positive/feedItems.length)*100):0;
      const daysLeft = Math.ceil((new Date("2026-11-04")-new Date())/(1000*60*60*24));
      const prompt = `${activeTopic.aiContext}\n\nGenerate a daily monitoring brief.\nTopic: ${activeTopic.label}\nDate: ${new Date().toLocaleDateString("en-ZA",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}\nDays to election (4 Nov 2026): ${daysLeft}\n\nTracked (${feedItems.length} live articles):\n${headlines}\n\nSTATS: ${positive} positive | ${negative} negative | ${sentPct}% positive${flaggedItems.length>0?`\n\nFLAGGED CRITICAL:\n${flaggedItems.map(i=>`- ${i.title} [${i.province}]`).join("\n")}`:""}\n\nEXECUTIVE SUMMARY\nTOP TRENDS BY PROVINCE\nCRITICAL FLAGS\nKEY CONCERNS\nRECOMMENDED ACTIONS FOR TODAY`;
      const result = await callGemini(apiKey, prompt);
      setAiSummary(result);
    } catch(err) { setAiSummary(`Brief failed: ${err.message}`); }
    setSummaryLoading(false);
  }, [apiKey, activeTopic, feedItems]);

  const sources = ["All",...new Set(feedItems.map(i=>i.source))];
  const filteredFeed = feedItems.filter(item => {
    const matchProvince = selectedProvince==="All Provinces"||item.province===selectedProvince;
    const matchSentiment = filterSentiment==="All"||item.sentiment===filterSentiment;
    const matchSource = filterSource==="All"||item.source===filterSource;
    const matchSearch = !searchQuery||item.title.toLowerCase().includes(searchQuery.toLowerCase())||item.province.toLowerCase().includes(searchQuery.toLowerCase());
    return matchProvince&&matchSentiment&&matchSource&&matchSearch;
  });

  const flaggedItems = feedItems.filter(i=>i.flagged);
  const positive = feedItems.filter(i=>i.sentiment==="positive").length;
  const negative = feedItems.filter(i=>i.sentiment==="negative").length;
  const sentPct = feedItems.length>0?Math.round((positive/feedItems.length)*100):0;
  const daysToElection = Math.ceil((new Date("2026-11-04")-new Date())/(1000*60*60*24));

  const s = {
    app:{minHeight:"100vh",background:"#080E1A",fontFamily:"'DM Sans',sans-serif",color:"#E2E8F0"},
    header:{borderBottom:"1px solid rgba(255,255,255,0.06)",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(0,0,0,0.4)",position:"sticky",top:0,zIndex:100,gap:"10px",flexWrap:"wrap"},
    topicBar:{background:"rgba(0,0,0,0.3)",borderBottom:"1px solid rgba(255,255,255,0.06)",padding:"0 20px",display:"flex",gap:"0",overflowX:"auto"},
    topicBtn:(active,color)=>({padding:"11px 16px",fontSize:"12px",fontWeight:active?700:400,color:active?color:"#475569",background:"transparent",border:"none",borderBottom:active?`2px solid ${color}`:"2px solid transparent",cursor:"pointer",whiteSpace:"nowrap"}),
    main:{padding:"16px 20px",maxWidth:"1400px",margin:"0 auto"},
    statsRow:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px",marginBottom:"16px"},
    statCard:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"10px",padding:"14px"},
    grid:{display:"grid",gridTemplateColumns:"1fr 310px",gap:"14px",alignItems:"start"},
    card:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"10px",overflow:"hidden"},
    tabRow:{display:"flex",gap:"3px",padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,0.06)",flexWrap:"wrap",alignItems:"center"},
    tab:(a)=>({padding:"5px 10px",borderRadius:"6px",fontSize:"11px",fontWeight:a?600:400,background:a?"rgba(0,200,150,0.15)":"transparent",color:a?"#00C896":"#64748B",border:a?"1px solid rgba(0,200,150,0.3)":"1px solid transparent",cursor:"pointer"}),
    input:{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#E2E8F0",borderRadius:"6px",padding:"5px 10px",fontSize:"12px",outline:"none",fontFamily:"'DM Sans',sans-serif"},
    select:{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#CBD5E1",borderRadius:"6px",padding:"5px 8px",fontSize:"11px",cursor:"pointer",outline:"none"},
    feedItem:(sel)=>({padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.04)",background:sel?"rgba(0,200,150,0.06)":"transparent",borderLeft:sel?`2px solid ${activeTopic.color}`:"2px solid transparent"}),
    badge:(color)=>({fontSize:"9px",padding:"2px 6px",borderRadius:"4px",background:`${color}20`,color,fontWeight:600}),
    liveBadge:{fontSize:"9px",padding:"2px 6px",borderRadius:"4px",background:"rgba(0,200,150,0.15)",color:"#00C896",fontWeight:700,border:"1px solid rgba(0,200,150,0.3)"},
    flagBadge:{fontSize:"9px",padding:"2px 6px",borderRadius:"4px",background:"rgba(255,107,107,0.15)",color:"#FF6B6B",fontWeight:700},
    ghostBtn:{padding:"4px 8px",borderRadius:"5px",fontSize:"10px",cursor:"pointer",border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"#64748B"},
    placeholder:{padding:"28px",textAlign:"center",color:"#475569",fontSize:"12px"},
  };

  if (!apiKey||apiKey==="your_gemini_key_here") {
    return (
      <div style={{...s.app,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{textAlign:"center",padding:"40px",maxWidth:"480px"}}>
          <div style={{fontSize:"48px",marginBottom:"16px"}}>🗝️</div>
          <div style={{fontSize:"18px",fontWeight:700,color:"#F1F5F9",marginBottom:"12px"}}>Gemini API Key Required</div>
          <div style={{fontSize:"13px",color:"#64748B",lineHeight:1.8,background:"rgba(255,255,255,0.04)",borderRadius:"10px",padding:"20px",textAlign:"left"}}>
            1. Go to <strong style={{color:"#00A8E8"}}>aistudio.google.com</strong><br/>
            2. Sign in → <strong style={{color:"#00C896"}}>"Get API Key"</strong><br/>
            3. Add to Vercel as <code style={{background:"rgba(255,255,255,0.1)",padding:"2px 6px",borderRadius:"4px"}}>VITE_GEMINI_API_KEY</code><br/>
            4. Redeploy
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
        button:hover{opacity:0.85} a{color:#00A8E8;text-decoration:none} a:hover{text-decoration:underline}
        input::placeholder{color:#475569} textarea::placeholder{color:#475569}
        @media(max-width:768px){.main-grid{grid-template-columns:1fr !important}.stats-row{grid-template-columns:repeat(2,1fr) !important}.right-panel{display:none}}
      `}</style>

      {/* Header */}
      <div style={s.header}>
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <div style={{width:"34px",height:"34px",background:`linear-gradient(135deg,${activeTopic.color},#00A8E8)`,borderRadius:"8px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",flexShrink:0}}>🗳️</div>
          <div>
            <div style={{fontSize:"14px",fontWeight:700,color:"#F1F5F9"}}>VoterWatch SA</div>
            <div style={{fontSize:"10px",color:"#64748B"}}>
              {liveCount>0&&<span style={{color:activeTopic.color}}>{liveCount} live · </span>}
              <span style={{color:"#FFB800"}}>⏳ {daysToElection} days to election</span>
            </div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"7px",flexWrap:"wrap"}}>
          <input style={{...s.input,width:"150px"}} placeholder="🔍 Search..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/>
          <select style={s.select} value={selectedProvince} onChange={e=>setSelectedProvince(e.target.value)}>
            {PROVINCES.map(p=><option key={p}>{p}</option>)}
          </select>
          <select style={s.select} value={filterSentiment} onChange={e=>setFilterSentiment(e.target.value)}>
            {["All","positive","neutral","negative","urgent","query"].map(v=><option key={v} value={v}>{v==="All"?"All Sentiment":v}</option>)}
          </select>
          <select style={s.select} value={filterSource} onChange={e=>setFilterSource(e.target.value)}>
            {sources.map(v=><option key={v}>{v==="All"?"All Sources":v}</option>)}
          </select>
          <button style={s.ghostBtn} onClick={()=>fetchFeed(activeTopic.key,customKeywords)} disabled={feedLoading}>{feedLoading?"⏳":"🔄"}</button>
          <div style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",color:"#64748B"}}>
            <div style={{width:"6px",height:"6px",borderRadius:"50%",background:feedLoading?"#FFB800":"#00C896",animation:"pulse 2s infinite"}}/>
            {lastFetched?lastFetched.toLocaleTimeString("en-ZA",{hour:"2-digit",minute:"2-digit"}):"..."}
          </div>
        </div>
      </div>

      {/* Topic bar */}
      <div style={s.topicBar}>
        {TOPICS.map(topic=>(
          <button key={topic.key} style={s.topicBtn(activeTopic.key===topic.key,topic.color)} onClick={()=>switchTopic(topic)}>{topic.label}</button>
        ))}
        <button style={{...s.topicBtn(false,"#A78BFA"),marginLeft:"auto"}} onClick={()=>setShowKeywords(!showKeywords)}>⚙️ Keywords</button>
      </div>

      {showKeywords&&(
        <div style={{background:"rgba(0,0,0,0.4)",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
          <KeywordManager
            keywords={customKeywords||(activeTopic.key==="voter"?["voter registration","IEC","electoral commission","polling station","municipal election","ward","ballot","voters roll"]:["national youth day","youth day","june 16","IEC","young voters","youth vote","NYDA"])}
            onSave={(kw)=>{setCustomKeywords(kw);setShowKeywords(false);fetchFeed(activeTopic.key,kw);}}
          />
        </div>
      )}

      <div style={s.main}>
        {/* Stats */}
        <div style={s.statsRow} className="stats-row">
          {[
            {label:"Live Articles",value:feedItems.length,change:`${liveCount} from SA news`,color:activeTopic.color},
            {label:"Positive Sentiment",value:`${sentPct}%`,change:`${positive} positive`,color:"#00A8E8"},
            {label:"Critical Flags",value:flaggedItems.length,change:"Requires attention",color:"#FF6B6B"},
            {label:"Days to Election",value:daysToElection,change:"4 November 2026",color:"#FFB800"},
          ].map((stat,i)=>(
            <div key={i} style={s.statCard}>
              <div style={{fontSize:"10px",color:"#64748B",textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:"6px"}}>{stat.label}</div>
              <div style={{fontSize:"26px",fontWeight:700,color:stat.color,letterSpacing:"-1px",lineHeight:1}}>{feedLoading?"—":stat.value}</div>
              <div style={{fontSize:"10px",color:stat.color+"99",marginTop:"3px"}}>{stat.change}</div>
            </div>
          ))}
        </div>

        {feedError&&<div style={{padding:"8px 12px",background:"rgba(255,107,107,0.1)",border:"1px solid rgba(255,107,107,0.2)",borderRadius:"8px",marginBottom:"12px",fontSize:"11px",color:"#FF6B6B"}}>⚠️ {feedError}</div>}
        {flaggedItems.length>0&&<div style={{padding:"8px 14px",background:"rgba(255,107,107,0.08)",border:"1px solid rgba(255,107,107,0.2)",borderRadius:"8px",marginBottom:"12px",fontSize:"11px",color:"#FF6B6B"}}>🚨 <strong>{flaggedItems.length} critical flag{flaggedItems.length>1?"s":""}</strong> — {flaggedItems.map(i=>i.province).join(", ")}</div>}

        <div style={s.grid} className="main-grid">
          <div style={s.card}>
            <div style={s.tabRow}>
              {[{key:"feed",label:"📡 Feed"},{key:"brief",label:"📋 Brief"},{key:"charts",label:"📈 Charts"},{key:"history",label:"🏛️ History"},{key:"export",label:"📤 Export"}].map(tab=>(
                <button key={tab.key} style={s.tab(activeTab===tab.key)} onClick={()=>setActiveTab(tab.key)}>{tab.label}</button>
              ))}
              {activeTab==="brief"&&<button onClick={generateBrief} disabled={summaryLoading||feedItems.length===0} style={{marginLeft:"auto",padding:"5px 12px",borderRadius:"7px",fontSize:"11px",fontWeight:600,cursor:"pointer",border:"none",background:`linear-gradient(135deg,${activeTopic.color},#00A8E8)`,color:"#080E1A"}}>{summaryLoading?"⏳ Generating...":"✨ Generate Brief"}</button>}
            </div>

            {/* FEED */}
            {activeTab==="feed"&&(
              <div style={{maxHeight:"580px",overflowY:"auto"}}>
                {feedLoading&&<div style={s.placeholder}><div style={{fontSize:"20px",animation:"pulse 1s infinite",marginBottom:"8px"}}>📡</div>Fetching live articles…</div>}
                {!feedLoading&&feedItems.length===0&&(
                  <div style={{...s.placeholder,padding:"40px"}}>
                    <div style={{fontSize:"32px",marginBottom:"10px"}}>📭</div>
                    <div style={{color:"#64748B",marginBottom:"6px"}}>No articles found right now</div>
                    <div style={{fontSize:"11px",color:"#334155",lineHeight:1.7}}>
                      This means SA news sites haven't published content matching your keywords in the last few days.<br/><br/>
                      Try clicking 🔄 Refresh, adjusting keywords via ⚙️ Keywords, or check back later.
                    </div>
                  </div>
                )}
                {!feedLoading&&feedItems.length>0&&filteredFeed.length===0&&<div style={s.placeholder}><div style={{fontSize:"20px",marginBottom:"8px"}}>🔍</div>No articles match your filters.</div>}
                {!feedLoading&&filteredFeed.map(item=>(
                  <div key={item.id} style={s.feedItem(selectedItem?.id===item.id)}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:"6px"}}>
                      <div style={{flex:1,cursor:"pointer"}} onClick={()=>analyzeItem(item)}>
                        <div style={{display:"flex",alignItems:"center",gap:"5px",marginBottom:"4px",flexWrap:"wrap"}}>
                          <span>{categoryIcon(item.category)}</span>
                          <span style={s.badge(sentimentColor(item.sentiment))}>{item.sentiment}</span>
                          <span style={{fontSize:"10px",color:"#00A8E8",fontWeight:500}}>{item.source}</span>
                          <span style={s.liveBadge}>LIVE</span>
                          {item.flagged&&<span style={s.flagBadge}>🚨 FLAGGED</span>}
                          <span style={{fontSize:"10px",color:"#334155",marginLeft:"auto"}}>{new Date(item.pubDate).toLocaleDateString("en-ZA")} · {item.time}</span>
                        </div>
                        {/* Clickable headline opens article in new tab */}
                        <div style={{fontSize:"12px",lineHeight:1.4,marginBottom:"3px"}}>
                          {item.link
                            ? <a href={item.link} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{color:"#E2E8F0",fontWeight:500}}>{item.title} ↗</a>
                            : <span style={{color:"#E2E8F0"}}>{item.title}</span>}
                        </div>
                        <div style={{fontSize:"10px",color:"#475569",marginBottom:"3px"}}>{item.province}</div>
                        {item.note&&<div style={{fontSize:"10px",color:"#64748B",fontStyle:"italic"}}>📝 {item.note}</div>}
                        {/* 100-word summary */}
                        {articleSummaries[item.id]&&(
                          <div style={{marginTop:"6px",padding:"7px 9px",background:"rgba(0,200,150,0.05)",border:"1px solid rgba(0,200,150,0.12)",borderRadius:"5px",fontSize:"11px",color:"#94A3B8",lineHeight:1.6}}>
                            <span style={{fontSize:"9px",color:"#00C896",fontWeight:700,display:"block",marginBottom:"3px"}}>AI SUMMARY (100 words)</span>
                            {articleSummaries[item.id]}
                          </div>
                        )}
                        {summarisingId===item.id&&<div style={{fontSize:"10px",color:"#475569",marginTop:"4px",animation:"pulse 1s infinite"}}>✨ Summarising…</div>}
                      </div>
                      {/* Action buttons */}
                      <div style={{display:"flex",flexDirection:"column",gap:"4px",flexShrink:0}}>
                        <button onClick={()=>toggleFlag(item.id)} style={{...s.ghostBtn,color:item.flagged?"#FF6B6B":"#64748B",borderColor:item.flagged?"rgba(255,107,107,0.3)":"rgba(255,255,255,0.1)"}} title="Flag critical">🚨</button>
                        <button onClick={()=>{setEditingNote(item.id);setNoteText(item.note||"");}} style={s.ghostBtn} title="Add note">📝</button>
                        <button onClick={()=>summariseArticle(item)} style={s.ghostBtn} title="Summarise article" disabled={!!articleSummaries[item.id]||summarisingId===item.id}>✨</button>
                      </div>
                    </div>
                    {editingNote===item.id&&(
                      <div style={{marginTop:"6px",padding:"8px",background:"rgba(255,255,255,0.03)",borderRadius:"6px"}}>
                        <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Add a note..." rows={2} style={{width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#E2E8F0",borderRadius:"5px",padding:"6px",fontSize:"11px",fontFamily:"'DM Sans',sans-serif",outline:"none",resize:"none",boxSizing:"border-box"}}/>
                        <div style={{display:"flex",gap:"6px",marginTop:"5px"}}>
                          <button onClick={()=>saveNote(item.id)} style={{padding:"4px 10px",borderRadius:"5px",fontSize:"10px",fontWeight:600,cursor:"pointer",border:"none",background:"linear-gradient(135deg,#00C896,#00A8E8)",color:"#080E1A"}}>Save</button>
                          <button onClick={()=>setEditingNote(null)} style={{...s.ghostBtn,fontSize:"10px"}}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* BRIEF */}
            {activeTab==="brief"&&(
              <div style={{maxHeight:"580px",overflowY:"auto"}}>
                {!aiSummary&&!summaryLoading&&<div style={{...s.placeholder,padding:"48px"}}><div style={{fontSize:"28px",marginBottom:"10px"}}>📋</div>Click "Generate Brief" for today's AI monitoring summary<br/><span style={{color:"#334155",fontSize:"11px"}}>Based on {feedItems.length} live articles</span></div>}
                {summaryLoading&&<div style={{...s.placeholder,padding:"48px"}}><div style={{fontSize:"20px",animation:"pulse 1.5s infinite",marginBottom:"8px"}}>✨</div>Analysing {feedItems.length} articles…</div>}
                {aiSummary&&<div style={{fontSize:"12px",color:"#94A3B8",lineHeight:1.9,whiteSpace:"pre-wrap",padding:"16px"}}>{aiSummary}</div>}
              </div>
            )}

            {/* CHARTS */}
            {activeTab==="charts"&&(
              <div style={{maxHeight:"580px",overflowY:"auto",padding:"16px",display:"flex",flexDirection:"column",gap:"20px"}}>
                {feedItems.length===0?<div style={s.placeholder}>No data yet — fetch live articles first</div>:<>
                  <TrendSparkline data={trendData}/>
                  <SentimentChart items={feedItems}/>
                  <ProvinceChart items={feedItems}/>
                </>}
              </div>
            )}

            {/* HISTORY */}
            {activeTab==="history"&&(
              <div style={{maxHeight:"580px",overflowY:"auto"}}>
                <HistoricalSearch apiKey={apiKey}/>
              </div>
            )}

            {/* EXPORT */}
            {activeTab==="export"&&(
              <div style={{padding:"16px",display:"flex",flexDirection:"column",gap:"10px"}}>
                <div style={{fontSize:"12px",color:"#64748B",lineHeight:1.7,marginBottom:"4px"}}>Export current articles and reports. All exports include date stamps, sentiment, flags, and notes.</div>
                {[
                  {icon:"📊",label:"Export to CSV (Spreadsheet)",desc:"All articles — opens in Excel or Google Sheets",action:()=>exportCSV(feedItems,activeTopic.label),disabled:feedItems.length===0},
                  {icon:"📄",label:"Export Weekly Report",desc:"Formatted HTML report — email to funders or IEC",action:()=>exportWeeklyReport(feedItems,aiSummary,activeTopic.label),disabled:feedItems.length===0},
                  {icon:"🚨",label:"Export Critical Flags Only",desc:`${flaggedItems.length} flagged item${flaggedItems.length!==1?"s":""} — escalation report`,action:()=>exportCSV(flaggedItems,"Critical-Flags"),disabled:flaggedItems.length===0},
                ].map((btn,i)=>(
                  <button key={i} onClick={btn.action} disabled={btn.disabled} style={{display:"flex",alignItems:"center",gap:"12px",padding:"12px 14px",borderRadius:"10px",cursor:btn.disabled?"not-allowed":"pointer",border:"1px solid rgba(255,255,255,0.07)",background:btn.disabled?"rgba(255,255,255,0.02)":"rgba(255,255,255,0.04)",textAlign:"left",width:"100%",opacity:btn.disabled?0.5:1}}>
                    <div style={{fontSize:"20px"}}>{btn.icon}</div>
                    <div>
                      <div style={{fontSize:"12px",fontWeight:600,color:"#E2E8F0",marginBottom:"2px"}}>{btn.label}</div>
                      <div style={{fontSize:"11px",color:"#64748B"}}>{btn.desc}</div>
                    </div>
                  </button>
                ))}
                <div style={{padding:"10px 12px",background:"rgba(0,200,150,0.06)",border:"1px solid rgba(0,200,150,0.15)",borderRadius:"8px",fontSize:"11px",color:"#64748B",lineHeight:1.7,marginTop:"4px"}}>
                  💡 <strong style={{color:"#00C896"}}>Archive tip:</strong> Export to CSV daily and save to a Google Drive folder named by date (e.g. <em>2026-06-16</em>) to build your complete archive through to 4 November 2026.
                </div>
              </div>
            )}
          </div>

          {/* Right panel */}
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}} className="right-panel">
            <div style={s.card}>
              <div style={{padding:"12px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:"12px",fontWeight:600,color:"#CBD5E1"}}>✨ AI Analysis</div>
                <div style={{fontSize:"9px",color:"#475569"}}>Click any article</div>
              </div>
              <div style={{padding:"12px 14px"}}>
                {!selectedItem&&!aiLoading&&<div style={{...s.placeholder,padding:"28px 0"}}><div style={{fontSize:"24px",marginBottom:"8px"}}>👆</div>Click any article for analysis + summary</div>}
                {selectedItem&&<div style={{fontSize:"10px",color:"#64748B",marginBottom:"8px",padding:"6px 8px",background:"rgba(255,255,255,0.03)",borderRadius:"6px"}}><strong style={{color:"#CBD5E1"}}>{selectedItem.source}</strong><br/>{selectedItem.province} · <span style={{color:sentimentColor(selectedItem.sentiment)}}>{selectedItem.sentiment}</span></div>}
                {aiLoading&&<div style={{...s.placeholder,padding:"20px 0"}}><div style={{animation:"pulse 1s infinite",fontSize:"18px"}}>🔍</div><div style={{marginTop:"6px",fontSize:"11px"}}>Analysing…</div></div>}
                {aiAnalysis&&!aiLoading&&<div style={{fontSize:"11px",color:"#94A3B8",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{aiAnalysis}</div>}
              </div>
            </div>

            <div style={s.card}>
              <div style={{padding:"12px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}><div style={{fontSize:"12px",fontWeight:600,color:"#CBD5E1"}}>🗺️ Province Pulse</div></div>
              <div style={{padding:"10px 14px"}}>
                {(()=>{
                  const counts={};
                  feedItems.forEach(i=>{counts[i.province]=(counts[i.province]||0)+1;});
                  const colors=["#00C896","#00A8E8","#FFB800","#FF6B6B","#A78BFA","#F97316","#22d3ee","#818cf8","#34d399"];
                  return PROVINCES.slice(1).map((p,i)=>(
                    <div key={p} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                      <span style={{fontSize:"11px",color:"#94A3B8"}}>{p}</span>
                      <span style={{fontSize:"10px",color:counts[p]>0?colors[i%colors.length]:"#334155",fontWeight:600}}>{feedLoading?"—":counts[p]>0?`${counts[p]}`:"—"}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

            <div style={s.card}>
              <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}><div style={{fontSize:"12px",fontWeight:600,color:"#CBD5E1"}}>📅 Countdown</div></div>
              <div style={{padding:"12px 14px",textAlign:"center"}}>
                <div style={{fontSize:"36px",fontWeight:700,color:"#FFB800",letterSpacing:"-2px"}}>{daysToElection}</div>
                <div style={{fontSize:"11px",color:"#64748B",marginBottom:"10px"}}>days to 4 November 2026</div>
                <div style={{background:"rgba(255,255,255,0.04)",borderRadius:"6px",height:"6px",overflow:"hidden",marginBottom:"6px"}}>
                  <div style={{width:`${Math.min(100,Math.round((1-(daysToElection/365))*100))}%`,height:"100%",background:"linear-gradient(90deg,#00C896,#FFB800)",borderRadius:"6px"}}/>
                </div>
                <div style={{fontSize:"10px",color:"#334155"}}>Campaign progress</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
