// data.js — Tellurian Estate, Mendocino. Synthetic but coherent farm data.

const FARM = {
  name: "Tellurian Estate",
  region: "Anderson Valley, Mendocino",
  hectares: 44.0,
  established: 1978,
  manager: "S. Okafor",
  advisor: "Dr. M. Lindqvist",
  watershed: "Navarro River",
  elevation: "210–340 m",
  precip_mm_yr: 1080,
  soil_orders: ["Alfisol", "Mollisol"],
};

// Plot polygons drawn in a 1600x1000 viewBox.
const PLOTS = [
  { id: "A", name: "Block A", crop: "Cabernet Sauvignon", planted: 1994, ha: 4.2, perennial: true,
    polygon: "M180,200 L420,180 L450,330 L460,440 L210,470 L170,360 Z",
    centroid: [305, 320] },
  { id: "B", name: "Block B", crop: "Chardonnay", planted: 2003, ha: 2.8, perennial: true,
    polygon: "M470,180 L660,170 L680,320 L470,330 Z",
    centroid: [575, 250] },
  { id: "C", name: "Block C", crop: "Pinot Noir", planted: 1988, ha: 3.5, perennial: true,
    polygon: "M700,160 L900,150 L935,300 L700,320 Z",
    centroid: [815, 235] },
  { id: "D", name: "Block D", crop: "Sauvignon Blanc", planted: 2011, ha: 2.1, perennial: true,
    polygon: "M210,490 L470,460 L490,610 L235,640 Z",
    centroid: [350, 550] },
  { id: "E", name: "Block E", crop: "Syrah", planted: 1999, ha: 3.9, perennial: true,
    polygon: "M500,460 L720,440 L745,610 L510,640 Z",
    centroid: [615, 540] },
  { id: "F", name: "Block F", crop: "Old-vine Zinfandel", planted: 1962, ha: 1.8, perennial: true,
    polygon: "M760,440 L935,420 L955,560 L770,580 Z",
    centroid: [855, 500] },
  { id: "G", name: "Trial Plot", crop: "Cover-crop trial", planted: 2024, ha: 1.2, annual: true,
    polygon: "M965,310 L1100,300 L1115,430 L975,440 Z",
    centroid: [1040, 370] },
  { id: "H", name: "Nursery", crop: "Vetch+Rye+Phacelia", planted: 2025, ha: 0.9, annual: true,
    polygon: "M965,460 L1090,450 L1100,560 L975,570 Z",
    centroid: [1030, 510] },
  { id: "I", name: "East Field", crop: "Row crops · currently fallow", planted: null, ha: 5.6, annual: true,
    polygon: "M1135,485 L1450,475 L1460,700 L1310,720 L1135,710 Z",
    centroid: [1290, 595] },
  { id: "OAK", name: "Oak Savanna", crop: "Quercus lobata — preserve", planted: null, ha: 6.4, preserve: true,
    polygon: "M1100,170 L1380,160 L1430,420 L1330,460 L1140,440 L1110,300 Z",
    centroid: [1260, 300] },
  { id: "RIP", name: "Riparian Corridor", crop: "Quercus Creek margin", planted: null, ha: 2.1, preserve: true,
    polygon: "M80,720 L320,700 L560,720 L820,705 L1080,725 L1340,710 L1380,760 L1100,775 L820,755 L560,770 L320,750 L100,770 Z",
    centroid: [720, 740] },
  { id: "HEDGE", name: "North Hedgerow", crop: "Native pollinator strip", planted: 2022, ha: 0.6, preserve: true,
    polygon: "M160,150 L1080,130 L1090,170 L170,190 Z",
    centroid: [625, 160] },
];

