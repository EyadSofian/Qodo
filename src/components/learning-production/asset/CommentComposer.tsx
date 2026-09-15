/**
 * A small box for writing one comment. Ctrl/Cmd+Enter sends; Escape cancels.
 */

import { useState, type ReactNode } from 'react';
import { useI18n } from '../../../lib/i18n';
import { Spinner } from '../../ui';

export function CommentComposer({
  context,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus,
  extra,
  compact,
}: {
  context?: ReactNode;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (body: string) => Promise<boolean | void>;
  onCancel?: () => void;
  autoFocus?: boolean;
  extra?: ReactNode;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const result = await onSubmit(body.trim());
    setBusy(false);
    if (result !== false) setBody('');
  };

  return (
    <div className="space-y-2">
      {context && <div className="text-[12px] font-semibold text-ink-muted">{context}</div>}
      <textarea
        className={compact ? 'field min-h-[64px] text-[13px]' : 'field min-h-[80px] text-[13px]'}
        value={body}
        placeholder={placeholder ?? t('lp.comment.placeholder')}
        autoFocus={autoFocus}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void send();
          }
          if (event.key === 'Escape' && onCancel) {
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      {extra}
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button type="button" className="btn-quiet btn-sm" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
        )}
        <button type="button" className="btn-primary btn-sm" onClick={() => void send()} disabled={!body.trim() || busy}>
          {busy && <Spinner size={14} />}
          {submitLabel ?? t('lp.comment.send')}
        </button>
      </div>
    </div>
  );
}
