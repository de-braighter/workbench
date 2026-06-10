// app.jsx — Main shell.

const { useState: useS, useEffect: useE } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "layer": "carbon",
  "scenario": "regen_lite",
  "scenarioB": "full_stack",
  "splitMode": false,
  "year": 2,
  "showField": true,
  "showObs": true,
  "weather": "typical",
  "customPlan": {}
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [selectedPlot, setSelectedPlot] = useS("A");
  const [hoveredPlot, setHoveredPlot] = useS(null);

  const layer = t.layer;
  const scenario = t.scenario;
  const scenarioB = t.scenarioB;
  const splitMode = t.splitMode;
  const year = t.year;
  const weather = t.weather;
  const customPlan = t.customPlan || {};
  const opts = { customPlan, weather };

  const plot = PLOTS.find(p => p.id === selectedPlot);

  // Animated scrub: hold a play state, advance year
  const [playing, setPlaying] = useS(false);
  useE(() => {
    if (!playing) return;
    const iv = setInterval(() => {
      setTweak("year", (y => (y >= 4 ? 0 : y + 1))(t.year));
    }, 1100);
    return () => clearInterval(iv);
  }, [playing, t.year]);

  // URL ?demo=... preset support for deck/screenshot embedding
  useE(() => {
    const params = new URLSearchParams(window.location.search);
    const demo = params.get("demo");
    if (!demo) return;
    if (demo === "split") {
      setTweak({ scenario: "regen_lite", scenarioB: "full_stack", splitMode: true, year: 4, layer: "carbon" });
    } else if (demo === "plan") {
      setTweak({ scenario: "custom", splitMode: false, year: 3, layer: "biodiv",
        customPlan: {
          A: [{year:0,id:"cover-vetch"},{year:0,id:"compost"},{year:1,id:"no-till"},{year:2,id:"biochar"}],
          E: [{year:0,id:"cover-vetch"},{year:0,id:"agroforestry"},{year:1,id:"grazing-sheep"}],
        }
      });
      setSelectedPlot("A");
    } else if (demo === "plan-rotation") {
      setTweak({ scenario: "custom", splitMode: false, year: 3, layer: "carbon",
        customPlan: {
          I: [
            {year:0, id:"crop-soy"}, {year:0, id:"cover-vetch"},
            {year:1, id:"crop-wheat"}, {year:1, id:"no-till"},
            {year:2, id:"crop-mix"}, {year:2, id:"compost"},
            {year:3, id:"crop-sorghum"}, {year:3, id:"biochar"},
          ],
        }
      });
      setSelectedPlot("I");
    } else if (demo === "weather") {
      setTweak({ scenario: "regen_lite", weather: "dry", splitMode: false, year: 4, layer: "moisture" });
    } else if (demo === "hero") {
      setTweak({ scenario: "regen_lite", splitMode: false, year: 2, layer: "carbon" });
    }
  }, []);

  return (
    <div className="app">
      {/* Top header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 32 32" width="22" height="22">
              <circle cx="16" cy="16" r="14" stroke="#f0c764" strokeWidth="1" fill="none"/>
              <path d="M 16 4 Q 22 12 22 16 Q 22 22 16 28 Q 10 22 10 16 Q 10 12 16 4 Z" fill="#f0c764" opacity="0.85"/>
              <line x1="16" y1="4" x2="16" y2="28" stroke="#161a16" strokeWidth="0.6"/>
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-name">SUBSTRATE</span>
            <span className="brand-sub">ecosystem twin · v0.4</span>
          </div>
        </div>

        <div className="header-farm">
          <div className="hf-name">{FARM.name}</div>
          <div className="hf-meta">{FARM.region} · {FARM.hectares} ha · est. {FARM.established}</div>
        </div>

        <div className="header-actions">
          <div className="hf-stat">
            <span className="hf-stat-num">{FARM.precip_mm_yr}</span>
            <span className="hf-stat-unit">mm/yr</span>
            <span className="hf-stat-label">precip</span>
          </div>
          <div className="hf-stat">
            <span className="hf-stat-num">{FARM.elevation.split("–")[1].replace("m","")}</span>
            <span className="hf-stat-unit">m</span>
            <span className="hf-stat-label">peak elev.</span>
          </div>
          <div className="hf-stat">
            <span className="hf-stat-num">{FARM.soil_orders.length}</span>
            <span className="hf-stat-unit">orders</span>
            <span className="hf-stat-label">soil</span>
          </div>
          <button className="split-toggle" onClick={() => setTweak("splitMode", !splitMode)}>
            {splitMode ? "◫ EXIT SPLIT" : "◫ COUNTERFACTUAL"}
          </button>
        </div>
      </header>

      {/* Scenario tabs row */}
      <div className="scenario-bar">
        <div className="sb-label">
          <span className="sb-label-title">SCENARIO</span>
          {splitMode && <span className="sb-label-sub">A vs B · click left to set A · click right to set B</span>}
        </div>
        <ScenarioTabs
          scenario={scenario}
          setScenario={(s) => setTweak("scenario", s)}
          scenarioB={scenarioB}
          setScenarioB={(s) => setTweak("scenarioB", s)}
          splitMode={splitMode}
        />
        <WeatherPicker weather={weather} setWeather={(w) => setTweak("weather", w)} />
        <LayerPicker indicator={layer} setIndicator={(l) => setTweak("layer", l)} />
      </div>

      {/* Main 3-column body */}
      <main className="app-body">
        {/* Left rail */}
        <aside className="left-rail">
          <SubjectsTree selectedPlot={selectedPlot} onSelectPlot={setSelectedPlot} />
          {t.showObs && <ObservationsLog />}
        </aside>

        {/* Map area */}
        <section className="map-area">
          {splitMode ? (
            <div className="map-split">
              <div className="map-pane">
                <div className="map-pane-label">
                  <span className="mpl-letter">A</span>
                  <span className="mpl-name">{SCENARIOS[scenario].label}</span>
                  <span className="mpl-sub">{SCENARIOS[scenario].sub}</span>
                </div>
                <FarmMap
                  scenario={scenario} indicator={layer} year={year} opts={opts}
                  selectedPlot={selectedPlot} onSelectPlot={setSelectedPlot}
                  hoveredPlot={hoveredPlot} onHoverPlot={setHoveredPlot}
                />
              </div>
              <div className="map-pane">
                <div className="map-pane-label">
                  <span className="mpl-letter">B</span>
                  <span className="mpl-name">{SCENARIOS[scenarioB].label}</span>
                  <span className="mpl-sub">{SCENARIOS[scenarioB].sub}</span>
                </div>
                <FarmMap
                  scenario={scenarioB} indicator={layer} year={year} opts={opts}
                  selectedPlot={selectedPlot} onSelectPlot={setSelectedPlot}
                  hoveredPlot={hoveredPlot} onHoverPlot={setHoveredPlot}
                />
              </div>
            </div>
          ) : (
            <FarmMap
              scenario={scenario} indicator={layer} year={year} opts={opts}
              selectedPlot={selectedPlot} onSelectPlot={setSelectedPlot}
              hoveredPlot={hoveredPlot} onHoverPlot={setHoveredPlot}
            />
          )}
          <div className="map-overlay-tl">
            <div className="mol-label">{INDICATORS[layer].label.toUpperCase()}</div>
            <div className="mol-legend">
              <div className="mol-ramp" style={{ background: `linear-gradient(to right, ${rampPreview(layer)})` }} />
              <div className="mol-ticks">
                <span>low</span><span>median</span><span>high</span>
              </div>
            </div>
          </div>
          <div className="map-overlay-tr">
            <div className="mot-row"><span className="mot-k">soil</span><span className="mot-v">Alfisol / Mollisol</span></div>
            <div className="mot-row"><span className="mot-k">slope</span><span className="mot-v">2°–14° SSW</span></div>
            <div className="mot-row"><span className="mot-k">aspect</span><span className="mot-v">S/SW</span></div>
            <div className="mot-row"><span className="mot-k">last sat.</span><span className="mot-v">2026-05-28</span></div>
          </div>
        </section>

        {/* Right rail */}
        <aside className="right-rail">
          <PlotInspector plot={plot} scenario={scenario} year={year} opts={opts}
                         customPlan={customPlan} setCustomPlan={(v) => setTweak("customPlan", v)} />
        </aside>
      </main>

      {/* Bottom: rollup + timeline */}
      <footer className="app-footer">
        <RollupStrip scenario={scenario} scenarioB={scenarioB} splitMode={splitMode} year={year} opts={opts} />
        <Timeline year={year} setYear={(y) => setTweak("year", y)} scenario={scenario} />
        <div className="footer-play">
          <button className="play-btn" onClick={() => setPlaying(p => !p)}>
            {playing ? "❚❚ pause" : "▶ play 4yr"}
          </button>
        </div>
      </footer>

      <TweaksPanel>
        <TweakSection label="View" />
        <TweakSelect label="Indicator layer" value={t.layer}
          options={["carbon","moisture","microbe","pest","biodiv","yield","retention"]}
          onChange={(v) => setTweak("layer", v)} />
        <TweakRadio label="Year" value={t.year} options={[0,1,2,3,4]}
          onChange={(v) => setTweak("year", v)} />
        <TweakToggle label="Counterfactual split" value={t.splitMode}
          onChange={(v) => setTweak("splitMode", v)} />
        <TweakSection label="Scenarios" />
        <TweakSelect label="Scenario A" value={t.scenario}
          options={["baseline","regen_lite","full_stack","pollinator","custom"]}
          onChange={(v) => setTweak("scenario", v)} />
        <TweakSelect label="Scenario B" value={t.scenarioB}
          options={["baseline","regen_lite","full_stack","pollinator","custom"]}
          onChange={(v) => setTweak("scenarioB", v)} />
        <TweakRadio label="Weather" value={t.weather}
          options={["typical","dry","wet"]}
          onChange={(v) => setTweak("weather", v)} />
        <TweakButton label="Reset my plan" onClick={() => setTweak("customPlan", {})} />
        <TweakSection label="Panels" />
        <TweakToggle label="Show field log" value={t.showObs}
          onChange={(v) => setTweak("showObs", v)} />
      </TweaksPanel>
    </div>
  );
}

function rampPreview(indicator) {
  const samples = [0, 0.25, 0.5, 0.75, 1];
  return samples.map(s => ramp(indicator, s)).join(", ");
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
