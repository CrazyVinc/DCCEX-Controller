import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ConsistSchema, type ConsistInput, type Traversal } from '@shared/domain/train.ts';

const ConsistWithLengthSchema = ConsistSchema.extend({ totalLengthMm: z.number() });
export type ConsistWithLength = z.infer<typeof ConsistWithLengthSchema>;

async function jsonOrThrow<T>(res: Response, schema?: z.ZodType<T>): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status})`);
  return schema ? schema.parse(body) : (body as T);
}

export const CONSISTS_KEY = ['consists'] as const;

export function useConsistsQuery() {
  return useQuery({
    queryKey: CONSISTS_KEY,
    queryFn: async () => jsonOrThrow(await fetch('/api/consists'), z.array(ConsistWithLengthSchema)),
  });
}

export function useSaveConsistMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: ConsistInput }) =>
      jsonOrThrow(
        await fetch(id ? `/api/consists/${id}` : '/api/consists', {
          method: id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
        ConsistWithLengthSchema,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONSISTS_KEY }),
  });
}

export function useDeleteConsistMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => jsonOrThrow(await fetch(`/api/consists/${id}`, { method: 'DELETE' })),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONSISTS_KEY }),
  });
}

export function usePlaceTrainMutation() {
  return useMutation({
    mutationFn: async ({ consistId, front }: { consistId: string; front: Traversal }) =>
      jsonOrThrow(
        await fetch(`/api/live/trains/${consistId}/position`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ front }),
        }),
      ),
  });
}

export function useRemoveTrainPositionMutation() {
  return useMutation({
    mutationFn: async (consistId: string) => jsonOrThrow(await fetch(`/api/live/trains/${consistId}/position`, { method: 'DELETE' })),
  });
}

export function useSetMovementMutation() {
  return useMutation({
    mutationFn: async ({ consistId, movement }: { consistId: string; movement: 'forward' | 'reverse' | 'stopped' }) =>
      jsonOrThrow(
        await fetch(`/api/live/trains/${consistId}/movement`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ movement }),
        }),
      ),
  });
}

export function useDriveMutation() {
  return useMutation({
    mutationFn: async ({ consistId, movement, speedStep }: { consistId: string; movement: 'forward' | 'reverse'; speedStep: number }) =>
      jsonOrThrow(
        await fetch(`/api/live/trains/${consistId}/drive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ movement, speedStep }),
        }),
      ),
  });
}

export function useTrainCommandMutation() {
  return useMutation({
    mutationFn: async ({ consistId, command }: { consistId: string; command: 'stop' | 'reset' | 'confirm' }) =>
      jsonOrThrow(await fetch(`/api/live/trains/${consistId}/${command}`, { method: 'POST' })),
  });
}

export function useSafetyResetMutation() {
  return useMutation({
    mutationFn: async () => jsonOrThrow(await fetch('/api/live/safety/reset', { method: 'POST' })),
  });
}

export function useEmergencyStopMutation() {
  return useMutation({
    mutationFn: async () => jsonOrThrow(await fetch('/api/live/emergency-stop', { method: 'POST' })),
  });
}

export function useSetTurnoutMutation() {
  return useMutation({
    mutationFn: async ({ pieceId, state }: { pieceId: string; state: string }) =>
      jsonOrThrow(
        await fetch(`/api/live/turnouts/${pieceId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state }),
        }),
      ),
  });
}
