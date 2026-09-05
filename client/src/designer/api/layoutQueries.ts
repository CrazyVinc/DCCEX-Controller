import { useMutation, useQuery } from '@tanstack/react-query';
import { LayoutDocumentSchema, type LayoutDocument } from '@shared/layout/schema.ts';

export const LAYOUT_QUERY_KEY = ['layout'] as const;

export async function fetchLayout(): Promise<LayoutDocument> {
  const res = await fetch('/api/layout');
  if (!res.ok) throw new Error(`Failed to load layout (${res.status})`);
  return LayoutDocumentSchema.parse(await res.json());
}

export async function putLayout(doc: LayoutDocument): Promise<{ unresolvedGaps: number }> {
  const res = await fetch('/api/layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  const body = (await res.json()) as { ok?: boolean; message?: string; unresolvedGaps?: number };
  if (!res.ok || !body.ok) throw new Error(body.message ?? `Save failed (${res.status})`);
  return { unresolvedGaps: body.unresolvedGaps ?? 0 };
}

export function useLayoutQuery() {
  return useQuery({ queryKey: LAYOUT_QUERY_KEY, queryFn: fetchLayout, staleTime: Infinity });
}

export function useSaveLayoutMutation() {
  return useMutation({ mutationFn: putLayout });
}