// Topographic contour lines (decorative, hand-tuned bezier paths)
const CONTOURS = [
  "M40,260 C220,200 460,180 720,200 S1180,260 1560,220",
  "M40,330 C240,280 480,260 720,280 S1180,330 1560,300",
  "M40,400 C260,360 500,340 720,360 S1180,400 1560,380",
  "M40,480 C260,440 520,420 720,440 S1200,480 1560,460",
  "M40,560 C260,520 540,500 720,520 S1200,560 1560,540",
  "M40,640 C280,600 560,580 760,600 S1220,640 1560,620",
  "M40,710 C320,670 600,650 800,670 S1240,710 1560,700",
  "M40,780 C360,740 620,720 820,740 S1260,780 1560,770",
  "M40,860 C360,820 640,800 840,820 S1280,860 1560,850",
];

// Quercus Creek (sinuous path through middle)
const CREEK =
  "M40,740 C220,710 360,760 520,735 S780,720 940,750 S1240,770 1560,745";

const ROADS = [
  "M40,90 L1560,75",
  "M120,90 L150,995",
  "M1220,75 L1280,995",
];

// Indicator definitions
const INDICATORS = {
  carbon:  { id: "carbon",  label: "Soil Organic Carbon", unit: "% SOC", color: "#3d6b3a", short: "SOC" },
  moisture:{ id: "moisture",label: "Soil Moisture",       unit: "% vwc", color: "#4a7d9e", short: "MOIST" },
  microbe: { id: "microbe", label: "Microbial Activity",  unit: "PLFA",   color: "#8a4a2b", short: "MICR" },
  pest:    { id: "pest",    label: "Pest Pressure",       unit: "index", color: "#b8533a", short: "PEST", inverse: true },
  biodiv:  { id: "biodiv",  label: "Biodiversity Score",  unit: "Shannon",color: "#7a8a3a", short: "BIOD" },
  yield:   { id: "yield",   label: "Yield",               unit: "t/ha",  color: "#9c7a3a", short: "YIELD" },
  retention:{id: "retention",label:"Water Retention",     unit: "mm",    color: "#3a6a8a", short: "RET" },
};

// Per-plot indicator baselines (today, year 0)
function rand(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s/233280; }; }

const PLOT_STATE = (() => {
  const out = {};
  PLOTS.forEach((p, i) => {
    const r = rand(p.id.charCodeAt(0) + i * 17);
    out[p.id] = {
      carbon:    +(1.4 + r() * 1.6).toFixed(2),    // 1.4 – 3.0 %
      moisture:  +(18 + r() * 14).toFixed(1),       // 18 – 32 % vwc
      microbe:   +(38 + r() * 42).toFixed(0),       // 38 – 80
      pest:      +(0.18 + r() * 0.42).toFixed(2),   // 0.18 – 0.60
      biodiv:    +(1.4 + r() * 1.4).toFixed(2),     // Shannon 1.4 – 2.8
      yield:     p.preserve || p.id==="G" || p.id==="H" || p.id==="I" ? 0 : +(4.2 + r() * 3.8).toFixed(2),
      retention: +(60 + r() * 80).toFixed(0),
    };
    if (p.preserve) {
      out[p.id].carbon    = +(3.2 + r() * 1.8).toFixed(2);
      out[p.id].biodiv    = +(2.8 + r() * 0.9).toFixed(2);
      out[p.id].microbe   = +(75 + r() * 20).toFixed(0);
      out[p.id].pest      = +(0.10 + r() * 0.10).toFixed(2);
    }
    if (p.id === "F") { out[p.id].carbon = 2.6; out[p.id].biodiv = 2.4; }
    // East Field is depleted from continuous corn
    if (p.id === "I") {
      out[p.id].carbon = 1.2;
      out[p.id].biodiv = 1.1;
      out[p.id].microbe = 32;
      out[p.id].pest = 0.58;
    }
  });
  return out;
})();

