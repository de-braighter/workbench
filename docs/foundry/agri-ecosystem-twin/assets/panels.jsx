// panels.jsx — Scenario picker, subjects tree, observations log, timeline, rollup deltas.

function ScenarioTabs({ scenario, setScenario, scenarioB, setScenarioB, splitMode }) {
  const ids = ["baseline", "regen_lite", "full_stack", "pollinator", "custom"];
  return (
    <div className="scenario-tabs">
      {ids.map(id => {
        const s = SCENARIOS[id];
        const active = scenario === id;
        const activeB = splitMode && scenarioB === id;
        return (
          <button
            key={id}
            className={`scenario-tab ${active ? "active" : ""} ${activeB ? "active-b" : ""} ${id === "custom" ? "st-custom" : ""}`}
            onClick={() => splitMode ? setScenarioB(id) : setScenario(id)}
            onContextMenu={(e) => { e.preventDefault(); setScenarioB(id); }}
            title={s.sub + (splitMode ? "" : "  · right-click to set as comparison")}>
            <span className="st-swatch" style={{ background: s.palette }} />
            <span className="st-label">{s.label}</span>
            <span className="st-sub">{s.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

function WeatherPicker({ weather, setWeather }) {
  const ids = ["typical", "dry", "wet"];
  return (
    <div className="weather-picker">
      <div className="wp-label">WEATHER</div>
      <div className="wp-row">
        {ids.map(id => {
          const w = WEATHER[id];
          const active = weather === id;
          return (
            <button key={id} className={`wp-btn ${active ? "active" : ""}`}
                    onClick={() => setWeather(id)}
                    title={w.sub}>
              <span className="wp-icon">{w.icon}</span>
              <span className="wp-label-inline">{w.label.split(" ")[0].toUpperCase()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LayerPicker({ indicator, setIndicator }) {
  const ids = ["carbon","moisture","microbe","pest","biodiv","yield","retention"];
  return (
    <div className="layer-picker">
      <div className="lp-label">LAYER</div>
      <div className="lp-row">
        {ids.map(id => {
          const ind = INDICATORS[id];
          const active = indicator === id;
          return (
            <button key={id} className={`lp-btn ${active ? "active" : ""}`} onClick={() => setIndicator(id)}>
              <span className="lp-dot" style={{ background: ind.color }} />
              <span className="lp-short">{ind.short}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SubjectsTree({ selectedPlot, onSelectPlot }) {
  return (
    <div className="subjects-tree">
      <div className="tree-section">
        <div className="tree-watershed">
          <span className="tree-glyph">◢</span>
          <span className="tree-label">Navarro Watershed</span>
        </div>
        <div className="tree-farm">
          <span className="tree-glyph">▤</span>
          <span className="tree-label">Tellurian Estate</span>
          <span className="tree-meta">{FARM.hectares} ha</span>
        </div>
        <div className="tree-group">
          <div className="tree-group-label">VINE BLOCKS</div>
          {PLOTS.filter(p => ["A","B","C","D","E","F"].includes(p.id)).map(p => (
            <button key={p.id}
              className={`tree-plot ${selectedPlot===p.id?"active":""}`}
              onClick={() => onSelectPlot(p.id)}>
              <span className="tp-id">{p.id}</span>
              <span className="tp-name">{p.crop}</span>
              <span className="tp-ha">{p.ha}ha</span>
            </button>
          ))}
        </div>
        <div className="tree-group">
          <div className="tree-group-label">ANNUAL / TRIAL</div>
          {PLOTS.filter(p => ["G","H","I"].includes(p.id)).map(p => (
            <button key={p.id}
              className={`tree-plot ${selectedPlot===p.id?"active":""}`}
              onClick={() => onSelectPlot(p.id)}>
              <span className="tp-id">{p.id}</span>
              <span className="tp-name">{p.crop}</span>
              <span className="tp-ha">{p.ha}ha</span>
            </button>
          ))}
        </div>
        <div className="tree-group">
          <div className="tree-group-label">PRESERVE</div>
          {PLOTS.filter(p => ["OAK","RIP","HEDGE"].includes(p.id)).map(p => (
            <button key={p.id}
              className={`tree-plot ${selectedPlot===p.id?"active":""}`}
              onClick={() => onSelectPlot(p.id)}>
              <span className="tp-id">{p.id}</span>
              <span className="tp-name">{p.name}</span>
              <span className="tp-ha">{p.ha}ha</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ObservationsLog() {
  return (
    <div className="obs-log">
      <div className="obs-head">
        <span className="obs-title">FIELD LOG</span>
        <span className="obs-meta">last 30 days · 7 entries</span>
      </div>
      <div className="obs-list">
        {OBSERVATIONS.map((o, i) => (
          <div key={i} className="obs-row">
            <div className="obs-date">{o.date.slice(5)}</div>
            <div className="obs-glyph">{o.icon}</div>
            <div className="obs-body">
              <div className="obs-text">{o.text}</div>
              <div className="obs-meta-row">
                <span className="obs-plot">PLOT {o.plot}</span>
                <span className="obs-who">{o.who}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Sparkline with weather-driven confidence band (±1.5σ)
function Sparkline({ scenario, indicator, color, width = 120, height = 30, opts = {} }) {
  const years = [0, 1, 2, 3, 4];
  const data = years.map(y => {
    const v = rollup(scenario, y, opts)[indicator];
    const sig = sigmaFor(indicator, y);
    return { y, v, lo: v - sig * 1.5, hi: v + sig * 1.5 };
  });
  const allVals = [...data.map(d => d.lo), ...data.map(d => d.hi), ...data.map(d => d.v)];
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const span = (hi - lo) || 1;
  const yScale = (v) => height - ((v - lo) / span) * (height - 2) - 1;
  const xScale = (i) => (i / (years.length - 1)) * width;
  const bandPath = [
    ...data.map((d, i) => `${i===0?'M':'L'} ${xScale(i).toFixed(2)} ${yScale(d.hi).toFixed(2)}`),
    ...data.slice().reverse().map((d, i) => `L ${xScale(data.length-1-i).toFixed(2)} ${yScale(d.lo).toFixed(2)}`),
    'Z'
  ].join(' ');
  const centerPath = data.map((d, i) => `${i===0?'M':'L'} ${xScale(i).toFixed(2)} ${yScale(d.v).toFixed(2)}`).join(' ');
  return (
    <svg width={width} height={height} className="sparkline">
      <path d={bandPath} fill={color} opacity="0.16" />
      <path d={centerPath} stroke={color} strokeWidth="1.5" fill="none" />
      {data.map((d, i) => (
        <circle key={i} cx={xScale(i)} cy={yScale(d.v)} r={i === data.length-1 ? 2.4 : 1.2} fill={color} />
      ))}
    </svg>
  );
}

function RollupStrip({ scenario, scenarioB, splitMode, year, opts = {} }) {
  const a = rollup(scenario, year, opts);
  const b = rollup(scenarioB, year, opts);
  const ids = ["carbon","biodiv","microbe","pest","yield","retention"];
  return (
    <div className="rollup-strip">
      <div className="rs-title">
        ESTATE ROLLUP · Y+{year}
        {splitMode && <span className="rs-vs"> · {SCENARIOS[scenario].label} vs {SCENARIOS[scenarioB].label}</span>}
        <span className="rs-band-key"> · bands = ±1.5σ weather variance</span>
      </div>
      <div className="rs-grid">
        {ids.map(id => {
          const ind = INDICATORS[id];
          const va = a[id], vb = b[id];
          const delta = vb - va;
          const inv = ind.inverse;
          const dGood = inv ? delta < 0 : delta > 0;
          return (
            <div key={id} className="rs-cell">
              <div className="rs-cell-head">
                <span className="rs-cell-label">{ind.label}</span>
                <span className="rs-cell-unit">{ind.unit}</span>
              </div>
              <div className="rs-cell-body">
                <div className="rs-cell-vals">
                  <span className="rs-val rs-val-a">{va}</span>
                  {splitMode && (
                    <>
                      <span className="rs-val-sep">→</span>
                      <span className="rs-val rs-val-b">{vb}</span>
                      <span className={`rs-delta ${Math.abs(delta) < 0.02 ? "neutral" : (dGood ? "good" : "bad")}`}>
                        {delta > 0 ? "+" : ""}{delta.toFixed(2)}
                      </span>
                    </>
                  )}
                </div>
                <Sparkline scenario={splitMode ? scenarioB : scenario} indicator={id} color={ind.color} opts={opts} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Timeline({ year, setYear, scenario }) {
  const years = [0, 1, 2, 3, 4];
  // build a list of all interventions stamped on the timeline
  const stamps = [];
  Object.entries(SCENARIOS[scenario].plan).forEach(([plotId, items]) => {
    items.forEach(it => {
      const iv = INTERVENTIONS.find(x => x.id === it.id);
      if (iv) stamps.push({ plotId, year: it.year, iv });
    });
  });

  return (
    <div className="timeline">
      <div className="tl-head">
        <span className="tl-title">TIMELINE</span>
        <span className="tl-now">
          <span className="tl-year-num">Y+{year}</span>
          <span className="tl-year-date">{2026 + year}</span>
        </span>
      </div>
      <div className="tl-track">
        <div className="tl-axis">
          {years.map((y, i) => (
            <button key={y} className={`tl-tick ${year === y ? "active" : ""}`}
                    onClick={() => setYear(y)}>
              <span className="tl-tick-line" />
              <span className="tl-tick-label">Y+{y}</span>
              <span className="tl-tick-date">{2026 + y}</span>
            </button>
          ))}
        </div>
        <div className="tl-stamps">
          {stamps.map((s, i) => {
            const left = (s.year / 4) * 100;
            return (
              <div key={i} className="tl-stamp"
                   style={{ left: `${left}%` }}
                   title={`${s.plotId}: ${s.iv.label} (Y${s.year})`}>
                <span className="tl-stamp-glyph">{s.iv.icon}</span>
                <span className="tl-stamp-plot">{s.plotId}</span>
              </div>
            );
          })}
          <div className="tl-cursor" style={{ left: `${(year/4)*100}%` }} />
        </div>
        <input type="range" min="0" max="4" step="1" value={year}
               onChange={(e) => setYear(+e.target.value)} className="tl-range" />
      </div>
    </div>
  );
}

window.ScenarioTabs = ScenarioTabs;
window.WeatherPicker = WeatherPicker;
window.LayerPicker = LayerPicker;
window.SubjectsTree = SubjectsTree;
window.ObservationsLog = ObservationsLog;
window.RollupStrip = RollupStrip;
window.Timeline = Timeline;
window.Sparkline = Sparkline;
