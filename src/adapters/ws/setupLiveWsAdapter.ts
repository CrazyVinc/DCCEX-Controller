import type { LiveSnapshot } from '../../../shared/src/events/live.ts';
import type { Dispatcher } from '../../core/dispatcher.ts';
import type { Interlocking } from '../../core/interlocking.ts';
import type { LiveService } from '../../core/liveService.ts';
import type { SensorBus } from '../../core/sensorBus.ts';
import type { TrainStateManager } from '../../core/trainState.ts';
import type { TurnoutStateStore } from '../../core/turnoutState.ts';
import type { LayoutStore } from '../../services/layoutStore.ts';
import type { SocketService } from './socketio.ts';

interface Deps {
  socketService: SocketService;
  trainState: TrainStateManager;
  turnouts: TurnoutStateStore;
  layoutStore: LayoutStore;
  sensors: SensorBus;
  liveService: LiveService;
  interlocking: Interlocking;
  dispatcher: Dispatcher;
}

/** Broadcasts live state (train poses, turnout positions, sensors, claims, jobs, layout changes) to all clients. */
export function setupLiveWsAdapter({ socketService, trainState, turnouts, layoutStore, sensors, liveService, interlocking, dispatcher }: Deps): void {
  const snapshot = (): LiveSnapshot => ({
    trains: trainState.list(),
    turnouts: turnouts.snapshot(),
    layoutUpdatedAt: layoutStore.getLayout().updatedAt ?? null,
    sensors: sensors.snapshot(),
    claims: interlocking.snapshot(),
    safety: liveService.safety.state,
    simulationMode: liveService.simulationMode,
    dispatchJobs: dispatcher.list(),
  });
  interlocking.on('changed', (claims) => socketService.emit('claims:updated', claims));
  liveService.safety.on('changed', (state) => socketService.emit('safety:level', state));
  dispatcher.on('jobs', (jobs) => socketService.emit('dispatch:jobs', jobs));

  trainState.on('train', (train) => socketService.emit('train:pose', train));
  trainState.on('removed', (consistId) => socketService.emit('train:removed', { consistId }));
  turnouts.on('changed', (payload) => socketService.emit('turnout:state', payload));
  sensors.on('changed', ({ sensorId, active, updatedAt }) => socketService.emit('sensor:state', { sensorId, active, updatedAt }));
  liveService.on('mode', () => socketService.emit('live:snapshot', snapshot()));
  layoutStore.on('updated', (doc) => {
    socketService.emit('layout:updated', { updatedAt: doc.updatedAt ?? null });
    void trainState.onLayoutChanged();
  });

  socketService.onConnection((socket) => {
    socket.emit('live:snapshot', snapshot());
    socket.on('live:snapshot', () => socket.emit('live:snapshot', snapshot()));
  });
}
