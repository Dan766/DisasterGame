# Disaster Sandbox — Design & Implementation Plan

> Working title: **Cataclysm Sandbox**
> Platform: Browser (desktop first) · Stack: Vite + TypeScript + three.js

---

## 1. Vision

An open sandbox where you look down on a living world and unleash disasters on it: asteroids, tornados, wildfires and more. You can watch them play out up close in a **regional view**, then pull back to the **globe** to see what you did to the planet.

### Pillars

1. **Instant spectacle.** You can click and see something devastating within 5 seconds of loading.
2. **Systemic, not scripted.** Disasters read and write shared world layers (terrain, water, fuel, heat, wind), so chain reactions emerge on their own.
3. **Two scales, one world.** Regional events leave persistent scars and change global stats. Global events spawn local consequences.
4. **Playful tone.** The look is stylized and toy-like. Population shows up as numbers and tiny buildings, never as visible individuals.

### Non-goals (v1)

- Scientific accuracy (it only needs to be _plausible_)
- Multiplayer
- Mobile/touch optimization
- Campaign or progression (scenarios come post-v1)

---

## 2. Player Experience

### Core loop

```
Observe world → pick disaster + tune params → pick target → watch it unfold
      ↑                                                         ↓
      └──── read stats / spot chain reactions / zoom in/out ←───┘
```

### Session flow

1. The game loads straight into the **globe**, slowly rotating, with a disaster palette on the left.
2. The player chooses **Asteroid**, hovers the globe (a targeting reticle shows the blast radius preview), and clicks. The asteroid streaks in, flashes, leaves a crater, and an ash cloud spreads across the globe.
3. The player double-clicks any point to **zoom into a region**. A camera dive plus fade loads a 25 km × 25 km diorama.
4. In the region the player launches a **tornado** or **wildfire**, or watches the aftermath of the impact (fires spreading out from the crater).
5. The **stats panel** keeps updating: population, casualties, damage, global temperature anomaly.
6. Pressing **Esc** or zooming out returns to the globe. The region's damage now shows as a scar.

### Controls

| Input        | Globe                                | Region                                |
| ------------ | ------------------------------------ | ------------------------------------- |
| Left-drag    | Rotate globe                         | Pan                                   |
| Right-drag   | —                                    | Orbit camera                          |
| Wheel        | Zoom (past threshold → enter region) | Zoom (past threshold → exit to globe) |
| Left-click   | Fire selected disaster               | Fire selected disaster                |
| Double-click | Enter region at point                | —                                     |
| Space        | Pause/resume                         | Pause/resume                          |
| 1–4          | Time speed                           | Time speed                            |
| Esc          | Deselect disaster                    | Return to globe                       |

---

## 3. World Model

### 3.1 Planet source

**Decision: procedural planet (seeded) for v1.** A real-Earth data pack can come later.

- Pros: no asset licensing, infinite worlds, and it avoids sensitivities around destroying real cities.
- Real Earth (ETOPO/Blue Marble, public domain) stays possible later, because the globe is just a set of textures in the same format.

### 3.2 Global grid

- **Equirectangular grid, 512 × 256 cells** (~0.7° per cell, ~78 km at the equator).
  - It's simple to index, maps 1:1 onto GPU textures, and pole distortion is acceptable for v1.
- Layers are stored as typed arrays (`Float32Array`/`Uint8Array`, length 131,072):

| Layer        | Type | Meaning                                                         |
| ------------ | ---- | --------------------------------------------------------------- |
| `elevation`  | f32  | meters, sea level = 0                                           |
| `biome`      | u8   | ocean, ice, tundra, forest, grassland, desert, jungle, mountain |
| `population` | f32  | people in cell                                                  |
| `baseTemp`   | f32  | °C climate baseline (latitude + elevation)                      |
| `ash`        | f32  | dust/ash optical depth τ, on a coarse 128 × 64 grid             |
| `fire`       | f32  | fraction of cell burning 0–1                                    |
| `damage`     | f32  | fraction of infrastructure destroyed 0–1                        |
| `craters`    | list | `{lat, lon, radiusKm, ocean}` for rendering + regen             |

