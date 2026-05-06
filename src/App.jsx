import { useState, useEffect, useRef } from "react";

// ═══════════════════════════════════════════════════════════════
// DE OBSERVA — THE HIDDEN WEAPON
// Replace these with your actual keys
// ═══════════════════════════════════════════════════════════════
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_KEY;
const RAPIDAPI_KEY   = import.meta.env.VITE_RAPIDAPI_KEY;
// ═══════════════════════════════════════════════════════════════

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// ── FETCH LIVE TEAM STATS FROM API-FOOTBALL ──────────────────
const fetchLiveStats = async (home, away, league) => {
  try {
    const headers = {
      "x-rapidapi-key": RAPIDAPI_KEY,
      "x-rapidapi-host": "api-football-v1.p.rapidapi.com"
    };

    // Search for home team
    const homeRes = await fetch(
      `https://api-football-v1.p.rapidapi.com/v3/teams?search=${encodeURIComponent(home)}`,
      { headers }
    );
    const homeData = await homeRes.json();
    const homeTeam = homeData.response?.[0];

    // Search for away team
    const awayRes = await fetch(
      `https://api-football-v1.p.rapidapi.com/v3/teams?search=${encodeURIComponent(away)}`,
      { headers }
    );
    const awayData = await awayRes.json();
    const awayTeam = awayData.response?.[0];

    if (!homeTeam || !awayTeam) return null;

    const currentYear = new Date().getFullYear();
    const season = currentYear;

    // Get home team statistics
    const homeStatsRes = await fetch(
      `https://api-football-v1.p.rapidapi.com/v3/teams/statistics?team=${homeTeam.team.id}&season=${season}`,
      { headers }
    );
    const homeStats = await homeStatsRes.json();

    // Get away team statistics
    const awayStatsRes = await fetch(
      `https://api-football-v1.p.rapidapi.com/v3/teams/statistics?team=${awayTeam.team.id}&season=${season}`,
      { headers }
    );
    const awayStats = await awayStatsRes.json();

    // Get H2H
    const h2hRes = await fetch(
      `https://api-football-v1.p.rapidapi.com/v3/fixtures/headtohead?h2h=${homeTeam.team.id}-${awayTeam.team.id}&last=10`,
      { headers }
    );
    const h2hData = await h2hRes.json();

    return {
      homeTeam: homeTeam.team,
      awayTeam: awayTeam.team,
      homeStats: homeStats.response,
      awayStats: awayStats.response,
      h2h: h2hData.response
    };
  } catch (err) {
    return null;
  }
};

// ── SUMMARISE LIVE DATA FOR PROMPT ────────────────────────────
const summariseLiveData = (data) => {
  if (!data) return "No live data retrieved. Use training knowledge only.";

  try {
    const hs = data.homeStats;
    const as = data.awayStats;
    const h2h = data.h2h || [];

    const homeGoalsFor = hs?.goals?.for?.average?.total || "unknown";
    const homeGoalsAg = hs?.goals?.against?.average?.total || "unknown";
    const awayGoalsFor = as?.goals?.for?.average?.total || "unknown";
    const awayGoalsAg = as?.goals?.against?.average?.total || "unknown";
    const homeWins = hs?.fixtures?.wins?.total || 0;
    const homeDraws = hs?.fixtures?.draws?.total || 0;
    const homeLoss = hs?.fixtures?.loses?.total || 0;
    const awayWins = as?.fixtures?.wins?.total || 0;
    const awayDraws = as?.fixtures?.draws?.total || 0;
    const awayLoss = as?.fixtures?.loses?.total || 0;
    const homeClean = hs?.clean_sheet?.total || 0;
    const awayClean = as?.clean_sheet?.total || 0;
    const homeFailedScore = hs?.failed_to_score?.total || 0;
    const awayFailedScore = as?.failed_to_score?.total || 0;

    // H2H summary
    let h2hSummary = "No H2H data";
    if (h2h.length > 0) {
      const h2hGoals = h2h.map(f => (f.goals?.home || 0) + (f.goals?.away || 0));
      const avgH2H = h2hGoals.reduce((a, b) => a + b, 0) / h2hGoals.length;
      const over25count = h2hGoals.filter(g => g > 2).length;
      h2hSummary = `Last ${h2h.length} H2H: avg ${avgH2H.toFixed(1)} goals, ${over25count} of ${h2h.length} went Over 2.5`;
    }

    return `
LIVE DATA FROM API-FOOTBALL:
Home Team (${data.homeTeam?.name}):
- Avg Goals Scored: ${homeGoalsFor} per game
- Avg Goals Conceded: ${homeGoalsAg} per game  
- Season Record: ${homeWins}W ${homeDraws}D ${homeLoss}L
- Clean Sheets: ${homeClean}
- Failed To Score: ${homeFailedScore}

Away Team (${data.awayTeam?.name}):
- Avg Goals Scored: ${awayGoalsFor} per game
- Avg Goals Conceded: ${awayGoalsAg} per game
- Season Record: ${awayWins}W ${awayDraws}D ${awayLoss}L
- Clean Sheets: ${awayClean}
- Failed To Score: ${awayFailedScore}

Head to Head: ${h2hSummary}

Combined ATG estimate: ${(parseFloat(homeGoalsFor) + parseFloat(awayGoalsAg)).toFixed(1)} (home attack + away defense)
    `.trim();
  } catch {
    return "Live data parsing failed. Use training knowledge.";
  }
};

