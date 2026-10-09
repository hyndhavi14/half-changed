# ByteMe 3D Chocolate Factory — digital twin

An interactive 3D model of the ByteMe chocolate plant (11 machines, conveyors, product flow, energy flow, walk-through) built from `docs/ByteMe-3D-Factory-Build-Prompts.pdf`, using `docs/chocolate-factory-3d.html` as the visual reference.

**Stack:** React 19 · TypeScript · Vite · three r170 · @react-three/fiber 9 · @react-three/drei 10 · zustand 5

```powershell
npm install
npm run dev        # http://localhost:5174 (strict port)
npm run build      # type-check + production bundle in dist/
```

The development server proxies `/api` to the backend at `http://localhost:3000`.
Set `VITE_API_URL` only when using a different backend origin; it may be either
the origin or the complete `/api/v1` base path.

Dev extras: open with `?perf` for the r3f-perf overlay, `?q=low` for 1x pixel ratio and 1024 shadows. Open with `?demo=true` to explicitly use the 11-machine mock fixture; in that mode, `__byteme.machineStore.getState()` shows the fixture.

## Mounting it in the ByteMe frontend

```tsx
import { FactoryTwin, MockMachineDataProvider } from './twin';

const provider = new MockMachineDataProvider();   // create once, keep stable

<div style={{ height: '100vh' }}>
  <FactoryTwin
    provider={provider}
    onMachineSelect={(id) => console.log(id)}
    initialView="reset"          // 'reset' | 'overview' | 'close'
    theme="auto"                 // 'auto' | 'light' | 'dark'
    simulate                     // the 15 s demo simulation; turn off with live data
  />
</div>
```

`FactoryTwin` fills its parent. Its CSS is scoped under `.bm-twin`, so it won't leak into the host page. Load the two brand fonts in the host page (see `index.html`):  Fraunces (headings) and Inter (UI).

The API provider is also available when embedding the twin in another host.
For the Phase 6 separately served application, configure ignored local
`factory-3d/.env.local` with `VITE_SUPABASE_URL` and the browser-safe
`VITE_SUPABASE_PUBLISHABLE_KEY`. Open Factory-3D with canonical `factoryId`
and `scheduleId` UUIDs, then sign in normally with Supabase Auth. The
user-session access token is sent only in Backend `Authorization` headers;
passwords and tokens are never put in the launcher URL or source-controlled
environment files. Never use a secret/service-role key in this application.

```ts
new ApiMachineDataProvider({
  baseUrl: 'http://localhost:3000/api/v1',
  factoryId: '<backend factory UUID>',
  scheduleId: '<backend schedule UUID>',
  headers: { Authorization: `Bearer ${accessToken}` },
  pollMs: 10000,
  onError: (error) => console.error(error),
})
```

If opened directly, backend mode requires both `factoryId` and `scheduleId`
UUID query parameters. The mock scene is available only by explicitly opening
`?demo=true`; it is never used as a fallback after an API error.

Factory-3D reads the backend's enveloped, factory-scoped machine collection
and selected schedule-with-entries endpoint. Machine UUIDs stay canonical;
only the fixed slug crosswalk chooses a scene geometry key. Machine state,
current power and solar output remain **Not reported** because the backend
provides no live telemetry. Schedule entries retain their UUIDs and exact
offset-aware timestamps and are labeled as planned intervals; schedule status
is not machine status. (Machine status shown in backend mode is the *planned* state at the
selected plan time — see "Embedded in the ByteMe frontend" below — never live telemetry.) API mode disables simulation, debug state editing and
demo product animation. Scene geometries without a backend slug mapping are
hidden and listed as unplaced; no backend machines are fabricated to fill the
11-position scene.

The backend Chocolate seed currently has six production-machine slugs and a
PV asset, while the 3D scene has eleven fixed layout machines. The explicit
crosswalk currently places the six matching production assets only; the PV
asset and unmatched scene positions remain unplaced. Full scene/seed parity is
not claimed.

## Embedded in the ByteMe frontend (planned schedule playback)

The frontend's **3D Factory** page embeds this app in an iframe (`?factoryId=…&scheduleId=…&embed=1`).
When embedded:

- The app sends `byteme-3d-ready` to the parent page and accepts the signed-in Supabase session
  back through `postMessage`, so there is no second sign-in. Messages are only accepted from the
  origins in `VITE_FRONTEND_ORIGIN` (comma-separated; default `http://localhost:5173,http://127.0.0.1:5173`).
  Tokens are never put in the URL.