- **Global scalars:** `globalTempAnomaly`, `totalPopulation`, `casualties`, `damageUSD`, `simTime`.

### 3.3 Global generation

1. Elevation = 3D simplex fBm sampled on the unit sphere (seamless, no poles seam), plus a continental mask and ridged noise for mountains.
2. Sea level is set so ~65–70% of the surface is ocean.
3. Base temperature = f(latitude, elevation).
4. Moisture = noise + distance to ocean.
5. Biome = lookup(temperature, moisture, elevation).
6. Population = biome habitability × coastal/river bonus × noise, then clustered into "cities" at peaks (stored as a city list with names from a syllable generator).

### 3.4 Regional grid

- **256 × 256 cells at 100 m per cell → 25.6 km square.**
- A region is identified by its center `(lat, lon)` and generated **deterministically** from `hash(worldSeed, lat, lon)`.
- Layers:

| Layer            | Type | Meaning                                  |
| ---------------- | ---- | ---------------------------------------- |
| `height`         | f32  | meters                                   |
| `water`          | f32  | water depth above terrain (m)            |
| `fuel`           | f32  | burnable biomass 0–1                     |
| `moisture`       | f32  | 0–1, dampens fire                        |
| `fireState`      | u8   | 0 unburnt, 1 burning, 2 burnt            |
| `heat`           | f32  | fire intensity / ignition accumulator    |
| `windX`, `windY` | f32  | m/s, low-res field (32×32) upsampled     |
| `structure`      | u8   | 0 none, 1 house, 2 tower, 3 road, 4 farm |
| `structHP`       | f32  | 0–1                                      |
| `population`     | f32  | people in cell                           |

### 3.5 Regional generation

1. Bilinearly sample the global `elevation`, `biome` and `population` at the region's footprint for the low-frequency shape.
2. Add high-frequency fBm detail scaled by biome (mountains rough, plains flat).
3. Carve 1–3 rivers by downhill flow from high points.
4. Set fuel and moisture from biome plus noise.
5. Place settlements by distributing the global population into town clusters (Poisson-disk), with a road network (MST between towns, terrain-cost A\*).
6. **Apply persistent scars**: replay this region's stored delta (craters, burn mask, destroyed structures).

### 3.6 Cross-scale sync ("one world")

- **Region → Globe:** when the player leaves a region, or every N sim-seconds, aggregate regional deltas (deaths, destroyed-structure fraction, burnt area) into the overlapping global cells' `population`, `damage` and `fire`.
- **Globe → Region:** when a region is entered, global state seeds it. If a global-scale event already hit inside the footprint, the region generates its local consequences (a crater mesh, fires seeded at the ignition radius, an ash tint).
- **Persistence:** `RegionDelta` = `{craters[], burnMaskRLE, destroyedStructIds[], deaths}` keyed by region id. These are kept in memory; IndexedDB comes later. They are small because the base terrain is always regenerated from the seed.

---

## 4. Simulation Architecture

```
┌──────────────── Main thread ────────────────┐      ┌──── Sim Worker (M6) ────┐
│  Input → Commands ─────────────────────────────────▶ │  World state (typed     │
│  Renderer (three.js) ◀── snapshot / dirty layers ─── │  arrays) + disasters    │
│  UI (HUD, stats)                             │      │  fixed-step loop        │
└──────────────────────────────────────────────┘      └─────────────────────────┘
```

- **Hard rule: `src/sim/**` never imports three.js or the DOM.\*\* It works on typed arrays only. That keeps the sim testable in Vitest and lets it move to a Web Worker later with no rewrite.
- **Fixed timestep:** the region uses 10 Hz sim ticks (`dt = 0.1 s` game time × speed multiplier). The globe uses 1 Hz ticks where 1 tick = 1 game-day. Rendering interpolates.
- **Commands:** all player actions are serializable commands (`{type:'spawn', disaster:'asteroid', params, target}`). This gives free replay and debugging, and makes the worker move trivial.
- **Determinism:** a seeded PRNG (mulberry32 / sfc32) per system. No `Math.random` in sim code.
- **Worker move (M6, done for the region sim):** started single-threaded; profiling (~4.5 ms mean per tick) moved it to a worker with transferable buffers. SharedArrayBuffer needs COOP/COEP headers, so avoid it unless necessary.