// ── ANALYSIS PROMPT ──────────────────────────────────────────
const ANALYSIS_PROMPT = (home, away, league, liveData) => `
You are De Observa — a ruthlessly unbiased football analyst.

STEP 1 — VALIDATE:
Are "${home}", "${away}", and "${league}" real football entities?
If not, return: {"inputValid":false,"invalidReason":"explanation"}

STEP 2 — LIVE DATA PROVIDED:
${liveData}

Use this live data as your primary source. Fill gaps with training knowledge.
Label each data point as "live" or "estimated".

STEP 3 — ARGUE UNDER CASE FIRST:
List genuine Under 2.5 signals for this specific match:
- Low combined ATG below 2.5?
- High clean sheet rates above 30 percent?
- Defensive league baseline? La Liga 50 percent Under, Serie A 55 percent Under, Ligue 1 52 percent Under
- High stakes cautious match?
- Away team sitting deep?
- Failed to score rate high?
- Evening match with tactical setup?
Count your Under signals: [NUMBER]

STEP 4 — ARGUE OVER CASE:
List genuine Over 2.5 signals for this specific match:
- High combined ATG above 2.8?
- Both teams scoring above 1.4 per game?
- Leaky defenses conceding above 1.3?
- High scoring league? Bundesliga 75 percent Over, Eredivisie 78 percent Over, MLS 72 percent Over
- Open attacking matchup?
- High scoring H2H history?
Count your Over signals: [NUMBER]

STEP 5 — VERDICT RULES:
- If Under signals greater than or equal to Over signals: UNDER
- If Over signals exceed Under by 2 or more AND combined ATG above 2.7: OVER
- If mixed or ATG between 2.3 and 2.7: SKIP
- NEVER default to OVER when uncertain

STEP 6 — OUTPUT ONLY THIS JSON. Nothing before or after. No backticks.
No apostrophes in string values. Plain English only.

{
  "inputValid": true,
  "invalidReason": "",
  "match": {
    "homeTeam": "full name",
    "awayTeam": "full name",
    "league": "league name",
    "matchDate": "if known else Unknown",
    "competitionStage": "league match or cup or Unknown"
  },
  "dataQuality": {
    "webSearchUsed": false,
    "liveDataPoints": 0,
    "estimatedDataPoints": 9,
    "overallDataConfidence": "High",
    "dataSourceSummary": "brief source description"
  },
  "verdict": "UNDER",
  "confidence": 6,
  "confidenceLabel": "Medium",
  "recommendation": "one clear sentence",
  "fairOdds": "2.10",
  "valueExists": false,
  "indicators": {
    "aligned": 5,
    "total": 9,
    "overSignals": 2,
    "underSignals": 5
  },
  "layers": {
    "coreMetrics": {
      "homeAvgScored": "x.x per game",
      "homeAvgConceded": "x.x per game",
      "awayAvgScored": "x.x per game",
      "awayAvgConceded": "x.x per game",
      "combinedATG": "x.x goals",
      "over25HitRateHome": "xx percent",
      "over25HitRateAway": "xx percent",
      "bttsRateHome": "xx percent",
      "bttsRateAway": "xx percent",
      "cleanSheetHome": "xx percent",
      "cleanSheetAway": "xx percent",
      "dataSource": "live",
      "signal": "NEUTRAL"
    },
    "xgAnalysis": {
      "homeXG": "x.x per game",
      "homeXGA": "x.x per game",
      "awayXG": "x.x per game",
      "awayXGA": "x.x per game",
      "homeXGStatus": "On track",
      "awayXGStatus": "On track",
      "insight": "specific insight for this matchup",
      "dataSource": "estimated",
      "signal": "NEUTRAL"
    },
    "poissonModel": {
      "homeLambda": "x.x",
      "awayLambda": "x.x",
      "underProbability": "xx percent",
      "overProbability": "xx percent",
      "impliedBookmakerUnder": "xx percent",
      "keyScorelines": "1-0, 0-1, 1-1",
      "insight": "Poisson insight for this match",
      "signal": "NEUTRAL"
    },
    "homeAwaySplit": {
      "homeTeamHomeGPG": "x.x at home",
      "awayTeamAwayGPG": "x.x away",
      "homeTeamHomeOver25": "xx percent",
      "awayTeamAwayOver25": "xx percent",
      "combinedPercent": "xx percent",
      "dataSource": "live",
      "signal": "NEUTRAL"
    },
    "tactical": {
      "homeStyle": "specific style",
      "awayStyle": "specific style",
      "styleMatchup": "matchup description",
      "managerImpact": "manager tendencies",
      "dataSource": "estimated",
      "signal": "NEUTRAL"
    },
    "bttsRule": {
      "bttsLikely": false,
      "bttsPercent": "xx percent",
      "insight": "BTTS reasoning",
      "signal": "NEUTRAL"
    },
    "leagueTrend": {
      "leagueOver25Rate": "xx percent",
      "leagueStyle": "league description",
      "leagueAvgGoals": "x.x per game",
      "insight": "league trend insight",
      "signal": "NEUTRAL"
    },
    "redFlags": {
      "flags": [],
      "injuryImpact": "injury context",
      "stakeLevel": "Low",
      "rotationRisk": "Low",
      "weatherRisk": "Low",
      "signal": "NEUTRAL"
    },
    "recentForm": {
      "homeLast5": "W D L W D",
      "awayLast5": "L W D L W",
      "homeGoalsScoredLast5": "x goals",
      "homeGoalsConcededLast5": "x goals",
      "awayGoalsScoredLast5": "x goals",
      "awayGoalsConcededLast5": "x goals",
      "homeOver25Last5": "x of last 5",
      "awayOver25Last5": "x of last 5",
      "dataSource": "live",
      "signal": "NEUTRAL"
    }
  },
  "checklist": {
    "atgCalculated": true,
    "over25HitRateChecked": true,
    "xgReviewed": true,
    "homeAwaySplitUsed": true,
    "bttsAssessed": true,
    "cleanSheetChecked": true,
    "h2hReviewed": true,
    "fairOddsCalculated": true,
    "poissonRun": true,
    "injuriesChecked": true,
    "stylesAssessed": true,
    "leagueTrendFactored": true,
    "stakesConsidered": true,
    "weatherChecked": true,
    "rotationAssessed": true,
    "marketMovementObserved": false,
    "threeIndicatorsAligned": true,
    "valueConfirmed": false
  },
  "h2hInsight": "H2H context",
  "keyInsight": "most decisive factor",
  "liveNewsFound": "live data summary"
}
`;

