import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Field, Modal, Spinner, useToast } from './ui';

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { push } = useToast();
  const { t, lang } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError('');
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (next.length < 8) return setError(t('auth.passwordTooShort'));
    if (next !== confirm) return setError(t('auth.passwordMismatch'));

    setSaving(true);
    try {
      await api.post('/auth/password', { currentPassword: current, newPassword: next });
      push(t('auth.passwordChanged'));
      close();
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('auth.changePassword')}
      width="sm"
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="change-password" className="btn-primary btn-sm" disabled={saving}>
            {saving && <Spinner size={15} />}
            {t('common.save')}
          </button>
        </>
      }
    >
      <form id="change-password" onSubmit={submit} className="grid gap-3">
        <Field label={t('auth.currentPassword')} required>
          <input
            type="password"
            className="field"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label={t('auth.newPassword')} hint={t('auth.passwordHint')} required>
          <input
            type="password"
            className="field"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label={t('auth.confirmPassword')} error={error} required>
          <input
            type="password"
            className="field"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
      </form>
    </Modal>
  );
}