### 4.1 Disaster interface

```ts
interface DisasterDef<P> {
  id: string; // 'asteroid'
  scales: ('globe' | 'region')[];
  params: ParamSchema<P>; // drives UI sliders automatically
  preview(target, params): PreviewShape; // reticle radius etc.
  spawn(world, target, params, rng): DisasterInstance;
}

interface DisasterInstance {
  step(world, dt): void; // mutate world layers
  alive: boolean;
  renderState(): unknown; // plain data the view layer consumes
}
```

Each disaster has a paired **view** in `src/render/disasters/<id>.ts` that turns `renderState()` into meshes and particles. Adding a disaster means writing one sim file, one view file, and one registry entry.

### 4.2 Shared field systems (always running in region)

These run independently of disasters and are where chain reactions come from:

- **Fire spread** (cellular automaton): a burning cell ignites neighbors with probability ∝ `fuel × (1 − moisture) × windAlignment × slopeBoost`. It burns for `fuel × k` seconds, then becomes `burnt`. Heat damages structures.
- **Water flow** (virtual-pipes shallow water, coarse): handles rivers, floods and tsunami run-up. It's enabled only while water is perturbed.
- **Wind field:** a 32 × 32 base wind plus local perturbations (tornado vortex, fire updraft).
- **Structure damage:** any system can apply `damage(cell, amount, type)`. When HP reaches 0 the structure collapses, population is converted to casualties by survival rate, and a debris particle event fires.

---

## 5. Disasters (v1)

### 5.1 Asteroid — globe + region

**Params:** diameter (10 m–10 km, log slider), velocity (11–70 km/s), angle (15–90°), composition (stony/iron/icy).

**Model (plausible, simplified):**

- Mass = ρ · (4/3)π r³, KE = ½ m v².
- Energy is reported in megatons TNT (1 Mt = 4.184e15 J).
- Crater diameter ≈ `k · E^(1/3.4)` (tuned so a 1 km impactor gives ~15–20 km).
- Fireball/thermal ignition radius ∝ E^(0.41). Air-blast (structure kill) radius ∝ E^(1/3).
- Small (< ~50 m stony) impactors **airburst**: no crater, only blast and thermal.
- Ocean impact → impact tsunami (done, `sim/systems/tsunami.ts`): amplitude from crater size, decays ~1/distance, travels at ~700 km/h by shortest path over ocean cells only (land shadows it), floods coastal cells by run-up vs. elevation as game-days pass; `GlobeSim` books deaths/damage and posts a `tsunami` event. Region side: `RegionSim.spawnTsunami` feeds a wave through an edge into the shallow-water solver (`systems/water.ts`); no region water render or globe→region wiring yet.

**Globe effects:** crater decal, immediate population/damage in cells within the blast radius, `ash` injected ∝ E. Ash advects east (simple zonal wind) and decays over ~2 game-years. `globalTempAnomaly` = −f(mean ash).

**Region effects:** a streak + flash + shockwave ring that expands at a visible speed and damages structures as it passes. The crater is carved into `height` (bowl + raised rim). Ejecta particles fly out. Fires ignite within the thermal radius, then hand off to the fire system (**chain reaction**).

### 5.2 Tornado — region

**Params:** EF rating (0–5), lifetime (30 s–5 min game), path bias.

**Model:**

- A moving vortex agent. Its velocity = base wind + biased random walk (Perlin over time).
- Damage radius by EF (EF0 ~50 m … EF5 ~400 m core). Damage falls off with distance.
- It lifts and flings debris particles, strips fuel (vegetation), and damages structures by `EF × falloff × dt`.
- It perturbs the wind field around itself, which affects nearby fires (**chain reaction**).
- Intensity follows a lifecycle: spin-up, mature, rope-out.

**Visual:** a funnel made of layered, scrolling noise-textured cylinders, plus a debris ring particle system and a dust skirt.

### 5.3 Wildfire — region

**Params:** ignition point, initial size. Global wind (direction/speed) is a world setting.

