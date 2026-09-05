import { useMemo } from 'react';
import { validateLayout } from '../lib/validate.ts';
import { useEditorStore } from '../store/editorStore.ts';

export function ValidationPanel() {
  const index = useEditorStore((s) => s.index);
  const select = useEditorStore((s) => s.select);
  const issues = useMemo(() => validateLayout(index), [index]);

  return (
    <section className="designer-validation">
      <h3>
        Checks <small>{issues.length ? `${issues.length}` : 'all good'}</small>
      </h3>
      {issues.length === 0 ? (
        <p className="designer-muted">Every joint closes exactly and no open ends remain.</p>
      ) : (
        <ul>
          {issues.map((issue) => (
            <li key={issue.id} className={`is-${issue.severity}`}>
              <button
                type="button"
                onClick={() => {
                  if (issue.pieceId) select({ pieceIds: [issue.pieceId] });
                  else if (issue.jointId) select({ jointId: issue.jointId });
                }}
              >
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
