/**
 * Open a personnel case. The type decides what is asked: onboarding needs the
 * newcomer and the job, the rest need the employee, and each type adds its own
 * fields. Salary increases and insurance operations appear only for payroll.
 */

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { errorMessage } from '../../../lib/api';
import { cx } from '../../../lib/utils';
import { useWorkspace } from '../../../lib/workspace';
import { Modal, Spinner, useToast } from '../../../components/ui';
import { hrApi, hrMutate, isForbidden, useHRQuery } from '../api';
import { normaliseSearch, useHRText } from '../format';
import { PERSONNEL_TYPE_LABEL } from '../labels';
import { displayName } from '../people/PeopleDirectory';
import type { PeopleData, PersonnelCase, PersonnelType } from '../types';
import { PersonAvatar } from '../ui/primitives';
import { DetailInputs } from './CaseDrawer';
import { DETAIL_FIELDS } from './model';

const ALL_TYPES: PersonnelType[] = ['general', 'onboarding', 'leave', 'clearance', 'documents', 'salary_increase', 'insurance'];
const PAYROLL: PersonnelType[] = ['salary_increase', 'insurance'];

export function NewCaseDialog({ initialType, payroll, peopleAccess, onClose, onCreated }: { initialType: PersonnelType; payroll: boolean; peopleAccess: boolean; onClose: () => void; onCreated: (item: PersonnelCase) => void }) {
  const { t, lang, pick } = useHRText();
  const { push } = useToast();
  const { directory } = useWorkspace();
  const types = ALL_TYPES.filter((type) => payroll || !PAYROLL.includes(type));
  const [type, setType] = useState<PersonnelType>(types.includes(initialType) ? initialType : 'general');
  const [employeeCode, setEmployeeCode] = useState('');
  const [search, setSearch] = useState('');
  const [candidate, setCandidate] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [location, setLocation] = useState('');
  const [managerUserId, setManagerUserId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [details, setDetails] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const people = useHRQuery<PeopleData>(peopleAccess ? hrApi.people : null);
  const employees = people.data?.employees ?? [];
  const chosen = employees.find((employee) => employee.employeeCode === employeeCode) ?? null;
  const matches = useMemo(() => {
    const needle = normaliseSearch(search);
    if (!needle) return [];
    return employees.filter((employee) => normaliseSearch(`${employee.employeeCode} ${employee.nameArabic} ${employee.nameEnglish}`).includes(needle)).slice(0, 6);
  }, [employees, search]);
  const needsEmployee = type !== 'onboarding' && type !== 'general';
  const canSave = !saving && (!needsEmployee || employeeCode.trim()) && (type !== 'onboarding' || jobTitle.trim());

  const save = async () => {
    setSaving(true);
    try {
      const result = await hrMutate<{ case: PersonnelCase }>('post', '/hr/personnel', {
        type,
        employeeCode: employeeCode.trim() || null,
        title: title.trim() || undefined,
        candidate: type === 'onboarding' ? { name: candidate.trim() } : undefined,
        jobTitle: jobTitle.trim() || undefined,
        department: department.trim() || undefined,
        location: location.trim() || undefined,
        managerUserId: managerUserId || null,
        assignedTo: assignedTo || null,
        details,
        notes: notes.trim(),
      });
      push(t('فُتح الطلب.', 'Case opened.'));
      onCreated(result.case);
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title={t('طلب شئون عاملين جديد', 'New personnel case')}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('إلغاء', 'Cancel')}</button><button type="button" className="btn-primary" disabled={!canSave} onClick={() => void save()}>{saving ? <Spinner size={16} /> : <Check size={16} />}{t('فتح الطلب', 'Open case')}</button></>}
    >
      <div className="space-y-4">
        <fieldset>
          <legend className="label">{t('نوع الطلب', 'Case type')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {types.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={type === option}
                onClick={() => {
                  setType(option);
                  setDetails({});
                }}
                className={cx('rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors', type === option ? 'border-navy bg-navy text-white' : 'border-[#E6ECF3] bg-white text-[#5A6C82] hover:border-brand-200 hover:text-navy')}
              >
                {pick(PERSONNEL_TYPE_LABEL[option])}
              </button>
            ))}
          </div>
        </fieldset>

        {type === 'onboarding' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className="label">{t('اسم الموظف الجديد (اختياري — النموذج يستكمله)', 'New hire name (optional — the form fills it in)')}</span><input className="field" value={candidate} onChange={(event) => setCandidate(event.target.value)} /></label>
            <label className="block"><span className="label">{t('المسمى الوظيفي', 'Job title')} *</span><input className="field" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} /></label>
            <label className="block"><span className="label">{t('القسم', 'Department')}</span><input className="field" value={department} onChange={(event) => setDepartment(event.target.value)} /></label>
            <label className="block"><span className="label">{t('الموقع', 'Location')}</span><input className="field" value={location} onChange={(event) => setLocation(event.target.value)} /></label>
          </div>
        ) : (
          <div>
            <span className="label">{t('الموظف', 'Employee')}{needsEmployee ? ' *' : ''}</span>
            {chosen ? (
              <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
                <PersonAvatar name={displayName(chosen, lang)} photoUrl={chosen.photoUrl} size={32} />
                <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-navy">{displayName(chosen, lang)}</p><p className="truncate text-[11.5px] text-[#5A6C82]">#{chosen.employeeCode} · {chosen.title || '—'}</p></div>
                <button type="button" className="btn-quiet btn-sm !min-h-8" onClick={() => setEmployeeCode('')}>{t('تغيير', 'Change')}</button>
              </div>
            ) : peopleAccess && !isForbidden(people.error) ? (
              <div className="relative">
                <input className="field" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('ابحث بالاسم أو الكود…', 'Search by name or code…')} aria-label={t('بحث عن موظف', 'Find an employee')} />
                {matches.length > 0 && (
                  <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-[#E6ECF3] bg-white shadow-lift">
                    {matches.map((employee) => (
                      <li key={employee.employeeCode}>
                        <button type="button" className="flex w-full items-center gap-2.5 px-3 py-2 text-start hover:bg-[#F6F8FB]" onClick={() => { setEmployeeCode(employee.employeeCode); setSearch(''); }}>
                          <PersonAvatar name={displayName(employee, lang)} photoUrl={employee.photoUrl} size={28} />
                          <span className="min-w-0"><span className="hr-bidi block truncate text-[13px] font-semibold text-navy">{displayName(employee, lang)}</span><span className="block truncate text-[11.5px] text-[#5A6C82]">#{employee.employeeCode} · {employee.department || '—'}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <input className="field ltr" value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value.trim())} placeholder={t('كود الموظف', 'Employee code')} aria-label={t('كود الموظف', 'Employee code')} />
            )}
          </div>
        )}

        <DetailInputs fields={DETAIL_FIELDS[type]} values={details} onChange={(key, value) => setDetails((current) => ({ ...current, [key]: value }))} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">{t('المدير المباشر', 'Direct manager')}</span>
            <select className="field" value={managerUserId} onChange={(event) => setManagerUserId(event.target.value)}>
              <option value="">—</option>
              {directory.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">{t('مسؤول شئون العاملين', 'Personnel owner')}</span>
            <select className="field" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
              <option value="">—</option>
              {directory.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </label>
          <label className="block sm:col-span-2"><span className="label">{t('عنوان مختصر (اختياري)', 'Short title (optional)')}</span><input className="field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} /></label>
          <label className="block sm:col-span-2"><span className="label">{t('ملاحظات', 'Notes')}</span><textarea className="field min-h-[72px]" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} /></label>
        </div>
      </div>
    </Modal>
  );
}
