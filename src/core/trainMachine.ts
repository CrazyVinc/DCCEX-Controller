import { assign, createActor, createMachine } from 'xstate';
import type { TrainStateId } from '../../shared/src/domain/train.ts';

export interface TrainContext {
  targetMmS: number;
  speedMmS: number;
}

export type TrainEvent =
  | { type: 'SET_TARGET'; targetMmS: number }
  | { type: 'TICK'; speedMmS: number }
  | { type: 'STOP' }
  | { type: 'EMERGENCY' }
  | { type: 'RESET' }
  | { type: 'CONFIRMED' };

const EPS = 0.5;

/**
 * Motion state of one consist. The machine decides *which regime* the train is in;
 * the simulation integrates the speed and reports it back with `TICK`.
 */
export const trainMachine = createMachine({
  types: {} as { context: TrainContext; events: TrainEvent },
  id: 'train',
  initial: 'stopped',
  context: { targetMmS: 0, speedMmS: 0 },
  on: {
    EMERGENCY: { target: '.emergency', actions: assign({ targetMmS: 0, speedMmS: 0 }) },
  },
  states: {
    unknown: {
      on: {
        CONFIRMED: 'stopped',
        SET_TARGET: { target: 'accelerating', guard: ({ event }) => event.targetMmS > 0, actions: assign({ targetMmS: ({ event }) => event.targetMmS }) },
      },
    },
    stopped: {
      on: {
        SET_TARGET: { target: 'accelerating', guard: ({ event }) => event.targetMmS > 0, actions: assign({ targetMmS: ({ event }) => event.targetMmS }) },
        TICK: { actions: assign({ speedMmS: ({ event }) => event.speedMmS }) },
      },
    },
    accelerating: {
      on: {
        SET_TARGET: [
          { target: 'braking', guard: ({ context, event }) => event.targetMmS < context.speedMmS - EPS, actions: assign({ targetMmS: ({ event }) => event.targetMmS }) },
          { actions: assign({ targetMmS: ({ event }) => event.targetMmS }) },
        ],
        TICK: [
          { target: 'running', guard: ({ context, event }) => event.speedMmS >= context.targetMmS - EPS, actions: assign({ speedMmS: ({ event }) => event.speedMmS }) },
          { actions: assign({ speedMmS: ({ event }) => event.speedMmS }) },
        ],
        STOP: { target: 'braking', actions: assign({ targetMmS: 0 }) },
      },
    },
    running: {
      on: {
        SET_TARGET: [
          { target: 'braking', guard: ({ context, event }) => event.targetMmS < context.speedMmS - EPS, actions: assign({ targetMmS: ({ event }) => event.targetMmS }) },
          { target: 'accelerating', guard: ({ context, event }) => event.targetMmS > context.speedMmS + EPS, actions: assign({ targetMmS: ({ event }) => event.targetMmS }) },
          { actions: assign({ targetMmS: ({ event }) => event.targetMmS }) },
        ],
        TICK: { actions: assign({ speedMmS: ({ event }) => event.speedMmS }) },
        STOP: { target: 'braking', actions: assign({ targetMmS: 0 }) },
      },
    },
    braking: {
      on: {
        SET_TARGET: [
          { target: 'accelerating', guard: ({ context, event }) => event.targetMmS > context.speedMmS + EPS, actions: assign({ targetMmS: ({ event }) => event.targetMmS }) },
          { actions: assign({ targetMmS: ({ event }) => event.targetMmS }) },
        ],
        TICK: [
          { target: 'stopped', guard: ({ context, event }) => context.targetMmS <= EPS && event.speedMmS <= EPS, actions: assign({ speedMmS: 0 }) },
          { target: 'running', guard: ({ context, event }) => context.targetMmS > EPS && event.speedMmS <= context.targetMmS + EPS, actions: assign({ speedMmS: ({ event }) => event.speedMmS }) },
          { actions: assign({ speedMmS: ({ event }) => event.speedMmS }) },
        ],
        STOP: { actions: assign({ targetMmS: 0 }) },
      },
    },
    emergency: {
      on: {
        RESET: 'stopped',
      },
    },
  },
});

export type TrainActor = ReturnType<typeof createTrainActor>;

export function createTrainActor(initial: TrainStateId = 'stopped') {
  const actor = createActor(trainMachine);
  actor.start();
  if (initial === 'unknown' || initial === 'emergency') {
    // Recreate in the requested state by driving the machine there.
    if (initial === 'emergency') actor.send({ type: 'EMERGENCY' });
  }
  return actor;
}

export function trainStateIdOf(actor: TrainActor): TrainStateId {
  const value = actor.getSnapshot().value;
  return (typeof value === 'string' ? value : 'unknown') as TrainStateId;
}
