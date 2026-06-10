// map.jsx — Topographic farm canvas with plot polygons + indicator overlays.

const { useMemo, useState } = React;

// Map indicator value -> 0..1 normalized intensity
function normalize(indicator, value) {
  const ranges = {
    carbon:    [1.0, 5.5],
    moisture:  [12, 40],
    microbe:   [30, 130],
    pest:      [0.05, 0.9],
    biodiv:    [1.0, 4.0],
    yield:     [3.0, 9.0],
    retention: [40, 240],
  };
  const [lo, hi] = ranges[indicator] || [0, 1];
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

// Color ramp per indicator. Inverse indicators (pest) flip red/green semantics.
function ramp(indicator, t) {
  // t in 0..1
  const ramps = {
    carbon:    ["#5a3e22", "#8a5a2a", "#b07a32", "#d8a248", "#f0c764"],
    moisture:  ["#2a4256", "#36607c", "#4a85a8", "#6daece", "#a0d4ec"],
    microbe:   ["#4a2818", "#7a3a20", "#a8552c", "#d47840", "#f0a060"],
    pest:      ["#2c5a30", "#4a7a3a", "#94924a", "#c8884a", "#c84a2a"],
    biodiv:    ["#2c4220", "#4a6a2c", "#7a9a3a", "#b0c050", "#d4d670"],
    yield:     ["#3a2814", "#6a4220", "#a06a2c", "#d09a3e", "#f0c870"],
    retention: ["#22384a", "#345268", "#4e7c98", "#7aaccc", "#b0d8ec"],
  };
  const r = ramps[indicator] || ramps.carbon;
  const i = Math.min(r.length - 1, Math.floor(t * (r.length - 1)));
  const j = Math.min(r.length - 1, i + 1);
  const f = t * (r.length - 1) - i;
  return mix(r[i], r[j], f);
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

function FarmMap({ scenario, indicator, year, selectedPlot, onSelectPlot, hoveredPlot, onHoverPlot, splitMode, scenarioB, opts = {} }) {
  // Single-map render. If splitMode, parent draws two side-by-side.
  return (
    <svg viewBox="0 0 1500 980" className="farm-map" preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        </pattern>
        <pattern id="oakDots" patternUnits="userSpaceOnUse" width="14" height="14">
          <circle cx="7" cy="7" r="1.6" fill="rgba(140,160,90,0.55)" />
        </pattern>
        <pattern id="vinerows" patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(0)">
          <line x1="0" y1="0" x2="9" y2="0" stroke="rgba(255,255,255,0.05)" strokeWidth="0.6" />
        </pattern>
        <pattern id="rowcrop" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(20)">
          <line x1="0" y1="0" x2="7" y2="0" stroke="rgba(255,255,255,0.10)" strokeWidth="0.6" />
          <line x1="0" y1="3.5" x2="7" y2="3.5" stroke="rgba(255,255,255,0.04)" strokeWidth="0.4" />
        </pattern>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
          <feOffset dx="0" dy="2" />
          <feComponentTransfer><feFuncA type="linear" slope="0.35" /></feComponentTransfer>
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="vignette" cx="50%" cy="50%" r="80%">
          <stop offset="60%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.55)" />
        </radialGradient>
      </defs>

      {/* base ground */}
      <rect width="1500" height="980" fill="#161a16" />
      <rect width="1500" height="980" fill="url(#hatch)" />

      {/* contour lines */}
      <g stroke="rgba(214,196,158,0.10)" strokeWidth="0.8" fill="none">
        {CONTOURS.map((d, i) => <path key={i} d={d} />)}
      </g>
      {/* every 3rd contour heavier */}
      <g stroke="rgba(214,196,158,0.20)" strokeWidth="1.1" fill="none">
        {CONTOURS.filter((_, i) => i % 3 === 0).map((d, i) => <path key={i} d={d} />)}
      </g>

      {/* roads */}
      <g stroke="rgba(214,196,158,0.18)" strokeWidth="1.4" fill="none" strokeDasharray="6 4">
        {ROADS.map((d, i) => <path key={i} d={d} />)}
      </g>

      {/* creek */}
      <path d={CREEK} stroke="#3a6a8a" strokeWidth="3" fill="none" opacity="0.7" />
      <path d={CREEK} stroke="#5a96b8" strokeWidth="1" fill="none" opacity="0.5" />

      {/* plots */}
      <g>
        {PLOTS.map(p => {
          const state = project(p.id, scenario, year, opts);
          const v = state[indicator];
          const isPreserve = !!p.preserve;
          const isCovered = indicator !== "yield" || (state.yield > 0);
          const t = isCovered ? normalize(indicator, v) : 0;
          const fill = isCovered ? ramp(indicator, t) : "#2a2823";
          const isSelected = selectedPlot === p.id;
          const isHovered = hoveredPlot === p.id;
          return (
            <g key={p.id}
               onMouseEnter={() => onHoverPlot(p.id)}
               onMouseLeave={() => onHoverPlot(null)}
               onClick={() => onSelectPlot(p.id)}
               style={{ cursor: "pointer" }}>
              <path d={p.polygon}
                    fill={fill}
                    stroke={isSelected ? "#f0c764" : (isHovered ? "#d6c49e" : "rgba(214,196,158,0.35)")}
                    strokeWidth={isSelected ? 2.4 : (isHovered ? 1.8 : 1)} />
              {/* vine rows pattern over production plots */}
              {!isPreserve && p.id !== "G" && p.id !== "H" && p.id !== "I" && (
                <path d={p.polygon} fill="url(#vinerows)" pointerEvents="none" />
              )}
              {/* row-crop pattern over annual plots */}
              {(p.id === "I") && (
                <path d={p.polygon} fill="url(#rowcrop)" pointerEvents="none" />
              )}
              {/* oak dots over oak savanna */}
              {p.id === "OAK" && (
                <path d={p.polygon} fill="url(#oakDots)" pointerEvents="none" />
              )}
            </g>
          );
        })}
      </g>

      {/* plot labels */}
      <g pointerEvents="none">
        {PLOTS.map(p => {
          const [cx, cy] = p.centroid;
          const isPreserve = !!p.preserve;
          return (
            <g key={p.id} transform={`translate(${cx},${cy})`}>
              {!isPreserve ? (
                <>
                  <text className="plot-label-id" textAnchor="middle" y="-4">{p.id}</text>
                  <text className="plot-label-crop" textAnchor="middle" y="14">{p.crop.split(" ").slice(0,2).join(" ")}</text>
                  <text className="plot-label-ha" textAnchor="middle" y="28">{p.ha} ha</text>
                </>
              ) : (
                <text className="plot-label-preserve" textAnchor="middle">{p.name.toUpperCase()}</text>
              )}
            </g>
          );
        })}
      </g>

      {/* compass + scale bar */}
      <g transform="translate(60, 870)">
        <line x1="0" y1="0" x2="120" y2="0" stroke="#d6c49e" strokeWidth="1.4" />
        <line x1="0" y1="-4" x2="0" y2="4" stroke="#d6c49e" strokeWidth="1.4" />
        <line x1="60" y1="-3" x2="60" y2="3" stroke="#d6c49e" strokeWidth="1.4" />
        <line x1="120" y1="-4" x2="120" y2="4" stroke="#d6c49e" strokeWidth="1.4" />
        <text x="0" y="18" className="map-meta" textAnchor="start">0</text>
        <text x="60" y="18" className="map-meta" textAnchor="middle">50m</text>
        <text x="120" y="18" className="map-meta" textAnchor="end">100m</text>
      </g>
      <g transform="translate(1410, 870)">
        <circle r="18" fill="none" stroke="#d6c49e" strokeWidth="0.8" />
        <line x1="0" y1="-22" x2="0" y2="22" stroke="#d6c49e" strokeWidth="0.6" />
        <line x1="-22" y1="0" x2="22" y2="0" stroke="#d6c49e" strokeWidth="0.6" />
        <polygon points="0,-22 -4,-10 4,-10" fill="#f0c764" />
        <text y="-28" className="map-meta" textAnchor="middle">N</text>
      </g>

      {/* coordinate frame ticks */}
      <g stroke="rgba(214,196,158,0.25)" fill="none" strokeWidth="0.6">
        <line x1="20" y1="20" x2="1480" y2="20" />
        <line x1="20" y1="960" x2="1480" y2="960" />
        <line x1="20" y1="20" x2="20" y2="960" />
        <line x1="1480" y1="20" x2="1480" y2="960" />
      </g>
      <g className="frame-text" fill="rgba(214,196,158,0.45)">
        <text x="30" y="14">39°00′12″N</text>
        <text x="1380" y="14">123°34′40″W</text>
        <text x="30" y="975">elev. 210m</text>
        <text x="1380" y="975">elev. 340m</text>
      </g>

      <rect width="1500" height="980" fill="url(#vignette)" pointerEvents="none" />
    </svg>
  );
}

window.FarmMap = FarmMap;
window.normalize = normalize;
window.ramp = ramp;
