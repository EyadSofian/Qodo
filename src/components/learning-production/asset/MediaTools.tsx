/**
 * What the audio and video reviewers share: player controls, a timeline with
 * the review markers on it, and the moment-or-range comment box.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { formatTimecode } from '@shared/learningProduction/review';
import type { ReviewComment } from '../../../lib/learningProduction/types';

export function useMediaState(ref: RefObject<HTMLMediaElement>) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    const onTime = () => setTime(media.currentTime);
    const onMeta = () => setDuration(Number.isFinite(media.duration) ? media.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    media.addEventListener('timeupdate', onTime);
    media.addEventListener('loadedmetadata', onMeta);
    media.addEventListener('durationchange', onMeta);
    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);
    return () => {
      media.removeEventListener('timeupdate', onTime);
      media.removeEventListener('loadedmetadata', onMeta);
      media.removeEventListener('durationchange', onMeta);
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
    };
  }, [ref]);

  return {
    time,
    duration,
    playing,
    rate,
    toggle: () => {
      const media = ref.current;
      if (!media) return;
      if (media.paused) void media.play();
      else media.pause();
    },
    seek: (seconds: number, pause = false) => {
      const media = ref.current;
      if (!media) return;
      media.currentTime = Math.max(0, Math.min(seconds, media.duration || seconds));
      setTime(media.currentTime);
      if (pause) media.pause();
    },
    setRate: (value: number) => {
      if (ref.current) ref.current.playbackRate = value;
      setRate(value);
    },
  };
}

export type MediaState = ReturnType<typeof useMediaState>;

export function PlayerControls({ media, children }: { media: MediaState; children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2" dir="ltr">
      <button type="button" className="btn-navy !min-h-9 !w-9 !px-0" onClick={media.toggle} aria-label={media.playing ? t('lp.media.pause') : t('lp.media.play')}>
        {media.playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <button type="button" className="btn-quiet !min-h-9 rounded-lg px-1.5" onClick={() => media.seek(media.time - 5)} aria-label={t('lp.media.back5')}>
        <RotateCcw size={15} />
      </button>
      <button type="button" className="btn-quiet !min-h-9 rounded-lg px-1.5" onClick={() => media.seek(media.time + 5)} aria-label={t('lp.media.forward5')}>
        <RotateCw size={15} />
      </button>
      <span className="text-[13px] font-semibold tabular-nums text-ink">
        {formatTimecode(media.time)} <span className="font-normal text-ink-faint">/ {formatTimecode(media.duration)}</span>
      </span>
      <select className="field !min-h-8 !w-auto !py-0.5 text-[12.5px]" value={media.rate} onChange={(event) => media.setRate(Number(event.target.value))} aria-label={t('lp.media.speed')}>
        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
          <option key={value} value={value}>
            {value}×
          </option>
        ))}
      </select>
      <div className="ms-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Review markers as ticks and ranges on a timeline. Clicking one opens its comment. */
export function MarkerTrack({
  comments,
  duration,
  activeId,
  kind,
  onPick,
}: {
  comments: ReviewComment[];
  duration: number;
  activeId?: string;
  kind: 'audio' | 'video';
  onPick: (comment: ReviewComment) => void;
}) {
  const { t } = useI18n();
  if (!duration) return null;
  return (
    <div className="pointer-events-none absolute inset-0" dir="ltr">
      {comments.map((comment) => {
        const marker = kind === 'audio' ? comment.audioMarker : comment.videoMarker;
        if (!marker) return null;
        const left = (marker.startSeconds / duration) * 100;
        const width = marker.endSeconds ? Math.max(0.6, ((marker.endSeconds - marker.startSeconds) / duration) * 100) : 0;
        return (
          <button
            key={comment.id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPick(comment);
            }}
            title={`${formatTimecode(marker.startSeconds)} · ${comment.body}`}
            aria-label={t('lp.media.markerAt', { time: formatTimecode(marker.startSeconds) })}
            className={cx(
              'pointer-events-auto absolute top-0 h-full rounded-sm',
              comment.status === 'RESOLVED' ? 'bg-status-ok/40' : 'bg-accent-500/70',
              activeId === comment.id && 'ring-2 ring-navy'
            )}
            style={{ left: `${left}%`, width: width ? `${width}%` : 4, marginLeft: width ? 0 : -2 }}
          />
        );
      })}
    </div>
  );
}

/** "Comment at 01:14", with an optional end to make it a range. */
export function useRange(media: MediaState) {
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const holder = useRef({ start, end });
  holder.current = { start, end };
  return {
    start,
    end,
    beginAt: (seconds: number) => {
      setStart(Math.round(seconds * 1000) / 1000);
      setEnd(null);
    },
    endAt: () => {
      if (holder.current.start === null) return;
      const value = Math.round(media.time * 1000) / 1000;
      if (value > holder.current.start) setEnd(value);
    },
    clear: () => {
      setStart(null);
      setEnd(null);
    },
  };
}
