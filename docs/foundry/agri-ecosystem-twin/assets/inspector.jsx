// inspector.jsx — Right panel: plot inspector with soil cross-section + causal chains.

const { useMemo: useMemoI } = React;

function SoilCrossSection({ plotState, scenarioState, year }) {
  // Render a vertical cross-section: topsoil -> subsoil -> bedrock, with root depth
  // and SOC/microbe overlay. Visualizes the underground.
  const w = 320, h = 220;
  const layers = [
    { y: 0,   h: 50,  color: "#4a3a26", label: "O–A horizon", depth: "0–15cm" },
    { y: 50,  h: 60,  color: "#5a4630", label: "B horizon",   depth: "15–50cm" },
    { y: 110, h: 70,  color: "#6e5638", label: "B/C",         depth: "50–120cm" },
    { y: 180, h: 40,  color: "#3a2f24", label: "bedrock",     depth: "120cm+" },
  ];
  // Root depth scales with carbon
  const rootDepth = 50 + Math.min(120, (scenarioState.carbon - 1.4) * 40);
  const microbeDensity = Math.min(1, scenarioState.microbe / 100);
  return (
    <div className="cross-section">
      <div className="xs-header">
        <span className="xs-title">SOIL PROFILE</span>
        <span className="xs-meta">cross-section · 2.4m wide</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="xs-svg">
        <defs>
          <pattern id="rootPat" patternUnits="userSpaceOnUse" width="6" height="8">
            <line x1="3" y1="0" x2="3" y2="8" stroke="rgba(240,199,100,0.8)" strokeWidth="0.6" />
          </pattern>
          <pattern id="microbePat" patternUnits="userSpaceOnUse" width="5" height="5">
            <circle cx="2.5" cy="2.5" r={0.6 + microbeDensity * 0.8} fill="rgba(232,160,96,0.9)" />
          </pattern>
        </defs>
        {/* surface line */}
        <line x1="0" y1="0" x2={w} y2="0" stroke="#8aa040" strokeWidth="2" />
        {/* cover crop */}
        <g>
          {Array.from({length: 14}).map((_, i) => (
            <line key={i} x1={10 + i * 22} y1="0" x2={10 + i * 22 + (i%2?2:-2)} y2={-8 - (i%3)*2} stroke="#8aa040" strokeWidth="0.8" />
          ))}
        </g>
        {/* vine trunk */}
        <line x1={w/2} y1="0" x2={w/2} y2="-30" stroke="#5a4630" strokeWidth="3" />
        <path d={`M ${w/2} -30 Q ${w/2 - 24} -38 ${w/2 - 30} -22 M ${w/2} -30 Q ${w/2 + 24} -38 ${w/2 + 30} -22`} stroke="#5a4630" strokeWidth="2" fill="none" />
        {/* soil layers */}
        {layers.map((l, i) => (
          <g key={i}>
            <rect x="0" y={l.y} width={w} height={l.h} fill={l.color} />
          </g>
        ))}
        {/* microbe density overlay in A and B horizons */}
        <rect x="0" y="0" width={w} height="110" fill="url(#microbePat)" opacity="0.55" />
        {/* roots — branching */}
        <g stroke="#f0c764" strokeWidth="1.2" fill="none" opacity="0.9">
          <path d={`M ${w/2} 0 L ${w/2} ${rootDepth}`} />
          <path d={`M ${w/2} 30 Q ${w/2 - 30} 50 ${w/2 - 60} ${rootDepth - 20}`} />
          <path d={`M ${w/2} 30 Q ${w/2 + 30} 50 ${w/2 + 60} ${rootDepth - 20}`} />
          <path d={`M ${w/2} 60 Q ${w/2 - 50} 80 ${w/2 - 90} ${rootDepth - 10}`} />
          <path d={`M ${w/2} 60 Q ${w/2 + 50} 80 ${w/2 + 90} ${rootDepth - 10}`} />
          <path d={`M ${w/2} 90 L ${w/2 - 40} ${rootDepth + 5}`} />
          <path d={`M ${w/2} 90 L ${w/2 + 40} ${rootDepth + 5}`} />
        </g>
        {/* root depth marker */}
        <line x1="0" y1={rootDepth} x2={w} y2={rootDepth} stroke="#f0c764" strokeWidth="0.6" strokeDasharray="3 3" opacity="0.6" />
        <text x={w - 4} y={rootDepth - 4} className="xs-tick" textAnchor="end">root zone {Math.round(rootDepth * 0.8)}cm</text>
        {/* horizon labels */}
        {layers.map((l, i) => (
          <text key={i} x="4" y={l.y + 14} className="xs-tick">{l.label} · {l.depth}</text>
        ))}
      </svg>
    </div>
  );
}