// Intervention library
const INTERVENTIONS = [
  { id: "cover-vetch", label: "Cover crop: Vetch + Rye", family: "Cover", icon: "❋", scope: "both",
    desc: "Winter-sown vetch/rye mix between vine rows. Fixes N, builds aggregates.",
    effects: { carbon: +0.18, moisture: +2.4, microbe: +12, pest: -0.06, biodiv: +0.30, yield: +0.20, retention: +14 },
    cost: 240, unit: "$/ha", season: "Autumn" },
  { id: "cover-phacelia", label: "Cover crop: Phacelia + Clover", family: "Cover", icon: "❋", scope: "both",
    desc: "Pollinator-forward mix. Slightly less N, more beneficial insects.",
    effects: { carbon: +0.12, moisture: +1.8, microbe: +9, pest: -0.12, biodiv: +0.55, yield: +0.10, retention: +10 },
    cost: 280, unit: "$/ha", season: "Autumn" },
  { id: "compost", label: "Compost application", family: "Amendment", icon: "▣", scope: "both",
    desc: "5 t/ha mature compost banded under vine row.",
    effects: { carbon: +0.34, moisture: +1.4, microbe: +18, pest: -0.02, biodiv: +0.10, yield: +0.35, retention: +8 },
    cost: 410, unit: "$/ha", season: "Spring" },
  { id: "no-till", label: "Reduced tillage", family: "Tillage", icon: "≡", scope: "both",
    desc: "Eliminate mid-row cultivation; mow only.",
    effects: { carbon: +0.22, moisture: +1.8, microbe: +14, pest: +0.04, biodiv: +0.18, yield: -0.05, retention: +12 },
    cost: -120, unit: "$/ha", season: "Year-round" },
  { id: "grazing-sheep", label: "Sheep integration", family: "Livestock", icon: "◐", scope: "both",
    desc: "Babydoll Southdown flock grazes cover crop Dec–Mar.",
    effects: { carbon: +0.14, moisture: +0.6, microbe: +10, pest: -0.04, biodiv: +0.22, yield: +0.08, retention: +4 },
    cost: 90, unit: "$/ha", season: "Winter" },
  { id: "agroforestry", label: "Agroforestry corridor", family: "Structure", icon: "♣", scope: "both",
    desc: "Plant native oak/bay corridor along block edge.",
    effects: { carbon: +0.45, moisture: +1.2, microbe: +8, pest: -0.10, biodiv: +0.80, yield: -0.10, retention: +20 },
    cost: 1200, unit: "$/ha one-off", season: "Winter" },
  { id: "hedgerow", label: "Pollinator hedgerow", family: "Structure", icon: "✿", scope: "both",
    desc: "Extend hedgerow with ceanothus, toyon, elderberry.",
    effects: { carbon: +0.20, moisture: +0.4, microbe: +4, pest: -0.14, biodiv: +0.65, yield: +0.05, retention: +6 },
    cost: 780, unit: "$/ha one-off", season: "Winter" },
  { id: "biochar", label: "Biochar inoculation", family: "Amendment", icon: "◆", scope: "both",
    desc: "2 t/ha activated biochar with compost extract.",
    effects: { carbon: +0.55, moisture: +2.2, microbe: +16, pest: 0, biodiv: +0.06, yield: +0.18, retention: +18 },
    cost: 620, unit: "$/ha", season: "Spring" },
  { id: "drip-deficit", label: "Deficit drip schedule", family: "Water", icon: "◇", scope: "perennial",
    desc: "Reduce summer irrigation 30%, ETc-driven.",
    effects: { carbon: +0.02, moisture: -1.2, microbe: -2, pest: -0.04, biodiv: +0.02, yield: -0.15, retention: -4 },
    cost: -180, unit: "$/ha", season: "Summer" },
  { id: "swale", label: "Keyline swales", family: "Earthworks", icon: "≈", scope: "both",
    desc: "Cut contour swales on slope.",
    effects: { carbon: +0.10, moisture: +3.2, microbe: +4, pest: 0, biodiv: +0.10, yield: +0.12, retention: +32 },
    cost: 1450, unit: "$/ha one-off", season: "Autumn" },

  // ===== CROP CHOICE — annual plots only. Each is a one-year planting decision. =====
  { id: "crop-corn", label: "Plant: Corn", family: "Crop", icon: "✸", scope: "annual",
    desc: "High-yield maize. Heavy N feeder. Monoculture risk — microbe & biodiv dip.",
    effects: { carbon: -0.10, moisture: -1.4, microbe: -6, pest: +0.10, biodiv: -0.15, yield: +3.2, retention: -10 },
    cost: 540, unit: "$/ha", season: "Spring" },
  { id: "crop-soy", label: "Plant: Soybean", family: "Crop", icon: "❂", scope: "annual",
    desc: "Nitrogen fixer. Breaks corn rootworm cycle. Mid-tier yield.",
    effects: { carbon: +0.06, moisture: +0.4, microbe: +10, pest: -0.08, biodiv: +0.08, yield: +1.6, retention: +2 },
    cost: 420, unit: "$/ha", season: "Spring" },
  { id: "crop-wheat", label: "Plant: Winter wheat", family: "Crop", icon: "✳", scope: "annual",
    desc: "Fall-planted small grain. Low inputs, builds structure with stubble.",
    effects: { carbon: +0.10, moisture: +1.0, microbe: +4, pest: -0.02, biodiv: +0.12, yield: +1.4, retention: +8 },
    cost: 340, unit: "$/ha", season: "Autumn" },
  { id: "crop-sorghum", label: "Plant: Sorghum", family: "Crop", icon: "▼", scope: "annual",
    desc: "Drought-tolerant grain. Deep roots build SOC. Low-water year hedge.",
    effects: { carbon: +0.18, moisture: -0.6, microbe: +6, pest: +0.02, biodiv: +0.06, yield: +1.0, retention: +6 },
    cost: 380, unit: "$/ha", season: "Spring" },
  { id: "crop-mix", label: "Plant: 3-crop rotation", family: "Crop", icon: "✿", scope: "annual",
    desc: "Corn → Soy → Small-grain over 3 yr. Breaks pest & nutrient cycles.",
    effects: { carbon: +0.22, moisture: +1.4, microbe: +16, pest: -0.16, biodiv: +0.36, yield: +1.6, retention: +14 },
    cost: 440, unit: "$/ha", season: "Year-round" },

  // ===== REPLANT — perennial-only. Big yield hit, long-tail reset. =====
  { id: "replant", label: "Replant: variety swap", family: "Replant", icon: "↻", scope: "perennial",
    desc: "Rip out, fallow 1 yr, replant new variety. 3 yr yield hit before full vigor; pest reset.",
    effects: { carbon: -0.18, moisture: 0, microbe: -10, pest: -0.18, biodiv: +0.06, yield: -3.5, retention: -6 },
    cost: 8500, unit: "$/ha one-off", season: "Winter" },
];

