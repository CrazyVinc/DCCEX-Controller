import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { DispatchJobSchema, type DispatchJob } from '@shared/domain/dispatch.ts';
import { useLayoutQuery } from '../designer/api/layoutQueries.ts';
import { useConsistsQuery, useSetTurnoutMutation } from '../live/api/liveApi.ts';
import { LiveCanvas } from '../live/canvas/LiveCanvas.tsx';
import { useLiveStore } from '../live/store/liveStore.ts';
import { useLiveSocket } from '../live/useLiveSocket.ts';
import '../designer/styles/designer.css';
import '../live/styles/live.css';
import './dispatch.css';

const DispatchInfoSchema = z.object({
  jobs: z.array(DispatchJobSchema),
  stations: z.array(z.object({ name: z.string(), platforms: z.array(z.object({ id: z.string(), lengthMm: z.number() })) })),
});

function useDispatchInfo() {
  return useQuery({
    queryKey: ['dispatch'],
    queryFn: async () => DispatchInfoSchema.parse(await (await fetch('/api/dispatch')).json()),
  });
}

function useDispatchMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { consistId: string; station: string; speedStep: number; allowReverse: boolean }) => {
      const res = await fetch('/api/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const body = (await res.json()) as { ok: boolean; job: DispatchJob; message?: string };
      if (!res.ok && !body.job) throw new Error(body.message ?? `Dispatch failed (${res.status})`);
      return body.job;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['dispatch'] }),
  });
}

function useAbortMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => (await fetch(`/api/dispatch/${jobId}/abort`, { method: 'POST' })).json(),
    onSettled: () => qc.invalidateQueries({ queryKey: ['dispatch'] }),
  });
}

