import { useEffect, useRef, useState } from 'react';
import { InfoTooltip } from '../common/InfoTooltip.jsx';

export function LogPanel({ socket, commandLog, onClearLog }) {
  const [cmd, setCmd] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    if (!logRef.current) {
      return;
    }
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [commandLog]);

  const send = () => {
    const command = cmd.trim();
    if (!command) {
      return;
    }
    socket.emit('dcc:send', command);
    setCmd('');
  };

  const resend = (command) => {
    setCmd(command);
  };

  const getRawSendValue = (internal) => {
    const payload = internal.replace(/^dcc:send /, '');
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row">
        <input
          type="text"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          className="w-full rounded border border-gray-300 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Type DCC command..."
        />
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 active:bg-blue-800"
            onClick={send}
          >
            Send command
          </button>
        </div>
      </div>
      <div className="rounded border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-200">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-semibold text-slate-100">Session command log</div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-400">{commandLog.length} entries</div>
            <button
              type="button"
              className="rounded border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:bg-slate-700"
              onClick={onClearLog}
            >
              Clear log
            </button>
          </div>
        </div>
        {commandLog.length === 0 ? (
          <div className="text-slate-400">No commands sent yet.</div>
        ) : (
          <div ref={logRef} className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {commandLog.map((entry) => (
              <div
                key={entry.id}
                className="rounded border border-slate-700/80 bg-slate-950/40 px-2 py-1.5 text-xs"
              >
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                  <span
                    className={
                      entry.type === 'send'
                        ? 'rounded border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-blue-300'
                        : 'rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300'
                    }
                  >
                    {entry.type === 'send' ? 'SENT' : 'RECV'}
                  </span>
                  <span>{entry.time}</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <div className="break-all font-mono text-slate-100">
                    {(entry.raw || entry.text || '')}
                  </div>
                  {entry.type === 'send' && entry.internal ? (
                    <InfoTooltip text={entry.internal} />
                  ) : null}
             
                </div>
                {entry.type === 'send' && entry.internal?.startsWith('dcc:send ') ? (
                  <button
                    type="button"
                    onClick={() => resend(getRawSendValue(entry.internal))}
                    className="mt-1 text-[11px] font-medium text-amber-300 hover:text-amber-200"
                  >
                    Reuse
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