- The plan time is shared both ways with the page's 2D time slider.

In backend mode (embedded or not) the scene shows the **planned** state of the stored schedule at the
selected plan time: a machine is *Running* while a schedule entry covers that time, otherwise *Idle*.
Planned power comes from the entry (or the machine's rated power), and solar comes from the stored
site energy readings for that hour. Use the **Play** control at the bottom to step through the plan.
This is a visualization of the optimizer's plan, not live telemetry.

## Public SolarShift historical replay

Open `http://localhost:5174/?scenario=hgd` or `?scenario=lgd` to load the
approved historical scenario without sign-in. The optional
`&schedule=baseline` selects its persisted baseline; the default is the
persisted SolarShift optimized schedule. Data comes from the Backend's
allowlisted public read-only endpoint, not browser-side Supabase table access.
The replay distinguishes NASA historical resource from modeled PV, solar
allocation, and grid energy; none is presented as measured telemetry.

## Architecture

```
Provider ──> useDataSync ──> zustand stores ──> 3D scene + UI panels
                              (machine, view, energy)
```

- 3D components never fetch, never import mock data and never hard-code status; they read the stores.
- The scene writes back only `hoveredId` and `selectedId`.
- Per-frame code reads stores with `getState()` inside `useFrame`, so nothing re-renders every frame.
- `src/three/registry.ts` holds runtime scene geometry (machine boxes, speed factors, colliders, the camera) that the overlay UI (labels, minimap, debug) needs. It is not app state.

```
src/
  twin/          FactoryTwin component + public API (index.ts)
  app/           dev shell only
  config/        palette, layout (11 machines, flow path), camera presets, status styles
  data/          types, mock data + descriptions, providers, useDataSync, live simulation
  state/         machineStore, scheduleStore, viewStore, energyStore (+ energyNow)
  three/
    core/        canvas textures, useBuilt, mergeStatic
    scene/       FactoryScene, Lighting, applyEnvIntensity
    environment/ ground, floor markings, walls + sign, indoor group, pipes, support areas, outside
    machines/    kit (materials), helpers (shapes), builders/ (11 machines), Machine wrapper
    flow/        path, Conveyors, Products (instanced, queueing)
    energy/      EnergyFlow (trays + animated dashed tubes)
    cameras/     CameraRig (presets, fly-to, focus, walk-through), cameraApi
    interactions/Picker (hover/select), LabelProjector, StatsProbe
  ui/            Toolbar, InfoPanel, EnergyPanel, Minimap, Labels, Toast, WalkOverlay, DebugPanel
```

## Deliberate differences from the PDF / demo

| What | Why |
|---|---|
| Sun 2.5π, hemisphere 0.3π (spec: 2.5 / 0.30) | The demo ran three r128 with legacy light units, which multiplied these by π in the shader. Modern three uses physical units; scaling restores the same picture. |
| `scene.environmentIntensity = 0.45` | r170's RoomEnvironment is brighter than r128's. 0.45 was measured by sampling rendered pixels against the demo at the default camera. The 0.85 / 0.40 per-material rule from Phase 3 is unchanged. |
| Static meshes are merged per material (`mergeStatic`) | Phase 13 performance: ~3,100 → ~345 draw calls with identical visuals. Moving parts, instanced meshes and toggled groups are never merged; machines stay pickable and individually highlightable. |
| Finished-goods rack has teal beams | The PDF says teal; the demo reused the orange raw-storage beams. |
| Switchgear screens face the hall | In the demo they faced into the cabinets and were invisible. |
| No `frameloop` toggling for hidden tabs | Browsers already pause `requestAnimationFrame` in hidden tabs; toggling R3F to `'never'` and back leaves its loop stopped. |
| `leva` not installed | Nothing needed it; the Debug panel covers it. `r3f-perf` is wired to `?perf`. |

## Checks done

All 11 machines are selectable and the pop-up matches the spec. Status changes update the beacon, the floor marks, the animation speed, and the maintenance cones and barrier. With packaging stopped, bars queue upstream at exactly 1.05 m spacing. Fly-to and machine focus work, including the walkway side for flipped machines. In walk-through, you can't pass through machines and Esc returns to orbit. Dark theme and phone layout (bottom sheet, no horizontal scroll) work, and the console shows no errors.
