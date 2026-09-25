import type { ReactNode } from 'react';
import { AlertTriangle, Lock, SearchX } from 'lucide-react';
import { errorMessage } from '../../../lib/api';
import { cx } from '../../../lib/utils';
import { isForbidden } from '../api';
import { useHRText } from '../format';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-xl', className)} aria-hidden="true" />;
}

export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-5" aria-busy="true">
      <Skeleton className="h-16 w-full max-w-lg" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24" />)}
      </div>
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-40" />)}
    </div>
  );
}

export function EmptyBlock({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-[rgb(var(--hr-a1)/0.3)] bg-white/55 px-6 py-10 text-center backdrop-blur">
      <span className="hr-float grid h-14 w-14 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgb(var(--hr-a1)/0.16),rgb(var(--hr-a2)/0.16))] text-[rgb(var(--hr-a1))]">{icon ?? <SearchX size={24} />}</span>
      <p className="text-[14px] font-bold text-navy">{title}</p>
      {body && <p className="max-w-sm text-[12.5px] leading-6 text-[#5A6C82]">{body}</p>}
      {action}
    </div>
  );
}

/** A load failure, told apart from a refusal — "you may not see this" is not "something broke". */
export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, lang } = useHRText();
  if (isForbidden(error)) {
    return (
      <EmptyBlock
        icon={<Lock size={24} />}
        title={t('هذه الصفحة خارج صلاحياتك', 'This page is outside your access')}
        body={t('اطلب من مدير النظام منحك الصلاحية المناسبة من شاشة المستخدمين.', 'Ask an administrator to grant the right permission from the Users screen.')}
      />
    );
  }
  return (
    <EmptyBlock
      icon={<AlertTriangle size={24} />}
      title={t('تعذّر تحميل البيانات', 'Could not load this')}
      body={errorMessage(error, lang)}
      action={onRetry ? <button type="button" className="btn-ghost btn-sm mt-2" onClick={onRetry}>{t('إعادة المحاولة', 'Try again')}</button> : undefined}
    />
  );
}