**Model:** uses the shared fire CA directly; this disaster is just an "ignite" command plus UI. Fire produces smoke particles and reduces `fuel`. It spreads faster uphill and downwind, and stops at water, roads (partially) and burnt areas.

**Visual:** an emissive data texture over the terrain (burning = animated orange, burnt = charcoal), GPU-instanced smoke billboards, and trees swapped to burnt variants.

### 5.4 Post-v1 backlog (designed for, not built)

| Disaster              | Scale                                  | Uses                                        |
| --------------------- | -------------------------------------- | ------------------------------------------- |
| Tsunami               | region (spawned by ocean impact/quake) | water flow                                  |
| Earthquake            | region + globe                         | height jitter, structure damage, landslides |
| Volcano               | globe + region                         | lava (slow water variant), ash, fire        |
| Flood / super-storm   | region                                 | water flow, wind                            |
| Ice age / solar flare | globe                                  | temp anomaly, population decay              |
| Meteor shower         | globe + region                         | asteroid (many small impactors)             |
| Black hole            | region                                 | particles, height flattening, structures    |
| Alien terraformer     | globe + region                         | spreading CA that rewrites biome/fuel       |
| Kaiju                 | region                                 | moving agent (tornado-style), structures    |

### 5.5 Chain-reaction matrix (v1)

| Cause → Effect | Fire                      | Wind                  | Structures   | Global ash/temp      |
| -------------- | ------------------------- | --------------------- | ------------ | -------------------- |
| Asteroid       | ignites in thermal radius | shock gust            | blast damage | ash injection        |
| Tornado        | —                         | vortex perturbs fires | path damage  | —                    |
| Wildfire       | spreads                   | updraft (local)       | heat damage  | small ash (if large) |

---

## 6. Rendering

### 6.1 Globe

- **Mesh:** a subdivided cube-sphere (better triangle distribution than UV sphere), ~128 segments per face.
- **Shader:** a vertex shader displaces by the `elevation` texture (exaggerated ×20). A fragment shader colors from the biome palette plus overlays (fire glow, damage darkening, crater decals), with a lighting terminator.
- **Atmosphere:** a back-face fresnel shell with an additive glow. It tints grey/brown with mean ash.
- **Night side:** city lights from the `population` texture (lights go out where `damage` is high, which shows the destruction nicely).
- **Data textures:** global layers are uploaded as `DataTexture`s. Only dirty layers are re-uploaded, at most once per frame.
- **Ash clouds:** a second slightly larger sphere with an alpha mask from the `ash` layer that scrolls slowly.

### 6.2 Region

- **Terrain:** a 256 × 256 vertex `PlaneGeometry` with heights written to the position buffer (CPU; recomputed only on crater/terrain change). Splat shading by slope/height/biome plus a burn/scorch overlay texture.
- **Water:** a separate plane with a per-vertex depth texture (alpha/hidden where depth ≈ 0).
- **Structures & trees:** `InstancedMesh` per type (low-poly boxes/gable roofs, cone trees). Destroyed instances are swapped to a rubble mesh or scaled to 0.
- **Particles:** a single pooled GPU particle system (instanced quads, attributes for life/velocity) shared by debris, smoke, ejecta and sparks. Budget: 20k live particles.
- **Post FX (lightweight):** bloom (fire, flashes), a screen-shake hook, vignette. Use the `postprocessing` lib or three's `EffectComposer`.
- **Style:** flat-shaded low-poly, a saturated palette, soft hemisphere + directional light, fog for depth.

### 6.3 Globe ↔ Region transition

1. On double-click, tween the camera toward the surface point (~0.6 s, ease-in).
2. Fade to white (impact-flash feel) while the region generates (target < 300 ms; show a spinner if longer).
3. Fade into the region with the camera starting high and settling down.
   Reverse on exit. During the transition, the outgoing sim continues headless if events are still active.

---

## 7. UI / HUD

Plain DOM + CSS overlay (no framework needed for v1; Preact if it grows).

- **Disaster palette (left):** icons. Selecting one shows an auto-generated param panel from the `ParamSchema`.
- **Targeting reticle:** blast/thermal radii previewed on hover.
- **Stats panel (top-right):** population, casualties, structures destroyed, damage $, global temp anomaly, active events.
- **Time controls (bottom):** pause / 1× / 10× / 100×, plus a sim clock.
- **Event log (bottom-right):** "Day 3 — 2.1 km iron asteroid struck Varnholt Basin (48,000 Mt)".
- **World settings (gear menu):** seed, wind direction/speed, regenerate world.