// Weather scenarios — applied as offsets to projected indicators per year.
const WEATHER = {
  typical: {
    id: "typical",
    label: "Typical year",
    sub: "30-yr median rainfall & GDD",
    icon: "○",
    offsets: { carbon: 0, moisture: 0, microbe: 0, pest: 0, biodiv: 0, yield: 0, retention: 0 },
  },
  dry: {
    id: "dry",
    label: "Dry / drought",
    sub: "−30% precip, +2°C summer",
    icon: "△",
    offsets: { carbon: -0.04, moisture: -4.5, microbe: -10, pest: +0.08, biodiv: -0.10, yield: -0.95, retention: -28 },
  },
  wet: {
    id: "wet",
    label: "Wet / mildew yr",
    sub: "+40% precip, late spring rain",
    icon: "▽",
    offsets: { carbon: +0.02, moisture: +4.0, microbe: +6, pest: +0.12, biodiv: +0.05, yield: -0.55, retention: +28 },
  },
};

// Per-indicator weather variance (σ per year-step from year 0).
// Compounding uncertainty: σ_y ≈ base * y (with a tiny baseline at y=0).
const VARIANCE = {
  carbon:    { base: 0.04, growth: 0.05 },
  moisture:  { base: 0.8,  growth: 1.6  },
  microbe:   { base: 3,    growth: 5    },
  pest:      { base: 0.03, growth: 0.04 },
  biodiv:    { base: 0.06, growth: 0.08 },
  yield:     { base: 0.20, growth: 0.45 },
  retention: { base: 6,    growth: 9    },
};
function sigmaFor(indicator, year) {
  const v = VARIANCE[indicator] || { base: 0, growth: 0 };
  return v.base + v.growth * year;
}

