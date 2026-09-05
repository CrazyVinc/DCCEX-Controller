import { useState } from 'react';
import { catalogFamilies } from '@shared/catalog/index.ts';
import { PhotoImportResponseSchema, type PhotoImportResponse } from '@shared/vision/schema.ts';
import { importCandidates } from '../lib/photoImport.ts';
import { useEditorStore } from '../store/editorStore.ts';

async function imageAspect(file: File): Promise<number> {
  const bitmap = await createImageBitmap(file);
  const aspect = bitmap.height / bitmap.width;
  bitmap.close();
  return aspect;
}

/**
 * Photo → candidate pieces. The vision model only proposes; the pieces are matched to the
 * chosen catalogue family, coupled where ends meet and flagged when the model was unsure.
 * Nothing is saved until the normal autosave runs on the reviewed layout.
 */
export function PhotoImportDialog() {
  const open = useEditorStore((s) => s.photoImportOpen);
  const setOpen = useEditorStore((s) => s.setPhotoImportOpen);
  const doc = useEditorStore((s) => s.doc);
  const applyImport = useEditorStore((s) => s.applyImport);
  const families = catalogFamilies();
  const [familyKey, setFamilyKey] = useState(families.find((f) => f.key === 'Marklin/K')?.key ?? families[0]!.key);
  const [widthMm, setWidthMm] = useState(2000);
  const [model, setModel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PhotoImportResponse | null>(null);
  const [aspect, setAspect] = useState(0.75);

  if (!open) return null;

  const analyse = async () => {
    if (!file) {
      setError('Choose a photo first');
      return;
    }
    setBusy(true);
    setError(null);
    setAnalysis(null);
    try {
      setAspect(await imageAspect(file));
      const form = new FormData();
      form.append('photo', file);
      if (model.trim()) form.append('model', model.trim());
      const res = await fetch('/api/layout/import-photo', { method: 'POST', body: form });
      const body = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !body.ok) throw new Error(body.message ?? `Analysis failed (${res.status})`);
      setAnalysis(PhotoImportResponseSchema.parse(body));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!analysis) return;
    try {
      const result = importCandidates(doc, analysis.result.elements, { familyKey, imageWidthMm: widthMm, aspect, level: doc.activeLevel });
      applyImport(result.doc, result.pieceIds, result.lowConfidence);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const low = analysis?.result.elements.filter((e) => e.confidence < 0.6).length ?? 0;

  return (
    <div className="designer-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="photo-import-title">
      <div className="designer-dialog">
        <h3 id="photo-import-title">Import track plan from a photo</h3>
        <p className="designer-muted">
          A local Ollama vision model (llava, qwen2-vl, …) proposes the pieces it sees. They are matched to the chosen catalogue family, placed and coupled where the ends meet. Unsure pieces are highlighted in orange for you to check before saving.
        </p>
        <label className="designer-field">
          <span>Top-down photo</span>
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="designer-field">
          <span>Track family</span>
          <select value={familyKey} onChange={(e) => setFamilyKey(e.target.value)}>
            {families.map((f) => (
              <option key={f.key} value={f.key}>
                {f.brand} {f.system}
              </option>
            ))}
          </select>
        </label>
        <label className="designer-field">
          <span>Real width of the photographed area (mm)</span>
          <input type="number" min={100} step={50} value={widthMm} onChange={(e) => setWidthMm(Number(e.target.value) || 0)} />
        </label>
        <label className="designer-field">
          <span>Ollama model (optional, default from server)</span>
          <input value={model} placeholder="llava" onChange={(e) => setModel(e.target.value)} />
        </label>
        {error && <p className="designer-error">{error}</p>}
        {analysis && (
          <p className="designer-muted">
            {analysis.model} found {analysis.result.elements.length} piece{analysis.result.elements.length === 1 ? '' : 's'} in {(analysis.durationMs / 1000).toFixed(1)} s
            {low ? ` · ${low} with low confidence` : ''}.{analysis.result.notes ? ` ${analysis.result.notes}` : ''}
          </p>
        )}
        <div className="designer-actions">
          <button type="button" onClick={analyse} disabled={busy}>
            {busy ? 'Analysing…' : 'Analyse photo'}
          </button>
          <button type="button" onClick={apply} disabled={!analysis || analysis.result.elements.length === 0}>
            Add pieces to layout
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
