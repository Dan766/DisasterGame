/**
 * Region tick profiler (DESIGN.md M6): large wildfire + EF4 tornado on a 256² region.
 * Run: npm run profile  (add `-- --tsunami` to include a region tsunami / water solver)
 * Reports per-tick ms; the M6 budget is 4 ms before moving sim/ into a Web Worker.
 */
import { performance } from 'node:perf_hooks';
import { REGION_SIZE, createRegionWorld } from '../src/sim/region';
import { RegionSim } from '../src/sim/RegionSim';
import { createWind } from '../src/sim/systems/wind';

const BUDGET_MS = 4;
const TICKS = 600;

const region = createRegionWorld('profile', 1, 0, 0, 0);
region.fuel.fill(1);
const sim = new RegionSim(region, createWind(8, 90));
const mid = REGION_SIZE / 2;
sim.ignite(mid, mid, 12, 1);
sim.ignite(mid - 60, mid + 30, 12, 1);
sim.spawnTornado({ col: mid - 40, row: mid, ef: 4, headingDeg: 90, speed: 15, lifetimeS: 55 });

// Tsunami scenario (M7): wave enters from the west; the solver runs full-grid while awake.
const WITH_TSUNAMI = process.argv.includes('--tsunami');
if (WITH_TSUNAMI) sim.spawnTsunami('W', 12, 60);

const times: number[] = [];
let peakBurning = 0;
for (let i = 0; i < TICKS; i++) {
  const t0 = performance.now();
  const r = sim.step();
  times.push(performance.now() - t0);
  peakBurning = Math.max(peakBurning, r.burning);
}
times.sort((a, b) => a - b);
const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!;
const mean = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`region ${REGION_SIZE}², ${TICKS} ticks${WITH_TSUNAMI ? ' + tsunami' : ''}, peak burning cells ${peakBurning}`);
console.log(
  `mean ${mean.toFixed(2)} ms  p50 ${pct(0.5).toFixed(2)}  p95 ${pct(0.95).toFixed(2)}  max ${times[times.length - 1]!.toFixed(2)}`,
);
console.log(p95Verdict(pct(0.95)));

function p95Verdict(p95: number): string {
  return p95 <= BUDGET_MS
    ? `OK: p95 within ${BUDGET_MS} ms budget`
    : `OVER BUDGET: p95 exceeds ${BUDGET_MS} ms (sim already runs in the region Web Worker, so this is off the render thread)`;
}