---

## 8. Project Structure

```
/
├─ index.html
├─ vite.config.ts
├─ package.json / tsconfig.json
├─ src/
│  ├─ main.ts                 # bootstrap, scene manager
│  ├─ core/
│  │  ├─ rng.ts               # seeded PRNG
│  │  ├─ noise.ts             # simplex 2D/3D + fBm/ridged
│  │  ├─ grid.ts              # typed-array grid helpers, sampling
│  │  ├─ geo.ts               # lat/lon ↔ xyz, great-circle distance
│  │  └─ commands.ts          # command types + queue
│  ├─ sim/                    # NO three.js imports
│  │  ├─ world.ts             # GlobalWorld, RegionWorld, delta store
│  │  ├─ gen/globe.ts
│  │  ├─ gen/region.ts
│  │  ├─ systems/fire.ts
│  │  ├─ systems/wind.ts
│  │  ├─ systems/water.ts
│  │  ├─ systems/damage.ts
│  │  ├─ systems/atmosphere.ts  # global ash + temperature
│  │  ├─ disasters/registry.ts
│  │  ├─ disasters/asteroid.ts
│  │  ├─ disasters/tornado.ts
│  │  ├─ disasters/wildfire.ts
│  │  └─ sync.ts              # region ↔ globe aggregation
│  ├─ render/
│  │  ├─ globe/GlobeView.ts, shaders/*.glsl
│  │  ├─ region/RegionView.ts, Terrain.ts, Instances.ts, Water.ts
│  │  ├─ fx/Particles.ts, PostFX.ts, Shake.ts
│  │  ├─ disasters/asteroid.ts, tornado.ts, wildfire.ts
│  │  └─ Transition.ts
│  ├─ ui/
│  │  ├─ Palette.ts, ParamPanel.ts, Stats.ts, TimeControls.ts, EventLog.ts
│  │  └─ styles.css
│  └─ input/
│     ├─ GlobeControls.ts, RegionControls.ts, Picking.ts
└─ tests/
   ├─ noise.test.ts, fire.test.ts, asteroid.test.ts, sync.test.ts, gen.test.ts
```

---

## 9. Implementation Plan

Each milestone ends in something **playable and demoable**. Estimates assume one developer working part-time with AI assistance.

### M0 — Scaffold (½ day)

- [x] Vite + TS + three.js project; ESLint/Prettier; Vitest.
- [x] `core/rng.ts`, `core/noise.ts` (simplex 3D), `core/geo.ts`, with unit tests.
- [x] Render loop with fixed-step sim accumulator (`core/clock.ts`) and stats.js FPS overlay.
- **Done when:** `npm run dev` shows a spinning lit cube at 60 fps, and `npm test` passes.

### M1 — Procedural globe (2–3 days)

