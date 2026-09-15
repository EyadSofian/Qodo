/**
 * Voice-over review: a waveform to see and click through the recording, review
 * markers on it, comments at a moment or over a range, and the transcript.
 */

import { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, Mic } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { lp, paths } from '../../../lib/learningProduction/api';
import { lpErrorKey } from '../../../lib/learningProduction/format';
import { formatTimecode } from '@shared/learningProduction/review';
import type { Transcript } from '../../../lib/learningProduction/types';
import { Spinner, useToast } from '../../ui';
import { EmptyPanel, Section } from '../kit';
import { useAsset, useViewedVersion } from './AssetContext';
import { CommentComposer } from './CommentComposer';
import { MarkerTrack, PlayerControls, useMediaState, useRange } from './MediaTools';

const BARS = 480;

// Mirrors tailwind.config.js `colors.stage.voice`/`voiceBg` — canvas drawing
// can't reach a Tailwind class, so the two literal hex values live here.
const PLAYED_COLOR = '#0284C7';
const UNPLAYED_COLOR = '#BAE6FD';

/** Peaks for the waveform. Decoding a very long file in the browser is refused, and the plain timeline is shown instead. */
async function peaksFor(url: string): Promise<number[] | null> {
  const response = await fetch(url, { credentials: 'same-origin' });
  const size = Number(response.headers.get('content-length') ?? 0);
  if (!response.ok || size > 60 * 1024 * 1024) return null;
  const bytes = await response.arrayBuffer();
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Context();
  try {
    const audio = await context.decodeAudioData(bytes);
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BARS));
    const peaks: number[] = [];
    for (let bar = 0; bar < BARS; bar += 1) {
      let peak = 0;
      for (let index = bar * step; index < Math.min(data.length, (bar + 1) * step); index += 16) {
        peak = Math.max(peak, Math.abs(data[index]));
      }
      peaks.push(peak);
    }
    const top = Math.max(0.01, ...peaks);
    return peaks.map((value) => value / top);
  } finally {
    void context.close();
  }
}