// Scenarios — sequences of interventions per plot, per year.
// scenario[plotId] = [{year: 0, intervention: id, intensity: 1.0}, ...]
const SCENARIOS = {
  baseline: {
    id: "baseline",
    label: "Baseline",
    sub: "Current practice. No change.",
    palette: "#7a7368",
    plan: {},
  },
  regen_lite: {
    id: "regen_lite",
    label: "Cover + Compost",
    sub: "Year-round cover and annual compost across vine blocks.",
    palette: "#3d6b3a",
    plan: {
      A: [{ year: 0, id: "cover-vetch" }, { year: 0, id: "compost" }, { year: 1, id: "no-till" }],
      B: [{ year: 0, id: "cover-vetch" }, { year: 0, id: "compost" }, { year: 1, id: "no-till" }],
      C: [{ year: 0, id: "cover-phacelia" }, { year: 1, id: "compost" }],
      D: [{ year: 0, id: "cover-phacelia" }, { year: 0, id: "no-till" }],
      E: [{ year: 0, id: "cover-vetch" }, { year: 1, id: "compost" }, { year: 1, id: "no-till" }],
      F: [{ year: 0, id: "compost" }, { year: 1, id: "cover-vetch" }],
    },
  },
  full_stack: {
    id: "full_stack",
    label: "Full Regen Stack",
    sub: "Cover crop, sheep, biochar, agroforestry corridor, keyline swales.",
    palette: "#8a4a2b",
    plan: {
      A: [{ year: 0, id: "cover-vetch" }, { year: 0, id: "swale" }, { year: 0, id: "no-till" }, { year: 1, id: "grazing-sheep" }, { year: 2, id: "biochar" }],
      B: [{ year: 0, id: "cover-vetch" }, { year: 0, id: "compost" }, { year: 1, id: "grazing-sheep" }, { year: 2, id: "biochar" }],
      C: [{ year: 0, id: "cover-phacelia" }, { year: 0, id: "no-till" }, { year: 1, id: "grazing-sheep" }, { year: 2, id: "biochar" }],
      D: [{ year: 0, id: "cover-phacelia" }, { year: 0, id: "no-till" }, { year: 1, id: "grazing-sheep" }],
      E: [{ year: 0, id: "cover-vetch" }, { year: 0, id: "agroforestry" }, { year: 1, id: "grazing-sheep" }, { year: 2, id: "biochar" }],
      F: [{ year: 0, id: "compost" }, { year: 0, id: "no-till" }, { year: 1, id: "biochar" }],
      HEDGE: [{ year: 0, id: "hedgerow" }],
      G: [{ year: 0, id: "cover-vetch" }, { year: 0, id: "biochar" }],
    },
  },
  pollinator: {
    id: "pollinator",
    label: "Biodiversity-First",
    sub: "Pollinator strips, phacelia, hedgerows, agroforestry. Yield neutral.",
    palette: "#7a8a3a",
    plan: {
      A: [{ year: 0, id: "cover-phacelia" }, { year: 0, id: "no-till" }],
      B: [{ year: 0, id: "cover-phacelia" }, { year: 1, id: "hedgerow" }],
      C: [{ year: 0, id: "cover-phacelia" }, { year: 0, id: "no-till" }, { year: 2, id: "agroforestry" }],
      D: [{ year: 0, id: "cover-phacelia" }],
      E: [{ year: 0, id: "cover-phacelia" }, { year: 1, id: "agroforestry" }],
      F: [{ year: 0, id: "cover-phacelia" }, { year: 1, id: "hedgerow" }],
      HEDGE: [{ year: 0, id: "hedgerow" }],
    },
  },
  custom: {
    id: "custom",
    label: "My Plan",
    sub: "Build your own intervention sequence. Drag from library.",
    palette: "#d4a04a",
    plan: {}, // resolved from customPlan tweak at runtime
  },
};