- [x] `gen/globe.ts`: elevation, temperature, moisture, biome, population and cities into a `GlobalWorld`. (~450 ms at 512×256.)
- [x] `GlobeView`: cube-sphere, displacement + biome shader, atmosphere glow, night-side city lights, starfield.
- [x] `GlobeControls`: drag-rotate, wheel zoom, inertia (wraps three's `OrbitControls`; idle auto-spin).
- [x] `Picking`: ray → lat/lon (refined for displaced terrain); hover tooltip shows biome, climate, population, nearest city.
- [x] Seed input + regenerate/random buttons; seed is kept in the `?seed=` URL param.
- **Done when:** a believable planet with continents, oceans, ice caps and visible city lights is generated in < 1 s, and hovering reports the correct cell data.

### M2 — Asteroid on the globe (2 days)

- [x] `DisasterDef` interface, registry, `ParamSchema` → auto UI panel.
- [x] `disasters/asteroid.ts` (globe scale): energy, radii, airburst rule, population/damage application, ash injection. Calibrated to Meteor Crater and Chicxulub.
- [x] `systems/atmosphere.ts`: ash advection + decay, global temp anomaly. Ash lives on a coarse 128×64 grid (mass-conserving transport). Famine deaths follow from sustained cooling.
- [x] `systems/damage.ts`: radial damage that is area-exact even for blasts smaller than a grid cell (polar integration).
- [x] Views: incoming meteor streak, flash, crater (drawn per-fragment in the globe shader at sub-cell precision; only craters ≥ 2 cells are also carved into elevation), ash veil, darkening atmosphere, fires, dimming city lights.
- [x] Targeting overlay with crater/blast/fire radii, drawn as geodesic rings in the globe shader.
- [x] Stats panel + event log + time controls (1×/10×/100×/365×).
- [x] Tests: energy/radius scaling monotonic; a 10 km impactor yields a temp anomaly below −5 °C; a 20 m impactor airbursts; ash mass conservation; deterministic replay.
- **Done when:** you can pick size and speed, smash the planet, see casualties tick up, watch ash spread and city lights go dark. **First "wow" milestone.**

### M3 — Regional view + transition (3 days)

- [x] `gen/region.ts`: footprint sampling, detail noise, rivers, fuel/moisture, towns, roads.
- [x] `RegionView`: terrain mesh + splat shader, water plane, instanced houses/towers/trees.
- [x] `RegionControls`: pan/orbit/zoom with ground clamping.
- [x] `Transition.ts`: camera dive + flash fade, both directions.
- [x] `RegionDelta` store (empty for now) + deterministic regeneration test (same lat/lon → identical hash of layers).
- **Done when:** double-clicking any land point dives into a distinct-looking diorama matching that biome (desert vs forest vs tundra), and Esc returns to the globe in the same orientation.

### M4a — Regional chain reaction (3–4 days)

The core sim loop in the region, visible and playable. Polish FX are deferred to M4b.

- [x] `systems/fire.ts`: CA with fuel/moisture/wind/slope, water/road blocking, ignition helpers.
- [x] `systems/wind.ts`: base wind field + decaying gust perturbations.
- [x] Region tick loop: 10 Hz fixed-step region sim in `main.ts` (wind → fire → damage), paused/sped up by the time controls.
- [x] Fire view: burn overlay data texture on the terrain (burning = animated orange, burnt = charcoal); burnt/removed tree instances.
- [x] Debug ignite: click-to-ignite in the region (becomes the real wildfire disaster in M5), so fire can be tuned by eye.
- [x] `systems/structureDamage.ts`: structure HP, collapse → casualties, debris events (ledger). Fire's structure damage goes through this API so casualties are counted in one place.
- [x] Asteroid (region scale, sim): crater carved into `height` (bowl + raised rim), expanding shockwave that damages structures as it passes, thermal ignition → fire system.
- [x] Asteroid (region scale, view): approach streak, flash, shockwave ring, terrain re-mesh after carving.
- [x] `RegionDelta` persistence: record craters + burn mask (RLE) + destroyed structures on exit, replay on re-entry.
- [x] Global asteroid impacts generate their local crater + fires when the region is entered later.
- [x] Wind settings UI (direction/speed in the world panel).
- [x] Tests: fire spreads faster downwind; fire does not cross a water barrier.
- [x] Tests: crater depth > 0 at center (done); damage conserves population (done); a revisited region reproduces the burn mask.
- **Done when:** an impact in a forested region carves a crater, levels a town and starts a wildfire that spreads with the wind; leaving and re-entering shows the same scars. **First chain reaction.**

### M4b — Region FX (2 days)

Shared visual infrastructure that M5's tornado and wildfire also need.

- [x] `fx/Particles.ts`: pooled GPU particles (instanced quads), shared by ejecta, debris, smoke, sparks; 20k budget. (Lives at `src/render/fx/`.)
- [x] Asteroid ejecta + fire smoke/sparks on the particle system (`fx/FireEmitter.ts`, budgeted per pass, smoke drifts with the wind).
- [x] `PostFX`: bloom for fire and flashes, vignette (region view only; `src/render/fx/PostFX.ts`).
- [x] Screen-shake hook driven by impacts (implemented in `RegionFx.shakeOffset`, applied to the region camera in `main.ts`).
- **Done when:** a regional impact reads as a big event (ejecta, glow, shake) and a large fire is visible from across the region by its smoke.

### M5 — Tornado + wildfire disasters, sync (3–4 days)

- [x] `disasters/tornado.ts`: vortex agent, lifecycle, EF damage, wind perturbation, fuel stripping (sim only; `RegionSim.spawnTornado`, no UI/view yet).
- [x] Tornado view: layered particle funnel, debris ring, dust skirt (`render/fx/TornadoEmitter.ts`); brown damage path on the terrain overlay (`RegionView.markScar`). Tornado is in the disaster palette (region click spawns it). Tornado scars persist in `RegionDelta.tornadoTrack` (sampled core path, replayed on re-entry).
- [x] `disasters/wildfire.ts`: ignite command + param panel (brush radius, ignition density), replacing the M4a debug ignite (unarmed click still ignites with the default brush).
- [x] `sim/sync.ts`: incremental region → globe aggregation (`RegionSyncer`) every 5 region-seconds and on exit; deaths hit global cell population + casualties, lost structures hit `damage` + `damageUSD`, newly burnt ground lights the globe fire layer.
- [x] Tests: sync conserves population across scales (`tests/sync.test.ts`); ~~tornado wind perturbation measurably shifts fire spread~~ (done, `tests/tornado.test.ts`).
- **Done when:** all three disasters work, a tornado can push a fire front, and leaving a region shows the damage on the globe and in global stats.

### M6 — Performance & polish (2–3 days)

- [x] Profile the region tick (`npm run profile`, `scripts/profile-region.ts`: 256² region, two 12-cell fires + EF4 tornado, ~28k burning cells peak). Result (Node, single thread): mean ~4.5 ms, p95 ~8 ms, max ~26 ms per tick - over the 4 ms budget at 10 Hz tick rate, so the worker move below is warranted.
- [x] Region sim runs in a Web Worker (`sim/regionWorker.ts` hosts `RegionSimHost`; the main thread holds a `RegionSimClient` mirror refreshed from transferable per-layer snapshots, one outstanding step request with a capped tick backlog, `flush()` before exit/sync). Terrain layers are sent only after impacts. Protocol in `sim/regionProtocol.ts`; loopback tests in `tests/region-worker.test.ts`. `npm run profile` still measures the raw tick cost, which now runs off the render thread. Not yet verified in a real browser (headless, no GPU).
- [x] Particle budget enforcement + dirty-range uploads: 20k ring buffer, per-frame upload limited to the emitted slots (two ranges across a wrap; `Particles.dirtyRanges`, `tests/particles.test.ts`).
- [x] Dirty-rect texture upload for the region fire/scar overlay (`render/region/rowSpans.ts`, one narrow update range per changed row; `tests/row-spans.test.ts`). The terrain texture is static (built once), so it needs none.
- [x] LOD for instanced buildings (`render/region/structureLod.ts`: detailed/simple mesh pair per structure type, hysteresis near/far switch by camera distance; `tests/structure-lod.test.ts`).
- [x] Audio: impact boom (delayed by distance), wind roar, fire crackle, UI clicks. Synthesised procedurally with WebAudio (`src/audio/`), so no sample files or `CREDITS.md` needed; `M` toggles mute. Mix maths in `audio/mix.ts` (`tests/audio-mix.test.ts`).
- [x] Juice: slow-mo on region impacts (`core/slowmo.ts`, hold + eased recovery, scaled by impact size; `tests/slowmo.test.ts`).
- [x] Juice: camera shake tuning - trauma-based smooth shake (`core/shake.ts`, `tests/shake.test.ts`): amplitude = trauma², stacked hits never cancel a bigger one, offset scales with camera distance.
- [x] Onboarding hint ("Pick a disaster → click the planet"): `ui/Onboarding.ts` banner, steps pick → aim, dismissed for good (localStorage) after the first launch/ignite.
- **Done when:** steady 60 fps on a mid-range laptop with a large fire + tornado + 20k particles. A first-time user destroys something within 10 s without instructions.

### M7+ — Expansion backlog (pick by fun)

1. ~~Tsunami~~ - globe-scale impact tsunami done (`tests/tsunami.test.ts`); globe wave-front overlay done (`GlobeSim.waveFronts()`, cool-tinted expanding ring in the globe shader); region-scale water flow sim done (`sim/systems/water.ts` virtual-pipes solver, `RegionSim.spawnTsunami(edge, amplitude)`, flood damage by depth; `tests/water.test.ts`); remaining: render the region water surface/wave (water plane depth texture + foam), wire the globe tsunami arrival into a region visit, and profile the solver (runs full-grid while awake, so it belongs in the region worker).
2. Earthquake + landslides
3. Volcano (lava + ash)
4. Sci-fi pack (playful, toy-tone disasters that reuse existing systems):
   - **Meteor shower:** a burst of small asteroids over an area or a whole hemisphere. Reuses the asteroid sim and view unchanged; params are count, spread and size range.
   - **Black hole:** a gravity well that sucks debris, trees and buildings into a point, flattens nearby terrain toward it, then collapses with a flash. Built on the particle system and height carving.
   - **Alien terraformer:** a seed that spreads a glowing alien biome outward like fire, rewriting `biome`/`fuel` and draining population. On the globe it shows as a spreading tint; in the region, as recolored terrain and swapped tree meshes.
   - **Kaiju:** a giant creature that wanders a path (same agent model as the tornado), stomps structures, leaves footprint craters and can be lured by cities. Low-poly toy look, no gore.
5. Scenario mode ("Destroy Varnholt with ≤ 2 disasters", "Minimize casualties" defense variant). This is the only place goals or scoring would be added.
6. Save/load worlds (IndexedDB), share seed + command log as URL
7. Real-Earth data pack
8. Replay / cinematic camera / screenshot mode

**Total to v1 (M0–M6): ~19–24 working days** (revised after M3: M4 split into M4a/M4b, M5 widened).

---

## 10. Performance Budgets

| Item                | Budget                             |
| ------------------- | ---------------------------------- |
| Frame time          | 16.6 ms (60 fps) on integrated GPU |
| Region sim tick     | ≤ 4 ms main thread (else → worker) |
| Globe gen           | < 1 s                              |
| Region gen          | < 300 ms                           |
| Draw calls (region) | < 150                              |
| Live particles      | ≤ 20k                              |
| Memory              | < 400 MB                           |

---

## 11. Testing Strategy

- **Unit (Vitest):** noise determinism, geo math, disaster scaling laws, fire CA properties, sync conservation, region regeneration determinism.
- **Golden tests:** generate a world with a fixed seed and assert summary statistics (ocean %, total population ± tolerance) so generation changes are deliberate.
- **Sim harness:** a headless script that runs N ticks of a scenario command log and prints stats. It's used for tuning and perf.
- **Manual playtest checklist** per milestone (the "Done when" criteria above).

---

## 12. Risks & Mitigations

| Risk                                      | Mitigation                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Sim + render on main thread stutters      | Sim is isolated from three.js from day 1, so moving to a worker is mechanical         |
| Fire CA looks blocky/grid-like            | Randomized spread probabilities, sub-cell noise in the burn shader, smoke hides edges |
| Region feels disconnected from globe      | Strict sampling from global layers, visible scars both ways, a shared event log       |
| Scope creep from "just one more disaster" | Disaster interface + backlog; nothing post-M5 until M6 polish is done                 |
| Tonal discomfort (casualties)             | Stylized visuals, abstract counts, no visible people, playful copy                    |
| Pole distortion on equirect grid          | Acceptable for v1; regions near poles clamp; can migrate to cube-sphere grid later    |

---

## 13. Decisions Log

| Question                 | Decision                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Real Earth vs procedural | **Procedural, seeded planet.** Real-Earth pack stays in the backlog only.                                                         |
| Score / goals            | **Informational stats only.** No score; scenarios remain post-v1 backlog.                                                         |
| Art direction            | **Low-poly toy** (_Townscaper_ / _Islanders_ feel): flat shading, saturated palette.                                              |
| Audio                    | **Free CC0 sample packs** (e.g. Kenney, freesound CC0, OpenGameArt CC0). Track sources and licenses in `public/audio/CREDITS.md`. |
