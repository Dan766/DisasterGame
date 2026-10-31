# Cataclysm Sandbox

A browser sandbox where you unleash disasters (asteroids, tornados, wildfires) on a procedurally generated planet. You can watch them play out up close in a regional view, then zoom out to the globe to see the global consequences.

**Status:** M2 (asteroids on the globe) complete. See [DESIGN.md](DESIGN.md) for the full design and implementation plan.

**Stack:** Vite · TypeScript · three.js · Vitest

## Development

```bash
npm install
npm run dev      # dev server
npm run check    # typecheck + lint + tests
```

| Script                | Purpose                                 |
| --------------------- | --------------------------------------- |
| `dev`                 | Vite dev server                         |
| `build`               | Typecheck + production build to `dist/` |
| `test` / `test:watch` | Vitest unit tests (`tests/`)            |
| `lint` / `format`     | ESLint / Prettier                       |

**Architecture rule:** `src/core/` and `src/sim/` must not import three.js, touch the DOM, or call `Math.random`. ESLint enforces this so the simulation stays deterministic and can move to a Web Worker (see DESIGN.md §4).