// Projection model: cumulative-ish, with diminishing returns and weather offsets.
// opts: { customPlan?: {[plotId]: [{year,id}]}, weather?: 'typical'|'dry'|'wet' }
function project(plotId, scenarioId, year, opts = {}) {
  const base = { ...PLOT_STATE[plotId] };
  const weatherOff = (WEATHER[opts.weather] || WEATHER.typical).offsets;
  if (year === 0) {
    // no weather applied at "now"
    return base;
  }
  const sourcePlan = scenarioId === "custom"
    ? ((opts.customPlan || {})[plotId] || [])
    : (SCENARIOS[scenarioId].plan[plotId] || []);
  const plan = sourcePlan.filter(p => p.year < year);
  const counts = {};
  plan.forEach(p => { counts[p.id] = (counts[p.id] || 0) + 1; });
  Object.entries(counts).forEach(([id, n]) => {
    const iv = INTERVENTIONS.find(x => x.id === id);
    if (!iv) return;
    // diminishing returns: n=1 → 1.0, n=2 → 1.7, n=3 → 2.2
    const mult = n <= 1 ? 1 : 1 + Math.log2(n) * 0.7;
    Object.entries(iv.effects).forEach(([k, v]) => {
      base[k] = +(base[k] + v * mult).toFixed(2);
    });
  });
  // soft caps + floors
  base.carbon = Math.min(6.0, Math.max(0.5, base.carbon));
  base.moisture = Math.min(45, Math.max(8, base.moisture));
  base.microbe = Math.min(140, Math.max(20, base.microbe));
  base.pest = Math.min(1.0, Math.max(0.02, base.pest));
  base.biodiv = Math.min(4.5, Math.max(0.5, base.biodiv));
  base.retention = Math.min(280, Math.max(20, base.retention));
  if (base.yield > 0) base.yield = Math.max(0, base.yield);
  // weather offsets (scaled by year so y=1 gets ~1/3, y=4 gets full)
  const wScale = Math.min(1, year / 3);
  Object.keys(weatherOff).forEach(k => {
    if (k === "yield" && base.yield === 0) return;
    base[k] = +(base[k] + weatherOff[k] * wScale).toFixed(2);
  });
  // re-clamp
  base.carbon = Math.min(6.0, Math.max(0.5, base.carbon));
  base.moisture = Math.min(45, Math.max(8, base.moisture));
  base.microbe = Math.min(140, Math.max(20, base.microbe));
  base.pest = Math.min(1.0, Math.max(0.02, base.pest));
  base.biodiv = Math.min(4.5, Math.max(0.5, base.biodiv));
  base.retention = Math.min(280, Math.max(20, base.retention));
  return base;
}

// Roll up indicators across all "production" plots for a year/scenario
const PRODUCTION_PLOTS = ["A","B","C","D","E","F","G","I"];
function rollup(scenarioId, year, opts = {}) {
  const out = { carbon:0, moisture:0, microbe:0, pest:0, biodiv:0, yield:0, retention:0 };
  let totalHa = 0, yieldHa = 0;
  PRODUCTION_PLOTS.forEach(id => {
    const p = PLOTS.find(x => x.id === id); if (!p) return;
    const s = project(id, scenarioId, year, opts);
    totalHa += p.ha;
    out.carbon    += s.carbon    * p.ha;
    out.moisture  += s.moisture  * p.ha;
    out.microbe   += s.microbe   * p.ha;
    out.pest      += s.pest      * p.ha;
    out.biodiv    += s.biodiv    * p.ha;
    out.retention += s.retention * p.ha;
    if (s.yield > 0) { out.yield += s.yield * p.ha; yieldHa += p.ha; }
  });
  out.carbon    = +(out.carbon    / totalHa).toFixed(2);
  out.moisture  = +(out.moisture  / totalHa).toFixed(1);
  out.microbe   = +(out.microbe   / totalHa).toFixed(0);
  out.pest      = +(out.pest      / totalHa).toFixed(2);
  out.biodiv    = +(out.biodiv    / totalHa).toFixed(2);
  out.retention = +(out.retention / totalHa).toFixed(0);
  out.yield     = +(out.yield     / yieldHa).toFixed(2);
  return out;
}

