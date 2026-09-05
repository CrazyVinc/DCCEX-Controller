# DCCEX-Controller

Server-controlled H0 model railway on top of **DCC-EX**: a graph-first track designer with exact
geometry, a server-authoritative simulation of every train (front, rear, facing and movement kept
strictly apart), a live map, path claiming with dry-runs before anything moves, and an optional
photo → track-plan import through a local Ollama vision model.

## Quick start

```bash
npm install
npm run dev        # server (node --watch, TypeScript) + Vite client
npm run start      # build client, then serve on PORT (default 3000)
npm test           # Vitest (geometry, orientation, simulation, routing, dispatcher, …)
npm run typecheck  # tsc for server/shared and client
```

Requires Node ≥ 24 (TypeScript runs natively, no build step for the server).

- DCC-EX connection: `DCCHost` (default `localhost`), `DCCPort` (default `2560`). Without a
  command station the app runs in **simulation mode**: trains move virtually and block sensors are
  derived from the simulated occupancy.
- Photo import: `OLLAMA_HOST` (default `http://localhost:11434`), `OLLAMA_VISION_MODEL` (default `llava`).

## Repository layout

```
shared/src/            TypeScript shared by server and client (imported via @shared)
├── catalog/           track catalogue as data per brand (Märklin C/K/M, Trix C, Roco, PIKO,
│                      Fleischmann, Peco, Tillig) + electrical/mechanical compatibility
├── geometry/          exact primitives (line/arc), frames, piece geometry, flex biarc solver,
│                      nearest-point, sampling (rendering only)
├── layout/            layout document v3 (Zod), graph-first index (frames derived from joints,
│                      loop-closure gaps), operations, traversal (advance through turnouts)
├── domain/            train model (pose, consist, speed model, geometry along the rail), dispatch
├── events/            Socket.IO payload schemas (client and server share them)
└── vision/            vision-model output schema + prompt

src/                   Express 5 + Socket.IO server (TypeScript on Node 24)
├── index.ts, app.ts   composition root: services → core → adapters
├── core/              dccEngine, trackGraph (graphology), trainState, turnoutState, sensorBus,
│                      simulation (fixed-step, XState), routePlanner, interlocking, dryRun,
│                      reconciliation, safety, commandGate, dispatcher, liveService
├── services/          dccEx (TCP client incl. sensors/turnout feedback), layoutStore, consistStore,
│                      rollingStock, settingsStore, ollamaVision
├── adapters/http/     REST routers (layout, consists, live, dispatch, trains, wagons, vision)
├── adapters/ws/       Socket.IO bridges (dcc:*, live:*)
└── migrations/        one-time data migrations (dated, removed after two months)

client/src/            React 19 + Vite 8 + Tailwind 4
├── designer/          Pixi.js plan editor on the shared geometry core (Zustand store,
│                      TanStack Query persistence, R3F 3D view)
├── live/              live map: trains as exact bands with a nose arrow, turnouts, occupancy,
│                      claims, placement mode, driving controls
├── dispatch/          station dispatch UI (plan → dry-run → claim → run)
└── pages, components  home cab, rolling stock, settings
```

## Key concepts

- **Graph-first layout.** Pieces are coupled through explicit joints; every piece frame is derived
  from its component root, so joints are exact by construction. A loop that does not fit is reported
  as a measurable mismatch (mm / degrees) instead of being snapped shut; flex rail can be solved
  (biarc) to close it.
- **Facing ≠ movement ≠ heading.** A train's physical front, its movement direction (forward /
  reverse) and the momentary track tangent are separate; reversing never flips the train.
- **Server is the source of truth.** DCC-EX only actuates (throttles, turnouts) and reports sensors.
  Poses live on the server (`data/automation/state.json`), occupancy is derived from them, and hardware
  sensors are reconciled against the estimate (safety levels NORMAL / DEGRADED / EMERGENCY).
- **Nothing moves without a validated dry-run.** Dispatch jobs plan a route on the directed traversal
  graph, simulate it on a clone of the live simulation with the same step size, claim the path
  atomically, set and lock the turnouts, and only then drive through the command gate.

## Data

Everything lives as JSON under `data/`: `layout.json` (v3), `consists/`, `rollingstock/`,
`automation/state.json` (live poses), `automation/corrections.jsonl` (manual position corrections),
`settings.json`. A v1 `layout.json` is migrated once at startup (backup kept as `layout.v1.backup.json`).

## License

See `package.json` (`license` field).