function IndicatorBar({ ind, current, baseline, max, color, sigma }) {
  const t = Math.max(0, Math.min(1, current / max));
  const tb = Math.max(0, Math.min(1, baseline / max));
  const delta = current - baseline;
  const dsign = delta > 0.01 ? "+" : (delta < -0.01 ? "" : "±");
  const inv = INDICATORS[ind.id].inverse;
  const deltaGood = inv ? delta < 0 : delta > 0;
  const sigT = Math.max(0, Math.min(1, sigma / max));
  const loT = Math.max(0, t - sigT * 1.5);
  const hiT = Math.min(1, t + sigT * 1.5);
  return (
    <div className="ind-row">
      <div className="ind-meta">
        <span className="ind-label">{ind.label}</span>
        <span className="ind-value">
          <span className="ind-num">{current}</span>
          {sigma > 0.001 && <span className="ind-sigma">±{(sigma * 1.5).toFixed(2)}</span>}
          <span className="ind-unit">{ind.unit}</span>
        </span>
      </div>
      <div className="ind-bar-track">
        <div className="ind-bar-band" style={{left: `${loT*100}%`, width: `${(hiT-loT)*100}%`, background: color, opacity: 0.22}} />
        <div className="ind-bar-baseline" style={{left: `${tb*100}%`}} />
        <div className="ind-bar-fill" style={{width: `${t*100}%`, background: color}} />
      </div>
      <div className="ind-delta-row">
        <span className={`ind-delta ${deltaGood ? "good" : (Math.abs(delta) < 0.02 ? "neutral" : "bad")}`}>
          {dsign}{Math.abs(delta).toFixed(2)} vs baseline
        </span>
      </div>
    </div>
  );
}