// ── JSON PARSER ───────────────────────────────────────────────
const parseJSON = (text) => {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    let s = text.slice(start, end + 1);
    s = s.replace(/[\x00-\x1F\x7F]/g, " ").replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(s);
  } catch { return null; }
};

// ── MAIN API CALL ─────────────────────────────────────────────
const runAnalysis = async (home, away, league, setStatus) => {
  setStatus("Fetching live stats...");
  const liveData = await fetchLiveStats(home, away, league);
  const liveSummary = summariseLiveData(liveData);

  setStatus("Running 9-layer framework...");
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: ANALYSIS_PROMPT(home, away, league, liveSummary) }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "AI error");
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = parseJSON(text);
  if (!parsed) throw new Error("Could not read response. Please try again.");
  if (parsed.inputValid === false) throw new Error(parsed.invalidReason || "Invalid inputs.");
  return { result: parsed, liveUsed: !!liveData };
};

// ── BET TRACKER ───────────────────────────────────────────────
const STORAGE_KEY = "de_observa_bets";
const loadBets = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
};
const saveBets = (bets) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bets)); } catch {}
};

// ── COMPONENTS ────────────────────────────────────────────────
const Dots = () => {
  const [n, setN] = useState(0);
  useEffect(() => { const t = setInterval(() => setN(x => (x+1)%4), 350); return () => clearInterval(t); }, []);
  return <span style={{display:"inline-block",width:18,letterSpacing:2}}>{".".repeat(n)}</span>;
};

const Logo = () => (
  <div style={{display:"flex",alignItems:"center",gap:12}}>
    <div style={{
      width:44,height:44,borderRadius:10,
      background:"linear-gradient(135deg,#0f0f0f,#1a1a1a)",
      border:"1.5px solid rgba(255,200,0,0.3)",
      display:"flex",alignItems:"center",justifyContent:"center",
      fontSize:22,fontWeight:900,color:"#ffc800",
      boxShadow:"0 0 20px rgba(255,200,0,0.15)",
      fontFamily:"Georgia,serif"
    }}>D</div>
    <div>
      <div style={{fontSize:22,fontWeight:900,color:"#fff",letterSpacing:"0.05em",fontFamily:"Georgia,serif"}}>
        DE <span style={{color:"#ffc800"}}>OBSERVA</span>
      </div>
      <div style={{fontSize:9,color:"#555",letterSpacing:"0.3em",fontWeight:700}}>INTELLIGENCE · ANALYSIS · EDGE</div>
    </div>
  </div>
);

const VerdictColors = {
  OVER:  {main:"#ffc800",bg:"rgba(255,200,0,0.08)",border:"rgba(255,200,0,0.3)",glow:"rgba(255,200,0,0.2)"},
  UNDER: {main:"#00d4aa",bg:"rgba(0,212,170,0.08)",border:"rgba(0,212,170,0.3)",glow:"rgba(0,212,170,0.2)"},
  SKIP:  {main:"#ff6b35",bg:"rgba(255,107,53,0.08)",border:"rgba(255,107,53,0.3)",glow:"rgba(255,107,53,0.2)"}
};

const SigC = {OVER:"#ffc800",UNDER:"#00d4aa",NEUTRAL:"#555"};
const SigB = {OVER:"rgba(255,200,0,0.12)",UNDER:"rgba(0,212,170,0.12)",NEUTRAL:"rgba(255,255,255,0.05)"};

const Tag = ({s}) => (
  <span style={{background:SigB[s]||SigB.NEUTRAL,color:SigC[s]||SigC.NEUTRAL,border:`1px solid ${SigC[s]||SigC.NEUTRAL}`,borderRadius:4,padding:"2px 8px",fontSize:10,fontWeight:800,letterSpacing:"0.15em"}}>{s||"NEUTRAL"}</span>
);

const Row = ({label,val,accent}) => (
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
    <span style={{fontSize:12,color:"#555",fontWeight:600}}>{label}</span>
    <span style={{fontSize:12,fontWeight:800,color:accent?"#ffc800":"#ccc"}}>{val||"—"}</span>
  </div>
);

const Card = ({title,icon,signal,children}) => (
  <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:16,marginBottom:12}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:16}}>{icon}</span>
        <span style={{fontSize:11,fontWeight:900,color:"#ccc",letterSpacing:"0.12em",textTransform:"uppercase"}}>{title}</span>
      </div>
      <Tag s={signal}/>
    </div>
    <div style={{borderTop:"1px solid rgba(255,255,255,0.04)",paddingTop:10}}>{children}</div>
  </div>
);

const Tick = ({done,label}) => (
  <div style={{display:"flex",alignItems:"center",gap:10,padding:"3px 0"}}>
    <div style={{width:18,height:18,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,background:done?"rgba(255,200,0,0.2)":"rgba(255,255,255,0.04)",border:done?"1px solid #ffc800":"1px solid rgba(255,255,255,0.08)"}}>
      {done && <span style={{color:"#ffc800",fontSize:11,fontWeight:900}}>✓</span>}
    </div>
    <span style={{fontSize:12,color:done?"#ccc":"#333"}}>{label}</span>
  </div>
);