function JobCard({ job, consistName, onAbort }: { job: DispatchJob; consistName: string; onAbort: () => void }) {
  const active = job.state === 'running' || job.state === 'held' || job.state === 'validated' || job.state === 'planned';
  return (
    <li className={`dispatch-job is-${job.state}`}>
      <div className="dispatch-job-head">
        <span className="dispatch-job-title">
          {consistName} → {job.station}
        </span>
        <span className={`live-badge dispatch-state-${job.state}`}>{job.state}</span>
      </div>
      <div className="dispatch-progress" aria-label={`Progress ${Math.round(job.progress * 100)}%`}>
        <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
      </div>
      <p className="designer-muted">
        {job.movement ? `${job.movement}, ` : ''}
        {job.routeLengthMm ? `${(job.routeLengthMm / 1000).toFixed(2)} m, ` : ''}
        {job.estimatedDurationMs ? `≈ ${Math.round(job.estimatedDurationMs / 1000)} s, ` : ''}
        step {job.speedStep}
        {job.turnoutStates.length ? ` · ${job.turnoutStates.length} turnout(s)` : ''}
      </p>
      {job.reason && <p className={job.state === 'rejected' ? 'designer-error' : 'designer-muted'}>{job.reason}</p>}
      {job.warnings.length > 0 && (
        <ul className="dispatch-warnings">
          {job.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {job.issues.length > 0 && (
        <ul className="dispatch-issues">
          {job.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      {active && (
        <div className="designer-actions">
          <button type="button" className="is-danger" onClick={onAbort}>
            Abort
          </button>
        </div>
      )}
    </li>
  );
}

export function DispatchApp() {
  const layoutQuery = useLayoutQuery();
  const consistsQuery = useConsistsQuery();
  const info = useDispatchInfo();
  const dispatch = useDispatchMutation();
  const abort = useAbortMutation();
  const setTurnout = useSetTurnoutMutation();
  const setLayout = useLiveStore((s) => s.setLayout);
  const setConsists = useLiveStore((s) => s.setConsists);
  const trains = useLiveStore((s) => s.trains);
  const jobs = useLiveStore((s) => s.dispatchJobs);
  const safety = useLiveStore((s) => s.safety);
  const layoutLoaded = useLiveStore((s) => s.layoutLoaded);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [consistId, setConsistId] = useState('');
  const [station, setStation] = useState('');
  const [speedStep, setSpeedStep] = useState(40);
  const [allowReverse, setAllowReverse] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useLiveSocket();

  useEffect(() => {
    if (layoutQuery.data) setLayout(layoutQuery.data);
  }, [layoutQuery.data, setLayout]);
  useEffect(() => {
    if (consistsQuery.data) setConsists(consistsQuery.data);
  }, [consistsQuery.data, setConsists]);
  useEffect(() => {
    if (!layoutLoaded) return;
    const el = canvasRef.current;
    useLiveStore.getState().fitToContent(el?.clientWidth ?? 800, el?.clientHeight ?? 600);
  }, [layoutLoaded]);

  const consists = consistsQuery.data ?? [];
  const stations = info.data?.stations ?? [];
  const allJobs = jobs.length ? jobs : info.data?.jobs ?? [];
  const nameOf = (id: string) => consists.find((c) => c.id === id)?.name ?? id;

  const submit = async () => {
    setError(null);
    if (!consistId || !station) {
      setError('Choose a train and a station');
      return;
    }
    try {
      const job = await dispatch.mutateAsync({ consistId, station, speedStep, allowReverse });
      if (job.state === 'rejected') setError(`${job.reason ?? 'Rejected'}${job.issues.length ? ` — ${job.issues.join('; ')}` : ''}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="designer-app live-app">
      <div className="designer-toolbar">
        <div className="designer-toolbar-group">
          <span className={`live-badge live-safety-${safety.level.toLowerCase()}`} title={safety.reasons.join('\n')}>
            {safety.level}
          </span>
          <span className="designer-muted">Dispatch: send a train to a station. Every job is dry-run before anything moves.</span>
        </div>
      </div>
      <div className="designer-main live-main">
        <div className="designer-center" ref={canvasRef}>
          <LiveCanvas onToggleTurnout={(pieceId, state) => setTurnout.mutate({ pieceId, state })} />
        </div>
        <aside className="designer-right">
          <section className="designer-inspector-section">
            <h3>New job</h3>
            <label className="designer-field">
              <span>Train</span>
              <select value={consistId} onChange={(e) => setConsistId(e.target.value)}>
                <option value="">Choose…</option>
                {consists.map((c) => {
                  const live = trains.get(c.id);
                  return (
                    <option key={c.id} value={c.id} disabled={!live?.pose}>
                      {c.name} · {c.totalLengthMm} mm, {c.units.length === 1 ? 'loco only' : `${c.units.length} units`} {live?.pose ? `(${live.state}${live.pose.confidence < 0.8 ? ', unconfirmed' : ''})` : '(not on layout)'}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="designer-field">
              <span>Station</span>
              <select value={station} onChange={(e) => setStation(e.target.value)}>
                <option value="">Choose…</option>
                {stations.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} · {s.platforms.length} platform{s.platforms.length === 1 ? '' : 's'} ({s.platforms.map((p) => `${Math.round(p.lengthMm)} mm`).join(', ')})
                  </option>
                ))}
              </select>
            </label>
            {stations.length === 0 && <p className="designer-muted">No stations yet: in the Designer, create a destination and tick “Station”.</p>}
            <label className="designer-field">
              <span>Speed step {speedStep} / 126</span>
              <input type="range" min={1} max={126} value={speedStep} onChange={(e) => setSpeedStep(Number(e.target.value))} />
            </label>
            <label className="designer-check">
              <input type="checkbox" checked={allowReverse} onChange={(e) => setAllowReverse(e.target.checked)} /> Allow driving tail first
            </label>
            {error && <p className="designer-error">{error}</p>}
            <div className="designer-actions">
              <button type="button" onClick={submit} disabled={dispatch.isPending}>
                Dispatch
              </button>
            </div>
          </section>
          <section className="designer-inspector-section">
            <h3>
              Jobs <small>{allJobs.length}</small>
            </h3>
            {allJobs.length === 0 ? (
              <p className="designer-muted">No jobs yet.</p>
            ) : (
              <ul className="dispatch-jobs">
                {allJobs.map((job) => (
                  <JobCard key={job.id} job={job} consistName={nameOf(job.consistId)} onAbort={() => abort.mutate(job.id)} />
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