// Field notes / observations (recent log)
const OBSERVATIONS = [
  { date: "2026-05-22", kind: "soil",   plot: "A", who: "S. Okafor", text: "SOC up 0.14 since spring '24. Aggregates visibly improved at 0-15cm.", icon: "◇" },
  { date: "2026-05-18", kind: "pest",   plot: "C", who: "field",     text: "Light leafhopper pressure on row 14-22. Beneficials present.", icon: "✕" },
  { date: "2026-05-15", kind: "drone",  plot: "E", who: "drone-7",   text: "NDVI variance 0.12; suspect compaction band near old road.", icon: "◈" },
  { date: "2026-05-11", kind: "biodiv", plot: "HEDGE", who: "M. Lindqvist", text: "Bombus vosnesenskii nest active. Pollinator count +38% YoY.", icon: "✿" },
  { date: "2026-05-04", kind: "water",  plot: "A", who: "sensor",    text: "VWC at 30cm: 28.4% — above 5yr median for this date.", icon: "◇" },
  { date: "2026-04-29", kind: "soil",   plot: "F", who: "lab",       text: "PLFA microbial biomass 78 ng/g — strongest reading on estate.", icon: "◉" },
  { date: "2026-04-22", kind: "yield",  plot: "D", who: "S. Okafor", text: "Bud break uniform. Estimating 6.2 t/ha if frost holds.", icon: "▲" },
];

// Causal chain examples (for inspector "How does this work?" panel)
const CAUSAL = {
  "cover-vetch": [
    { from: "Vetch+Rye sown",       to: "Living roots Nov–Apr" },
    { from: "Living roots",         to: "Carbon exudate → microbes (+12 PLFA)" },
    { from: "Vetch nodules",        to: "Biological N fixation (~60 kg/ha)" },
    { from: "Rye biomass",          to: "Surface residue → moisture +2.4%" },
    { from: "Diverse canopy",       to: "Habitat for predatory insects → pest -0.06" },
    { from: "Aggregate stability",  to: "SOC +0.18%, water retention +14mm" },
  ],
  "biochar": [
    { from: "Biochar applied",      to: "Persistent porous carbon (~100yr)" },
    { from: "Pores",                to: "Microbial refugia → PLFA +16" },
    { from: "CEC increase",         to: "Nutrient retention → yield +0.18 t/ha" },
    { from: "Direct SOC",           to: "Soil organic carbon +0.55%" },
  ],
  "agroforestry": [
    { from: "Native trees planted", to: "Deep roots access subsoil water" },
    { from: "Canopy shade",         to: "Microclimate buffer ±2°C edge effect" },
    { from: "Leaf litter",          to: "SOC +0.45%, microbe +8" },
    { from: "Bird/bat habitat",     to: "Biodiversity +0.80, pest -0.10" },
    { from: "Yield trade-off",      to: "Edge rows: -0.10 t/ha first 5yr" },
  ],
};

window.WEATHER = WEATHER;
window.VARIANCE = VARIANCE;
window.sigmaFor = sigmaFor;
window.FARM = FARM;
window.PLOTS = PLOTS;
window.CONTOURS = CONTOURS;
window.CREEK = CREEK;
window.ROADS = ROADS;
window.INDICATORS = INDICATORS;
window.PLOT_STATE = PLOT_STATE;
window.INTERVENTIONS = INTERVENTIONS;
window.SCENARIOS = SCENARIOS;
window.OBSERVATIONS = OBSERVATIONS;
window.CAUSAL = CAUSAL;
window.project = project;
window.rollup = rollup;
window.PRODUCTION_PLOTS = PRODUCTION_PLOTS;