export function AudioReviewer() {
  const { t } = useI18n();
  const { detail, comments, addComment, focus, focusComment } = useAsset();
  const version = useViewedVersion();
  const audio = useRef<HTMLAudioElement>(null);
  const media = useMediaState(audio);
  const range = useRange(media);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [composing, setComposing] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const src = version ? paths.file(version.id) : null;

  useEffect(() => {
    setPeaks(null);
    if (!src) return;
    let alive = true;
    peaksFor(src)
      .then((result) => alive && setPeaks(result))
      .catch(() => alive && setPeaks(null));
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !peaks) return;
    const width = element.clientWidth;
    const height = element.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    element.width = width * ratio;
    element.height = height * ratio;
    const context = element.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const played = media.duration ? media.time / media.duration : 0;
    const barWidth = width / peaks.length;
    peaks.forEach((peak, index) => {
      const barHeight = Math.max(2, peak * (height - 6));
      context.fillStyle = index / peaks.length <= played ? PLAYED_COLOR : UNPLAYED_COLOR;
      context.fillRect(index * barWidth, (height - barHeight) / 2, Math.max(1, barWidth - 1), barHeight);
    });
  }, [peaks, media.time, media.duration]);

  useEffect(() => {
    const marker = focus?.comment.audioMarker;
    if (marker) media.seek(marker.startSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  if (!version || !src) {
    return (
      <EmptyPanel
        icon={<Mic size={26} />}
        title={t('lp.voice.emptyTitle')}
        body={detail.evaluation.actions.START.allowed ? t('lp.voice.emptyStart') : detail.evaluation.blocked ? t('lp.voice.emptyBlocked') : t('lp.voice.emptyBody')}
      />
    );
  }

  const markers = (comments?.comments ?? []).filter((comment) => comment.versionId === version.id && comment.audioMarker);

  return (
    <div className="space-y-3">
      <Section>
        <audio ref={audio} src={src} preload="metadata" />
        <PlayerControls media={media}>
          {comments?.canComment && (
            <>
              {range.start !== null && range.end === null && (
                <button type="button" className="btn-ghost btn-sm" onClick={range.endAt}>
                  {t('lp.media.endRange', { time: formatTimecode(media.time) })}
                </button>
              )}
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => {
                  if (range.start === null) range.beginAt(media.time);
                  media.seek(media.time, true);
                  setComposing(true);
                }}
              >
                <MessageSquarePlus size={14} />
                {t('lp.media.commentAt', { time: formatTimecode(range.start ?? media.time) })}
              </button>
            </>
          )}
        </PlayerControls>

        <div
          className="relative mt-3 h-24 cursor-pointer overflow-hidden rounded-xl bg-surface-bg"
          dir="ltr"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            media.seek(((event.clientX - rect.left) / rect.width) * media.duration);
          }}
          role="slider"
          aria-label={t('lp.media.seek')}
          aria-valuemin={0}
          aria-valuemax={Math.round(media.duration)}
          aria-valuenow={Math.round(media.time)}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') media.seek(media.time + 5);
            if (event.key === 'ArrowLeft') media.seek(media.time - 5);
            if (event.key === ' ') {
              event.preventDefault();
              media.toggle();
            }
          }}
        >
          {peaks ? (
            <canvas ref={canvas} className="h-full w-full" />
          ) : (
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-stage-voiceBg">
              <span className="block h-full rounded-full bg-stage-voice" style={{ width: `${media.duration ? (media.time / media.duration) * 100 : 0}%` }} />
            </div>
          )}
          <MarkerTrack comments={markers} duration={media.duration} kind="audio" activeId={focus?.comment.id} onPick={focusComment} />
          {range.start !== null && media.duration > 0 && (
            <span className="pointer-events-none absolute top-0 h-full bg-navy/10" style={{ left: `${(range.start / media.duration) * 100}%`, width: `${(((range.end ?? media.time) - range.start) / media.duration) * 100}%` }} />
          )}
        </div>

        {composing && range.start !== null && (
          <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
            <CommentComposer
              compact
              autoFocus
              context={range.end ? `${formatTimecode(range.start)} → ${formatTimecode(range.end)}` : formatTimecode(range.start)}
              onCancel={() => {
                setComposing(false);
                range.clear();
              }}
              onSubmit={async (body) => {
                const created = await addComment({ body, commentType: 'AUDIO_TIMESTAMP', marker: { startSeconds: range.start!, endSeconds: range.end } });
                if (created) {
                  setComposing(false);
                  range.clear();
                }
                return Boolean(created);
              }}
              extra={range.end === null ? <p className="text-[12px] text-ink-faint">{t('lp.media.rangeHint')}</p> : null}
            />
          </div>
        )}

        {markers.length > 0 && (
          <ul className="mt-3 divide-y divide-surface-line rounded-xl border border-surface-line">
            {[...markers]
              .sort((a, b) => a.audioMarker!.startSeconds - b.audioMarker!.startSeconds)
              .map((comment) => (
                <li key={comment.id}>
                  <button type="button" className="flex w-full items-start gap-3 px-3 py-2 text-start text-[13px] hover:bg-surface-bg" onClick={() => focusComment(comment)}>
                    <span className="ltr shrink-0 font-semibold tabular-nums text-brand-600">
                      {formatTimecode(comment.audioMarker!.startSeconds)}
                      {comment.audioMarker!.endSeconds ? ` → ${formatTimecode(comment.audioMarker!.endSeconds)}` : ''}
                    </span>
                    <span className={comment.status === 'RESOLVED' ? 'text-ink-faint line-through' : 'text-ink'}>{comment.body}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </Section>

      <TranscriptPanel versionId={version.id} onSeek={(seconds) => media.seek(seconds)} />
    </div>
  );
}

function TranscriptPanel({ versionId, onSeek }: { versionId: string; onSeek: (seconds: number) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [state, setState] = useState<{ transcript: Transcript | null; canEdit: boolean } | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void lp.transcript(versionId).then((result) => {
      if (!alive) return;
      setState(result);
      setBody(result.transcript?.body ?? '');
    });
    return () => {
      alive = false;
    };
  }, [versionId]);

  if (!state) return null;
  const segments = state.transcript?.segments ?? [];

  return (
    <Section title={t('lp.voice.transcript')}>
      {segments.length > 0 ? (
        <p className="text-[14px] leading-loose text-ink">
          {segments.map((segment, index) => (
            <button key={index} type="button" className="me-1 rounded px-0.5 text-start hover:bg-brand-50" onClick={() => onSeek(segment.startSeconds)} title={formatTimecode(segment.startSeconds)}>
              {segment.text}
            </button>
          ))}
        </p>
      ) : state.canEdit ? (
        <>
          <textarea className="field min-h-[120px] text-[14px] leading-relaxed" value={body} onChange={(event) => setBody(event.target.value)} placeholder={t('lp.voice.transcriptPlaceholder')} />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[12px] text-ink-faint">{t('lp.voice.transcriptHint')}</span>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy || body === (state.transcript?.body ?? '')}
              onClick={async () => {
                setBusy(true);
                try {
                  const saved = await lp.saveTranscript(versionId, body, []);
                  setState({ ...state, transcript: saved.transcript });
                  toast.push(t('lp.toast.saved'));
                } catch (error) {
                  toast.push(t(lpErrorKey(error)), 'bad');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Spinner size={14} />}
              {t('common.save')}
            </button>
          </div>
        </>
      ) : body ? (
        <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink">{body}</p>
      ) : (
        <p className="text-[13px] text-ink-faint">{t('lp.voice.noTranscript')}</p>
      )}
    </Section>
  );
}
