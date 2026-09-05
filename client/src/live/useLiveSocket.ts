import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { LIVE_EVENTS } from '@shared/events/live.ts';
import { LAYOUT_QUERY_KEY } from '../designer/api/layoutQueries.ts';
import { useSocket } from '../context/SocketContext.jsx';
import { CONSISTS_KEY } from './api/liveApi.ts';
import { useLiveStore } from './store/liveStore.ts';

interface SocketLike {
  on: (event: string, cb: (payload: unknown) => void) => void;
  off: (event: string, cb: (payload: unknown) => void) => void;
  emit: (event: string) => void;
  connected: boolean;
}

/** Subscribes to the Socket.IO live events; every payload is validated with the shared Zod schemas. */
export function useLiveSocket(): void {
  const socket = useSocket() as SocketLike;
  const qc = useQueryClient();
  useEffect(() => {
    const store = useLiveStore.getState();
    const handlers: [string, (payload: unknown) => void][] = [
      [
        'live:snapshot',
        (p) => {
          store.applySnapshot(LIVE_EVENTS['live:snapshot'].parse(p));
          // Consists may have been changed from another client or the API.
          void qc.invalidateQueries({ queryKey: CONSISTS_KEY });
        },
      ],
      ['train:pose', (p) => store.upsertTrain(LIVE_EVENTS['train:pose'].parse(p))],
      ['train:removed', (p) => store.removeTrain(LIVE_EVENTS['train:removed'].parse(p).consistId)],
      [
        'turnout:state',
        (p) => {
          const t = LIVE_EVENTS['turnout:state'].parse(p);
          store.setTurnout(t.pieceId, t.state);
        },
      ],
      ['sensor:state', (p) => store.setSensor(LIVE_EVENTS['sensor:state'].parse(p))],
      ['claims:updated', (p) => store.setClaims(LIVE_EVENTS['claims:updated'].parse(p))],
      ['safety:level', (p) => store.setSafety(LIVE_EVENTS['safety:level'].parse(p))],
      ['dispatch:jobs', (p) => store.setDispatchJobs(LIVE_EVENTS['dispatch:jobs'].parse(p))],
      [
        'layout:updated',
        () => {
          void qc.invalidateQueries({ queryKey: LAYOUT_QUERY_KEY });
          socket.emit('live:snapshot');
        },
      ],
      [
        'connect',
        () => {
          useLiveStore.getState().setConnected(true);
          socket.emit('live:snapshot');
        },
      ],
      ['disconnect', () => useLiveStore.getState().setConnected(false)],
    ];
    for (const [event, cb] of handlers) socket.on(event, cb);
    useLiveStore.getState().setConnected(socket.connected);
    socket.emit('live:snapshot');
    return () => {
      for (const [event, cb] of handlers) socket.off(event, cb);
    };
  }, [socket, qc]);
}