function PlanBuilder({ plot, customPlan, setCustomPlan }) {
  const plotId = plot.id;
  const plan = (customPlan && customPlan[plotId]) || [];
  const [dragOver, setDragOver] = React.useState(null);
  const applicable = (iv) => {
    if (iv.scope === "both") return true;
    if (iv.scope === "annual" && plot.annual) return true;
    if (iv.scope === "perennial" && plot.perennial) return true;
    return false;
  };
  function addIv(year, id) {
    if (!id) return;
    const iv = INTERVENTIONS.find(x => x.id === id);
    if (!iv || !applicable(iv)) return;
    const next = [...plan, { year, id }];
    setCustomPlan({ ...(customPlan || {}), [plotId]: next });
  }
  function removeIv(idx) {
    const next = plan.filter((_, i) => i !== idx);
    setCustomPlan({ ...(customPlan || {}), [plotId]: next });
  }
  function clearPlot() {
    const next = { ...(customPlan || {}) };
    delete next[plotId];
    setCustomPlan(next);
  }
  const plotKind = plot.annual ? "ANNUAL" : (plot.perennial ? "PERENNIAL" : (plot.preserve ? "PRESERVE" : "PLOT"));
  return (
    <div className="plan-builder">
      <div className="pb-head">
        <span className="pb-title">PLAN BUILDER · <span className="pb-kind">{plotKind}</span> · PLOT {plotId}</span>
        {plan.length > 0 && (
          <button className="pb-clear" onClick={clearPlot}>clear</button>
        )}
      </div>
      <div className="pb-years">
        {[0,1,2,3].map(y => {
          const items = plan.map((p, i) => ({ ...p, _i: i })).filter(p => p.year === y);
          return (
            <div key={y}
                 className={`pb-year ${dragOver === y ? "drag-over" : ""}`}
                 onDragOver={(e) => { e.preventDefault(); setDragOver(y); }}
                 onDragLeave={() => setDragOver(null)}
                 onDrop={(e) => {
                   e.preventDefault();
                   setDragOver(null);
                   const id = e.dataTransfer.getData("text/plain");
                   addIv(y, id);
                 }}>
              <div className="pb-year-label">Y{y}</div>
              <div className="pb-year-items">
                {items.length === 0 && <span className="pb-empty">drop intervention here</span>}
                {items.map(p => {
                  const iv = INTERVENTIONS.find(x => x.id === p.id);
                  if (!iv) return null;
                  const isCrop = iv.family === "Crop";
                  const isReplant = iv.family === "Replant";
                  return (
                    <div key={p._i}
                         className={`pb-chip ${isCrop ? "pb-chip-crop" : ""} ${isReplant ? "pb-chip-replant" : ""}`}
                         onClick={() => removeIv(p._i)} title="click to remove">
                      <span className="pb-chip-icon">{iv.icon}</span>
                      <span className="pb-chip-label">{iv.label.replace("Cover crop: ", "").replace("Plant: ", "→ ").replace("Replant: ", "↻ ")}</span>
                      <span className="pb-chip-x">×</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="pb-lib">
        <div className="pb-lib-head">
          INTERVENTION LIBRARY <span className="pb-lib-hint">· drag onto a year · {plotKind.toLowerCase()} plot</span>
        </div>
        <div className="pb-lib-grid">
          {INTERVENTIONS.map(iv => {
            const ok = applicable(iv);
            const isCrop = iv.family === "Crop";
            const isReplant = iv.family === "Replant";
            return (
              <div key={iv.id}
                   className={`pb-lib-chip ${!ok ? "disabled" : ""} ${isCrop ? "is-crop" : ""} ${isReplant ? "is-replant" : ""}`}
                   draggable={ok}
                   onDragStart={(e) => {
                     if (!ok) { e.preventDefault(); return; }
                     e.dataTransfer.setData("text/plain", iv.id);
                     e.dataTransfer.effectAllowed = "copy";
                   }}
                   title={ok ? (iv.desc + "  ·  " + iv.cost + " " + iv.unit) : `Not applicable to ${plotKind.toLowerCase()} plots`}>
                <span className="pb-lib-icon">{iv.icon}</span>
                <span className="pb-lib-label">{iv.label}</span>
                {!ok && <span className="pb-lib-na">n/a</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlotInspector({ plot, scenario, year, opts = {}, customPlan, setCustomPlan }) {
  if (!plot) return null;
  const baseline = project(plot.id, "baseline", year, opts);
  const current  = project(plot.id, scenario, year, opts);
  const sourcePlan = scenario === "custom"
    ? ((customPlan || {})[plot.id] || [])
    : (SCENARIOS[scenario].plan[plot.id] || []);
  const plan = sourcePlan.filter(p => p.year < Math.max(year, 1));
  const upcoming = sourcePlan.filter(p => p.year >= year);
  const maxes = { carbon: 5.5, moisture: 40, microbe: 130, pest: 1.0, biodiv: 4.0, yield: 9.0, retention: 240 };

  return (
    <div className="inspector">
      <div className="ins-header">
        <div className="ins-id">PLOT · {plot.id}</div>
        <div className="ins-name">{plot.name}</div>
        <div className="ins-meta">
          <span>{plot.crop}</span>
          <span>·</span>
          <span>{plot.ha} ha</span>
          {plot.planted && <><span>·</span><span>planted {plot.planted}</span></>}
        </div>
      </div>

      <SoilCrossSection plotState={baseline} scenarioState={current} year={year} />

      <div className="ins-section">
        <div className="ins-section-head">
          <span className="ins-section-title">INDICATORS</span>
          <span className="ins-section-meta">Y+{year} · vs baseline</span>
        </div>
        {["carbon","moisture","microbe","pest","biodiv","yield","retention"].map(k => {
          if (k === "yield" && current.yield === 0) return null;
          return (
            <IndicatorBar
              key={k}
              ind={INDICATORS[k]}
              current={current[k]}
              baseline={baseline[k]}
              max={maxes[k]}
              color={INDICATORS[k].color}
              sigma={sigmaFor(k, year)}
            />
          );
        })}
      </div>

      {scenario === "custom" && (
        <PlanBuilder plot={plot} customPlan={customPlan} setCustomPlan={setCustomPlan} />
      )}

      {scenario !== "custom" && plan.length > 0 && (
        <div className="ins-section">
          <div className="ins-section-head">
            <span className="ins-section-title">APPLIED INTERVENTIONS</span>
            <span className="ins-section-meta">Y0–Y{year}</span>
          </div>
          <div className="iv-list">
            {plan.map((p, i) => {
              const iv = INTERVENTIONS.find(x => x.id === p.id);
              return (
                <div key={i} className="iv-pill">
                  <span className="iv-icon">{iv.icon}</span>
                  <span className="iv-label">{iv.label}</span>
                  <span className="iv-year">Y{p.year}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {scenario !== "custom" && upcoming.length > 0 && (
        <div className="ins-section">
          <div className="ins-section-head">
            <span className="ins-section-title">SCHEDULED</span>
            <span className="ins-section-meta">Y{year}+</span>
          </div>
          <div className="iv-list">
            {upcoming.map((p, i) => {
              const iv = INTERVENTIONS.find(x => x.id === p.id);
              return (
                <div key={i} className="iv-pill iv-pill-future">
                  <span className="iv-icon">{iv.icon}</span>
                  <span className="iv-label">{iv.label}</span>
                  <span className="iv-year">Y{p.year}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {scenario !== "custom" && plan.length > 0 && CAUSAL[plan[0].id] && (
        <div className="ins-section">
          <div className="ins-section-head">
            <span className="ins-section-title">CAUSAL CHAIN</span>
            <span className="ins-section-meta">{INTERVENTIONS.find(x=>x.id===plan[0].id).label}</span>
          </div>
          <div className="causal-chain">
            {CAUSAL[plan[0].id].map((c, i) => (
              <div key={i} className="causal-step">
                <div className="causal-from">{c.from}</div>
                <div className="causal-arrow">→</div>
                <div className="causal-to">{c.to}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

window.PlotInspector = PlotInspector;