// ── MAIN APP ──────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("analyze"); // analyze | tracker
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [league, setLeague] = useState("");
  const [phase, setPhase] = useState("idle");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [liveUsed, setLiveUsed] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [bets, setBets] = useState(loadBets());
  const [betOutcome, setBetOutcome] = useState("");
  const [betSaved, setBetSaved] = useState(false);

  const vc = VerdictColors[result?.verdict] || VerdictColors.OVER;

  const run = async () => {
    if (!home.trim() || !away.trim() || !league.trim()) { setError("Fill in all three fields."); return; }
    setError(""); setResult(null); setTab("overview"); setPhase("analyzing"); setBetSaved(false);
    try {
      const { result: r, liveUsed: lu } = await runAnalysis(home, away, league, setStatus);
      setResult(r); setLiveUsed(lu); setPhase("done");
    } catch(e) {
      setPhase("error"); setError(e.message || "Analysis failed. Try again.");
    }
  };

  const saveBet = () => {
    if (!result || !betOutcome) return;
    const newBet = {
      id: Date.now(),
      date: new Date().toLocaleDateString(),
      home: result.match?.homeTeam,
      away: result.match?.awayTeam,
      league: result.match?.league,
      prediction: result.verdict,
      confidence: result.confidence,
      outcome: betOutcome,
      won: result.verdict === betOutcome
    };
    const updated = [newBet, ...bets];
    setBets(updated);
    saveBets(updated);
    setBetSaved(true);
    setBetOutcome("");
  };

  const deleteBet = (id) => {
    const updated = bets.filter(b => b.id !== id);
    setBets(updated);
    saveBets(updated);
  };

  const wins = bets.filter(b => b.won).length;
  const total = bets.length;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
  const highConf = bets.filter(b => b.confidence >= 7);
  const highConfWins = highConf.filter(b => b.won).length;
  const highConfRate = highConf.length > 0 ? Math.round((highConfWins / highConf.length) * 100) : 0;

  const inputStyle = {
    width:"100%",boxSizing:"border-box",
    background:"rgba(255,255,255,0.04)",
    border:"1px solid rgba(255,255,255,0.1)",
    borderRadius:10,padding:"12px 14px",
    fontSize:14,fontWeight:600,color:"#fff",
    outline:"none",fontFamily:"inherit",
    transition:"border-color 0.2s"
  };

  const TABS = ["overview","deep","form","checklist"];

  return (
    <div style={{background:"#080808",minHeight:"100vh",fontFamily:"'Courier New',monospace",color:"#fff"}}>
      {/* Subtle grid */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",opacity:0.02,
        backgroundImage:"linear-gradient(rgba(255,200,0,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,200,0,1) 1px,transparent 1px)",
        backgroundSize:"32px 32px"}}/>

      <div style={{maxWidth:560,margin:"0 auto",padding:"24px 16px 60px",position:"relative"}}>

        {/* ── HEADER ── */}
        <div style={{marginBottom:28}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <Logo/>
            <div style={{display:"flex",gap:6}}>
              {["analyze","tracker"].map(s => (
                <button key={s} onClick={() => setScreen(s)} style={{
                  padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",
                  fontFamily:"inherit",fontWeight:800,fontSize:10,letterSpacing:"0.15em",textTransform:"uppercase",
                  background:screen===s?"#ffc800":"rgba(255,255,255,0.06)",
                  color:screen===s?"#000":"#555",transition:"all 0.2s"
                }}>{s==="analyze"?"⚡ Analyze":"📊 Tracker"}</button>
              ))}
            </div>
          </div>
          <div style={{marginTop:10,height:1,background:"linear-gradient(90deg,rgba(255,200,0,0.3),transparent)"}}/>
        </div>

        {/* ══════════════════════════════════════════ */}
        {/* ANALYZE SCREEN */}
        {/* ══════════════════════════════════════════ */}
        {screen === "analyze" && (
          <div>
            {/* Input Card */}
            <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,200,0,0.15)",borderRadius:16,padding:20,marginBottom:16}}>
              <div style={{fontSize:10,color:"#ffc800",letterSpacing:"0.3em",fontWeight:800,marginBottom:16}}>MATCH INPUT</div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                {[{label:"HOME TEAM",val:home,set:setHome,ph:"e.g. Arsenal"},
                  {label:"AWAY TEAM",val:away,set:setAway,ph:"e.g. Chelsea"}].map(({label,val,set,ph}) => (
                  <div key={label}>
                    <div style={{fontSize:9,color:"#444",letterSpacing:"0.25em",fontWeight:800,marginBottom:6}}>{label}</div>
                    <input value={val} onChange={e=>set(e.target.value)} placeholder={ph}
                      onKeyDown={e=>e.key==="Enter"&&run()} style={inputStyle}
                      onFocus={e=>e.target.style.borderColor="rgba(255,200,0,0.5)"}
                      onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.1)"}/>
                  </div>
                ))}
              </div>

              <div style={{marginBottom:12}}>
                <div style={{fontSize:9,color:"#444",letterSpacing:"0.25em",fontWeight:800,marginBottom:6}}>LEAGUE / COMPETITION</div>
                <input value={league} onChange={e=>setLeague(e.target.value)}
                  placeholder="e.g. Premier League, La Liga, Champions League..."
                  onKeyDown={e=>e.key==="Enter"&&run()} style={inputStyle}
                  onFocus={e=>e.target.style.borderColor="rgba(255,200,0,0.5)"}
                  onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.1)"}/>
              </div>

              {/* Live data badge */}
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"rgba(0,212,170,0.06)",borderRadius:8,marginBottom:12,border:"1px solid rgba(0,212,170,0.15)"}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:"#00d4aa",animation:"pulse 2s infinite"}}/>
                <span style={{fontSize:11,color:"#00d4aa",fontWeight:700}}>Live data enabled · API-Football connected</span>
              </div>

              {error && (
                <div style={{background:"rgba(255,50,50,0.08)",border:"1px solid rgba(255,50,50,0.25)",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#ff6b6b",fontWeight:700,marginBottom:12}}>
                  ⚠ {error}
                </div>
              )}

              <button onClick={run} disabled={phase==="analyzing"} style={{
                width:"100%",padding:"14px",borderRadius:12,border:"none",
                cursor:phase==="analyzing"?"not-allowed":"pointer",
                fontFamily:"inherit",fontWeight:900,fontSize:13,letterSpacing:"0.2em",textTransform:"uppercase",
                background:phase==="analyzing"?"rgba(255,255,255,0.04)":"#ffc800",
                color:phase==="analyzing"?"#333":"#000",
                boxShadow:phase==="analyzing"?"none":"0 0 24px rgba(255,200,0,0.3)",
                transition:"all 0.2s"
              }}>
                {phase==="analyzing" ? <span>{status||"Analyzing"}<Dots/></span> : "⚡ RUN ANALYSIS"}
              </button>
            </div>

            {/* Loading */}
            {phase==="analyzing" && (
              <div style={{background:"rgba(255,200,0,0.04)",border:"1px solid rgba(255,200,0,0.12)",borderRadius:14,padding:16,marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:36,height:36,borderRadius:8,background:"rgba(255,200,0,0.12)",border:"1px solid rgba(255,200,0,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>⚡</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:"#ffc800",marginBottom:3}}>{status||"Running analysis"}</div>
                    <div style={{fontSize:11,color:"#444"}}>Live data · 9 layers · Poisson model · Debate check</div>
                  </div>
                </div>
              </div>
            )}

            {/* Results */}
            {result && phase==="done" && (() => {
              const l = result.layers;
              const chk = result.checklist;
              const gatePassed = chk?.threeIndicatorsAligned && chk?.valueConfirmed;

              return (
                <div>
                  {/* Live data strip */}
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",background:"rgba(0,0,0,0.4)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,marginBottom:14,flexWrap:"wrap"}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:liveUsed?"#00d4aa":"#555",flexShrink:0}}/>
                    <span style={{fontSize:11,color:"#555",flex:1}}>{result.dataQuality?.dataSourceSummary}</span>
                    <span style={{fontSize:10,color:liveUsed?"#00d4aa":"#555",fontWeight:700}}>{liveUsed?"📡 LIVE":"🧠 ESTIMATED"}</span>
                  </div>

                  {/* Verdict Card */}
                  <div style={{background:vc.bg,border:`1.5px solid ${vc.border}`,borderRadius:18,padding:20,marginBottom:16,boxShadow:`0 0 40px ${vc.glow}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                      <div>
                        <div style={{fontSize:10,color:"#555",letterSpacing:"0.2em",fontWeight:700,marginBottom:6}}>{result.match?.league}</div>
                        <div style={{fontSize:16,fontWeight:900,color:"#fff",lineHeight:1.4}}>
                          {result.match?.homeTeam}
                          <span style={{color:"#333",fontWeight:400,fontSize:13}}> vs </span>
                          {result.match?.awayTeam}
                        </div>
                        {result.match?.competitionStage && result.match.competitionStage !== "Unknown" && (
                          <div style={{fontSize:10,color:"#444",marginTop:4}}>{result.match.competitionStage}</div>
                        )}
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontSize:44,fontWeight:900,color:vc.main,lineHeight:1,filter:`drop-shadow(0 0 14px ${vc.main})`}}>{result.verdict}</div>
                        <div style={{fontSize:10,color:"#444",letterSpacing:"0.2em",marginTop:2}}>2.5 GOALS</div>
                      </div>
                    </div>

                    {/* Confidence */}
                    <div style={{marginBottom:16}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                        <span style={{fontSize:12,color:"#555"}}>Confidence</span>
                        <span style={{fontSize:12,color:"#fff",fontWeight:900}}>{result.confidence}/10 · {result.confidenceLabel}
                          {result.confidence >= 7 && <span style={{color:"#ffc800",marginLeft:6}}>★ HIGH</span>}
                        </span>
                      </div>
                      <div style={{height:6,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${(result.confidence/10)*100}%`,background:`linear-gradient(90deg,#333,${vc.main})`,borderRadius:99,transition:"width 0.8s"}}/>
                      </div>
                    </div>

                    {/* Stats row */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
                      {[
                        {label:"SIGNALS",val:`${result.indicators?.aligned}/${result.indicators?.total}`,color:vc.main},
                        {label:"OVER ▲",val:result.indicators?.overSignals,color:"#ffc800"},
                        {label:"UNDER ▼",val:result.indicators?.underSignals,color:"#00d4aa"},
                        {label:"VALUE",val:result.valueExists?"YES":"NO",color:result.valueExists?"#ffc800":"#333"}
                      ].map(m => (
                        <div key={m.label} style={{background:"rgba(0,0,0,0.3)",borderRadius:10,padding:"10px 4px",textAlign:"center"}}>
                          <div style={{fontSize:18,fontWeight:900,color:m.color}}>{m.val}</div>
                          <div style={{fontSize:8,color:"#333",marginTop:3,letterSpacing:"0.1em"}}>{m.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Recommendation */}
                    <div style={{background:"rgba(0,0,0,0.25)",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
                      <div style={{fontSize:9,color:"#444",letterSpacing:"0.2em",fontWeight:800,marginBottom:6}}>RECOMMENDATION</div>
                      <div style={{fontSize:13,color:"#fff",fontWeight:800,lineHeight:1.6}}>{result.recommendation}</div>
                    </div>

                    {/* Key insight + Fair odds */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <div style={{background:"rgba(0,0,0,0.25)",borderRadius:10,padding:"12px 14px"}}>
                        <div style={{fontSize:9,color:"#444",letterSpacing:"0.2em",fontWeight:800,marginBottom:6}}>KEY INSIGHT</div>
                        <div style={{fontSize:12,color:"#ccc",fontWeight:600,lineHeight:1.5}}>{result.keyInsight}</div>
                      </div>
                      <div style={{background:"rgba(0,0,0,0.25)",borderRadius:10,padding:"12px 14px"}}>
                        <div style={{fontSize:9,color:"#444",letterSpacing:"0.2em",fontWeight:800,marginBottom:6}}>FAIR ODDS</div>
                        <div style={{fontSize:28,fontWeight:900,color:"#fff"}}>{result.fairOdds}</div>
                        <div style={{fontSize:11,color:result.valueExists?"#ffc800":"#333",fontWeight:700}}>
                          {result.valueExists?"◈ Value exists":"No value"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Save to Tracker */}
                  {!betSaved && (
                    <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:16,marginBottom:16}}>
                      <div style={{fontSize:10,color:"#555",letterSpacing:"0.2em",fontWeight:800,marginBottom:12}}>SAVE TO TRACKER</div>
                      <div style={{display:"flex",gap:8,marginBottom:10}}>
                        {["OVER","UNDER","SKIP"].map(o => (
                          <button key={o} onClick={() => setBetOutcome(o)} style={{
                            flex:1,padding:"10px",borderRadius:8,border:"none",cursor:"pointer",
                            fontFamily:"inherit",fontWeight:900,fontSize:11,letterSpacing:"0.1em",
                            background:betOutcome===o?(o==="OVER"?"#ffc800":o==="UNDER"?"#00d4aa":"#ff6b35"):"rgba(255,255,255,0.04)",
                            color:betOutcome===o?"#000":"#444",transition:"all 0.2s"
                          }}>
                            {o === "OVER" ? "✓ OVER" : o === "UNDER" ? "✓ UNDER" : "— SKIP"}
                          </button>
                        ))}
                      </div>
                      <div style={{fontSize:10,color:"#333",marginBottom:10}}>Select the actual result after the match plays</div>
                      <button onClick={saveBet} disabled={!betOutcome} style={{
                        width:"100%",padding:"10px",borderRadius:8,border:"none",cursor:betOutcome?"pointer":"not-allowed",
                        fontFamily:"inherit",fontWeight:800,fontSize:11,letterSpacing:"0.15em",
                        background:betOutcome?"rgba(255,200,0,0.15)":"rgba(255,255,255,0.02)",
                        color:betOutcome?"#ffc800":"#333",transition:"all 0.2s"
                      }}>SAVE PREDICTION</button>
                    </div>
                  )}
                  {betSaved && (
                    <div style={{background:"rgba(0,212,170,0.06)",border:"1px solid rgba(0,212,170,0.2)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#00d4aa",fontWeight:700}}>
                      ✓ Saved to tracker
                    </div>
                  )}

                  {/* Tabs */}
                  <div style={{display:"flex",gap:4,background:"rgba(0,0,0,0.4)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:4,marginBottom:14}}>
                    {TABS.map(t => (
                      <button key={t} onClick={() => setTab(t)} style={{
                        flex:1,padding:"8px 4px",borderRadius:8,border:"none",cursor:"pointer",
                        fontFamily:"inherit",fontWeight:900,fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",
                        background:tab===t?"#ffc800":"transparent",
                        color:tab===t?"#000":"#444",transition:"all 0.2s"
                      }}>{t}</button>
                    ))}
                  </div>

                  {/* Overview Tab */}
                  {tab==="overview" && (
                    <div>
                      <Card title="Core Metrics" icon="📊" signal={l?.coreMetrics?.signal}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
                          <Row label="Home Avg Scored" val={l?.coreMetrics?.homeAvgScored}/>
                          <Row label="Away Avg Scored" val={l?.coreMetrics?.awayAvgScored}/>
                          <Row label="Home Avg Conceded" val={l?.coreMetrics?.homeAvgConceded}/>
                          <Row label="Away Avg Conceded" val={l?.coreMetrics?.awayAvgConceded}/>
                        </div>
                        <Row label="Combined ATG" val={l?.coreMetrics?.combinedATG} accent/>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px",marginTop:4}}>
                          <Row label="Over 2.5% Home" val={l?.coreMetrics?.over25HitRateHome}/>
                          <Row label="Over 2.5% Away" val={l?.coreMetrics?.over25HitRateAway}/>
                          <Row label="BTTS% Home" val={l?.coreMetrics?.bttsRateHome}/>
                          <Row label="BTTS% Away" val={l?.coreMetrics?.bttsRateAway}/>
                          <Row label="Clean Sheet Home" val={l?.coreMetrics?.cleanSheetHome}/>
                          <Row label="Clean Sheet Away" val={l?.coreMetrics?.cleanSheetAway}/>
                        </div>
                      </Card>
                      <Card title="BTTS Rule" icon="🔑" signal={l?.bttsRule?.signal}>
                        <Row label="BTTS Likely?" val={l?.bttsRule?.bttsLikely?"YES":"NO"} accent={l?.bttsRule?.bttsLikely}/>
                        <Row label="Combined BTTS%" val={l?.bttsRule?.bttsPercent}/>
                        <p style={{fontSize:12,color:"#555",lineHeight:1.6,marginTop:8}}>{l?.bttsRule?.insight}</p>
                      </Card>
                      <Card title="League Trend" icon="📈" signal={l?.leagueTrend?.signal}>
                        <Row label="League Over 2.5 Rate" val={l?.leagueTrend?.leagueOver25Rate} accent/>
                        <Row label="Avg Goals Per Game" val={l?.leagueTrend?.leagueAvgGoals}/>
                        <Row label="League Style" val={l?.leagueTrend?.leagueStyle}/>
                        <p style={{fontSize:12,color:"#555",lineHeight:1.6,marginTop:8}}>{l?.leagueTrend?.insight}</p>
                      </Card>
                      {l?.redFlags?.flags?.length > 0 && (
                        <Card title="Red Flags" icon="🚨" signal={l?.redFlags?.signal}>
                          {l.redFlags.flags.map((f,i) => (
                            <div key={i} style={{display:"flex",gap:8,padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                              <span style={{color:"#ff6b35",flexShrink:0}}>⚠</span>
                              <span style={{fontSize:12,color:"#ccc"}}>{f}</span>
                            </div>
                          ))}
                        </Card>
                      )}
                    </div>
                  )}

                  {/* Deep Tab */}
                  {tab==="deep" && (
                    <div>
                      <Card title="xG Analysis" icon="🔬" signal={l?.xgAnalysis?.signal}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
                          <Row label="Home xG" val={l?.xgAnalysis?.homeXG}/>
                          <Row label="Away xG" val={l?.xgAnalysis?.awayXG}/>
                          <Row label="Home xGA" val={l?.xgAnalysis?.homeXGA}/>
                          <Row label="Away xGA" val={l?.xgAnalysis?.awayXGA}/>
                          <Row label="Home Status" val={l?.xgAnalysis?.homeXGStatus}/>
                          <Row label="Away Status" val={l?.xgAnalysis?.awayXGStatus}/>
                        </div>
                        <p style={{fontSize:12,color:"#555",lineHeight:1.6,marginTop:8}}>{l?.xgAnalysis?.insight}</p>
                      </Card>
                      <Card title="Poisson Model" icon="🧮" signal={l?.poissonModel?.signal}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
                          <Row label="Home Lambda" val={l?.poissonModel?.homeLambda} accent/>
                          <Row label="Away Lambda" val={l?.poissonModel?.awayLambda} accent/>
                          <Row label="Under Probability" val={l?.poissonModel?.underProbability}/>
                          <Row label="Over Probability" val={l?.poissonModel?.overProbability}/>
                          <Row label="Bookie Implied Under" val={l?.poissonModel?.impliedBookmakerUnder}/>
                        </div>
                        <Row label="Key Scorelines" val={l?.poissonModel?.keyScorelines}/>
                        <p style={{fontSize:12,color:"#555",lineHeight:1.6,marginTop:8}}>{l?.poissonModel?.insight}</p>
                      </Card>
                      <Card title="Home Away Split" icon="🏠" signal={l?.homeAwaySplit?.signal}>
                        <Row label="Home GPG at home" val={l?.homeAwaySplit?.homeTeamHomeGPG}/>
                        <Row label="Away GPG away" val={l?.homeAwaySplit?.awayTeamAwayGPG}/>
                        <Row label="Home Over 2.5 at home" val={l?.homeAwaySplit?.homeTeamHomeOver25}/>
                        <Row label="Away Over 2.5 away" val={l?.homeAwaySplit?.awayTeamAwayOver25}/>
                        <Row label="Combined Percent" val={l?.homeAwaySplit?.combinedPercent} accent/>
                      </Card>
                      <Card title="Tactical Matchup" icon="⚽" signal={l?.tactical?.signal}>
                        <Row label="Home Style" val={l?.tactical?.homeStyle}/>
                        <Row label="Away Style" val={l?.tactical?.awayStyle}/>
                        <Row label="Matchup Type" val={l?.tactical?.styleMatchup}/>
                        <p style={{fontSize:12,color:"#555",lineHeight:1.6,marginTop:8}}>{l?.tactical?.managerImpact}</p>
                      </Card>
                    </div>
                  )}

                  {/* Form Tab */}
                  {tab==="form" && (
                    <div>
                      <Card title="Recent Form" icon="📋" signal={l?.recentForm?.signal}>
                        <div style={{marginBottom:14}}>
                          <div style={{fontSize:9,color:"#ffc800",letterSpacing:"0.2em",fontWeight:800,marginBottom:6}}>{result.match?.homeTeam?.toUpperCase()} LAST 5</div>
                          <div style={{fontSize:18,fontWeight:900,color:"#fff",letterSpacing:"0.2em",marginBottom:8}}>{l?.recentForm?.homeLast5}</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
                            <Row label="Goals Scored" val={l?.recentForm?.homeGoalsScoredLast5}/>
                            <Row label="Goals Conceded" val={l?.recentForm?.homeGoalsConcededLast5}/>
                            <Row label="Over 2.5 in last 5" val={l?.recentForm?.homeOver25Last5} accent/>
                          </div>
                        </div>
                        <div style={{borderTop:"1px solid rgba(255,255,255,0.04)",paddingTop:14}}>
                          <div style={{fontSize:9,color:"#00d4aa",letterSpacing:"0.2em",fontWeight:800,marginBottom:6}}>{result.match?.awayTeam?.toUpperCase()} LAST 5</div>
                          <div style={{fontSize:18,fontWeight:900,color:"#fff",letterSpacing:"0.2em",marginBottom:8}}>{l?.recentForm?.awayLast5}</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
                            <Row label="Goals Scored" val={l?.recentForm?.awayGoalsScoredLast5}/>
                            <Row label="Goals Conceded" val={l?.recentForm?.awayGoalsConcededLast5}/>
                            <Row label="Over 2.5 in last 5" val={l?.recentForm?.awayOver25Last5} accent/>
                          </div>
                        </div>
                      </Card>
                      <Card title="H2H History" icon="🔄" signal="NEUTRAL">
                        <p style={{fontSize:12,color:"#ccc",lineHeight:1.6}}>{result.h2hInsight}</p>
                      </Card>
                      {result.liveNewsFound && (
                        <Card title="Live Data Used" icon="📡" signal="NEUTRAL">
                          <p style={{fontSize:12,color:"#555",lineHeight:1.6}}>{result.liveNewsFound}</p>
                        </Card>
                      )}
                    </div>
                  )}

                  {/* Checklist Tab */}
                  {tab==="checklist" && chk && (
                    <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:18}}>
                      <div style={{fontSize:10,color:"#ffc800",letterSpacing:"0.3em",fontWeight:800,marginBottom:16}}>PRE-MATCH CHECKLIST</div>
                      <div style={{marginBottom:14}}>
                        <div style={{fontSize:9,color:"#333",letterSpacing:"0.2em",fontWeight:800,marginBottom:8}}>STATISTICAL LAYER</div>
                        <Tick done={chk.atgCalculated} label="ATG calculated for both teams"/>
                        <Tick done={chk.over25HitRateChecked} label="Over 2.5 hit rate checked"/>
                        <Tick done={chk.xgReviewed} label="xG and xGA reviewed"/>
                        <Tick done={chk.homeAwaySplitUsed} label="Home Away split used not blended"/>
                        <Tick done={chk.bttsAssessed} label="BTTS percent assessed"/>
                        <Tick done={chk.cleanSheetChecked} label="Clean sheet rates checked"/>
                        <Tick done={chk.h2hReviewed} label="H2H pattern reviewed"/>
                        <Tick done={chk.fairOddsCalculated} label="Fair odds calculated"/>
                        <Tick done={chk.poissonRun} label="Poisson model applied"/>
                      </div>
                      <div style={{marginBottom:14}}>
                        <div style={{fontSize:9,color:"#333",letterSpacing:"0.2em",fontWeight:800,marginBottom:8}}>CONTEXTUAL LAYER</div>
                        <Tick done={chk.injuriesChecked} label="Injuries and suspensions checked"/>
                        <Tick done={chk.stylesAssessed} label="Playing styles assessed"/>
                        <Tick done={chk.leagueTrendFactored} label="League trend factored in"/>
                        <Tick done={chk.stakesConsidered} label="Match stakes considered"/>
                        <Tick done={chk.weatherChecked} label="Weather checked"/>
                        <Tick done={chk.rotationAssessed} label="Rotation risk assessed"/>
                      </div>
                      <div style={{marginBottom:16}}>
                        <div style={{fontSize:9,color:"#333",letterSpacing:"0.2em",fontWeight:800,marginBottom:8}}>DECISION GATE</div>
                        <Tick done={chk.threeIndicatorsAligned} label="3 or more indicators aligned"/>
                        <Tick done={chk.valueConfirmed} label="Value confirmed via fair odds"/>
                      </div>
                      <div style={{borderRadius:12,padding:16,textAlign:"center",
                        background:gatePassed?"rgba(255,200,0,0.08)":"rgba(255,50,50,0.08)",
                        border:`1px solid ${gatePassed?"rgba(255,200,0,0.25)":"rgba(255,50,50,0.25)"}`}}>
                        <div style={{fontSize:16,fontWeight:900,color:gatePassed?"#ffc800":"#ff6b6b",marginBottom:6}}>
                          {gatePassed?"◈ CLEAR TO BET":"⚠ DO NOT BET"}
                        </div>
                        <div style={{fontSize:12,color:"#444"}}>
                          {gatePassed?"All gates passed. Proceed with your stake.":"Conditions not met. Skip this match."}
                        </div>
                      </div>
                    </div>
                  )}

                  <p style={{fontSize:10,color:"#222",textAlign:"center",padding:"14px 0 0",lineHeight:1.6}}>
                    For analytical purposes only. Bet responsibly. 18+
                  </p>
                </div>
              );
            })()}
          </div>
        )}

        {/* ══════════════════════════════════════════ */}
        {/* TRACKER SCREEN */}
        {/* ══════════════════════════════════════════ */}
        {screen === "tracker" && (
          <div>
            {/* Stats summary */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
              {[
                {label:"WIN RATE",val:`${winRate}%`,sub:`${wins}/${total} bets`,color:winRate>=55?"#00d4aa":winRate>=45?"#ffc800":"#ff6b35"},
                {label:"HIGH CONF",val:`${highConfRate}%`,sub:`${highConf.length} bets 7+`,color:"#ffc800"},
                {label:"TOTAL BETS",val:total,sub:"tracked",color:"#555"}
              ].map(s => (
                <div key={s.label} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:14,textAlign:"center"}}>
                  <div style={{fontSize:22,fontWeight:900,color:s.color,marginBottom:4}}>{s.val}</div>
                  <div style={{fontSize:8,color:"#555",letterSpacing:"0.2em",fontWeight:800}}>{s.label}</div>
                  <div style={{fontSize:10,color:"#333",marginTop:2}}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Win rate bar */}
            {total > 0 && (
              <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:14,marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontSize:11,color:"#555",fontWeight:700}}>Overall accuracy</span>
                  <span style={{fontSize:11,color:"#ffc800",fontWeight:900}}>{winRate}%</span>
                </div>
                <div style={{height:8,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${winRate}%`,background:`linear-gradient(90deg,#333,${winRate>=55?"#00d4aa":"#ffc800"})`,borderRadius:99,transition:"width 0.8s"}}/>
                </div>
                <div style={{fontSize:10,color:"#333",marginTop:6}}>
                  {winRate >= 58 ? "🔥 Profitable range — keep going" : winRate >= 50 ? "📈 On track — needs more data" : "📊 Below target — review your selections"}
                </div>
              </div>
            )}

            {/* Bet list */}
            {bets.length === 0 ? (
              <div style={{textAlign:"center",padding:"40px 20px",color:"#333"}}>
                <div style={{fontSize:32,marginBottom:12}}>📊</div>
                <div style={{fontSize:13,fontWeight:700}}>No bets tracked yet</div>
                <div style={{fontSize:11,marginTop:6}}>Analyze a match and save the prediction</div>
              </div>
            ) : (
              <div>
                <div style={{fontSize:10,color:"#444",letterSpacing:"0.25em",fontWeight:800,marginBottom:12}}>PREDICTION LOG</div>
                {bets.map(bet => (
                  <div key={bet.id} style={{
                    background:"rgba(255,255,255,0.02)",
                    border:`1px solid ${bet.won?"rgba(0,212,170,0.2)":"rgba(255,50,50,0.15)"}`,
                    borderRadius:12,padding:14,marginBottom:10,
                    borderLeft:`3px solid ${bet.won?"#00d4aa":"#ff6b35"}`
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:800,color:"#fff"}}>{bet.home} vs {bet.away}</div>
                        <div style={{fontSize:10,color:"#444",marginTop:2}}>{bet.league} · {bet.date}</div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontSize:16,fontWeight:900,color:bet.won?"#00d4aa":"#ff6b35"}}>
                          {bet.won?"✓ WIN":"✗ LOSS"}
                        </div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <span style={{fontSize:10,color:"#555"}}>Predicted:</span>
                      <span style={{fontSize:10,fontWeight:800,color:"#ffc800"}}>{bet.prediction}</span>
                      <span style={{fontSize:10,color:"#333"}}>→</span>
                      <span style={{fontSize:10,color:"#555"}}>Result:</span>
                      <span style={{fontSize:10,fontWeight:800,color:bet.won?"#00d4aa":"#ff6b35"}}>{bet.outcome}</span>
                      <span style={{fontSize:10,color:"#333",marginLeft:"auto"}}>Conf: {bet.confidence}/10</span>
                      <button onClick={() => deleteBet(bet.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#333",fontSize:14,padding:"0 4px"}} title="Delete">×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{textAlign:"center",fontSize:9,color:"#1a1a1a",marginTop:28,letterSpacing:"0.2em"}}>
          DE OBSERVA · INTELLIGENCE ENGINE v1.0 · ZYPHRA TECH © 2026
        </div>
      </div>
    </div>
  );
}
