/**
 * Create a project.
 *
 * The form is deliberately short. Zoho's create dialog offers a dozen fields
 * and most of them are guesses at creation time — a customer that has not been
 * agreed, a budget that has not been set, a template nobody has written yet.
 * Everything here is either required to open the project or cheap to be wrong
 * about; the rest lives in project settings, where it can be filled in when it
 * is actually known.
 *
 * The key is the one exception: it is shown, editable, and explained, because
 * it is the only field on this form that cannot be changed afterwards.
 */

import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/api';
import { projectsApi } from '../../lib/projects/api';
import type { Project, ProjectAccess } from '../../lib/projects/types';
import { Field, Modal, Spinner } from '../ui';

/**
 * The client-side echo of `deriveKey` in `server/projects/projectService.js`.
 *
 * Duplicated on purpose and knowingly: the server is the authority and will
 * overwrite whatever arrives, but a key field that stays empty until the
 * response comes back gives the person nothing to correct. The two only have to
 * agree closely enough to be a useful suggestion — the server's uniqueness
 * suffix is not modelled here, and does not need to be.
 */
function suggestKey(name: string): string {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  if (!cleaned) return '';
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.length === 1 ? words[0].slice(0, 4) : words.map((word) => word[0]).join('').slice(0, 5);
}

export function ProjectCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const { t, lang } = useI18n();

  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  // Whether the person has taken the key over. Once they have, retyping the
  // name must stop overwriting what they chose.
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [access, setAccess] = useState<ProjectAccess>('private');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A dialog that reopens holding the last attempt is a dialog that creates the
  // same project twice.
  useEffect(() => {
    if (open) return;
    setName('');
    setKey('');
    setKeyTouched(false);
    setDescription('');
    setStartDate('');
    setEndDate('');
    setAccess('private');
    setError(null);
    setSaving(false);
  }, [open]);

  const onNameChange = (value: string) => {
    setName(value);
    if (!keyTouched) setKey(suggestKey(value));
  };

  const datesInverted = Boolean(startDate && endDate && endDate < startDate);
  const canSubmit = name.trim().length > 0 && !datesInverted && !saving;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const { project } = await projectsApi.create({
        name: name.trim(),
        key: key.trim() || undefined,
        description: description.trim(),
        startDate: startDate || null,
        endDate: endDate || null,
        access,
      });
      onCreated(project);
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('projects.new')}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="project-create"
            className="btn-primary btn-sm"
            disabled={!canSubmit}
          >
            {saving && <Spinner size={15} />}
            {saving ? t('projects.creating') : t('common.add')}
          </button>
        </>
      }
    >
      <form id="project-create" onSubmit={submit} className="grid gap-4">
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad"
          >
            {error}
          </p>
        )}

        <Field label={t('projects.field.name')} required>
          <input
            className="field"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            autoFocus
            required
            maxLength={160}
          />
        </Field>

        <Field label={t('projects.field.key')} hint={t('projects.field.keyHint')}>
          <input
            className="field font-mono uppercase"
            value={key}
            onChange={(event) => {
              setKeyTouched(true);
              setKey(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10));
            }}
            maxLength={10}
            inputMode="text"
            // The suggestion is not a placeholder the server will honour if it
            // is left empty — it is what will actually be sent — so it is a
            // value, not a placeholder.
            aria-describedby="project-key-hint"
          />
        </Field>

        <Field label={t('projects.field.description')}>
          <textarea
            className="field min-h-[84px] resize-y"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('projects.field.startDate')}>
            <input
              type="date"
              className="field"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field
            label={t('projects.field.endDate')}
            error={datesInverted ? t('projects.error.endBeforeStart') : undefined}
          >
            <input
              type="date"
              className="field"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              // The browser catches the common case immediately; the server
              // still refuses it, because a min attribute is a convenience and
              // not a constraint.
              min={startDate || undefined}
            />
          </Field>
        </div>

        <fieldset className="grid gap-2">
          <legend className="label">{t('projects.field.access')}</legend>
          {(['private', 'portal'] as const).map((option) => (
            <label
              key={option}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                access === option
                  ? 'border-brand-400 bg-brand-50'
                  : 'border-surface-line hover:bg-surface-sunken'
              }`}
            >
              <input
                type="radio"
                name="access"
                className="mt-1"
                checked={access === option}
                onChange={() => setAccess(option)}
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-ink">
                  {t(`projects.access.${option}`)}
                </span>
                <span className="block text-[12px] leading-relaxed text-ink-muted">
                  {t(`projects.access.${option}Hint`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}
