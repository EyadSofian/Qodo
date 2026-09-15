/**
 * Drawing over a slide or a paused frame.
 *
 * Every shape is stored as fractions of the surface (0 to 1), and drawn by
 * converting those fractions to the surface's current pixels — so a rectangle
 * drawn on a laptop covers the same title on a projector, and a resize never
 * moves an annotation off what it points at.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowUpRight, Circle, Highlighter, MapPin, MousePointer2, PenLine, Redo2, Square, Undo2 } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import type { AnnotationType, Geometry, Shape } from '../../../lib/learningProduction/types';

export type Tool = 'POINTER' | AnnotationType;

export const COLORS = ['#DC2626', '#F5821F', '#1D6FB8', '#16A34A', '#0B2545', '#7C3AED'];

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export interface PlacedShape {
  id: string;
  shape: Shape;
  label?: string | number;
  resolved?: boolean;
  active?: boolean;
  onClick?: () => void;
}

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

function ShapeGraphic({ shape, width, height, faded, active, label, onClick }: { shape: Shape; width: number; height: number; faded?: boolean; active?: boolean; label?: string | number; onClick?: () => void }) {
  const g = shape.geometry;
  const color = shape.color || COLORS[0];
  const px = (value: number) => value * width;
  const py = (value: number) => value * height;
  const common = {
    stroke: color,
    strokeWidth: active ? 3.5 : 2.5,
    fill: 'none',
    opacity: faded ? 0.35 : 1,
    style: { pointerEvents: onClick ? ('visiblePainted' as const) : ('none' as const), cursor: onClick ? 'pointer' : undefined },
    onClick,
  };

  switch (shape.annotationType) {
    case 'RECTANGLE':
      return <rect x={px(g.x)} y={py(g.y)} width={px(g.width ?? 0)} height={py(g.height ?? 0)} rx={3} {...common} />;
    case 'HIGHLIGHT':
      return <rect x={px(g.x)} y={py(g.y)} width={px(g.width ?? 0)} height={py(g.height ?? 0)} {...common} stroke="none" fill={color} fillOpacity={faded ? 0.12 : 0.28} />;
    case 'CIRCLE':
      return <ellipse cx={px(g.x + (g.width ?? 0) / 2)} cy={py(g.y + (g.height ?? 0) / 2)} rx={px((g.width ?? 0) / 2)} ry={py((g.height ?? 0) / 2)} {...common} />;
    case 'ARROW': {
      const [[x1, y1], [x2, y2]] = g.points ?? [[g.x, g.y], [g.x, g.y]];
      const ax = px(x1);
      const ay = py(y1);
      const bx = px(x2);
      const by = py(y2);
      const angle = Math.atan2(by - ay, bx - ax);
      const head = 12;
      const left = `${bx - head * Math.cos(angle - 0.45)},${by - head * Math.sin(angle - 0.45)}`;
      const right = `${bx - head * Math.cos(angle + 0.45)},${by - head * Math.sin(angle + 0.45)}`;
      return (
        <g {...common}>
          <line x1={ax} y1={ay} x2={bx} y2={by} />
          <polyline points={`${left} ${bx},${by} ${right}`} />
        </g>
      );
    }
    case 'FREEHAND':
      return <polyline points={(g.points ?? []).map(([x, y]) => `${px(x)},${py(y)}`).join(' ')} strokeLinecap="round" strokeLinejoin="round" {...common} />;
    case 'PIN':
    default:
      return (
        <g {...common} fill={color} stroke="white" strokeWidth={2}>
          <circle cx={px(g.x)} cy={py(g.y)} r={active ? 13 : 11} />
          {label !== undefined && (
            <text x={px(g.x)} y={py(g.y) + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="white" stroke="none" style={{ pointerEvents: 'none' }}>
              {label}
            </text>
          )}
        </g>
      );
  }
}

/**
 * The surface itself. `drafts` are shapes not yet saved; `onDraw` receives each
 * finished shape. With the pointer tool the surface lets clicks through to the
 * saved shapes, so clicking a pin opens its comment.
 */
export function DrawingSurface({
  placed,
  drafts,
  tool,
  color,
  onDraw,
}: {
  placed: PlacedShape[];
  drafts: Shape[];
  tool: Tool;
  color: string;
  onDraw: (shape: Shape) => void;
}) {
  const { ref, size } = useSize();
  const [live, setLive] = useState<Shape | null>(null);
  const start = useRef<[number, number] | null>(null);

  const point = (event: ReactPointerEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return [clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height)] as [number, number];
  };

  const build = (type: AnnotationType, from: [number, number], to: [number, number], points?: Array<[number, number]>): Shape => {
    let geometry: Geometry;
    if (type === 'ARROW') geometry = { x: from[0], y: from[1], points: [from, to] };
    else if (type === 'FREEHAND') geometry = { x: from[0], y: from[1], points: points ?? [from, to] };
    else if (type === 'PIN') geometry = { x: from[0], y: from[1] };
    else geometry = { x: Math.min(from[0], to[0]), y: Math.min(from[1], to[1]), width: Math.abs(to[0] - from[0]), height: Math.abs(to[1] - from[1]) };
    return { annotationType: type, geometry, color };
  };

  const down = (event: ReactPointerEvent) => {
    if (tool === 'POINTER') return;
    const at = point(event);
    if (tool === 'PIN') {
      onDraw(build('PIN', at, at));
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    start.current = at;
    setLive(build(tool, at, at, [at]));
  };

  const move = (event: ReactPointerEvent) => {
    if (!start.current || tool === 'POINTER' || tool === 'PIN') return;
    const at = point(event);
    if (tool === 'FREEHAND') {
      setLive((current) => {
        const points = current?.geometry.points ?? [start.current!];
        const last = points[points.length - 1];
        if (Math.hypot(at[0] - last[0], at[1] - last[1]) < 0.003 || points.length >= 2000) return current;
        return build('FREEHAND', start.current!, at, [...points, at]);
      });
    } else {
      setLive(build(tool, start.current, at));
    }
  };

  const up = () => {
    if (!start.current || !live) return;
    start.current = null;
    const g = live.geometry;
    const bigEnough =
      live.annotationType === 'FREEHAND'
        ? (g.points?.length ?? 0) >= 2
        : live.annotationType === 'ARROW'
          ? Math.hypot((g.points?.[1][0] ?? 0) - g.x, (g.points?.[1][1] ?? 0) - g.y) > 0.01
          : (g.width ?? 0) > 0.005 && (g.height ?? 0) > 0.005;
    if (bigEnough) onDraw(live);
    setLive(null);
  };

  return (
    <div
      ref={ref}
      className={cx('absolute inset-0', tool === 'POINTER' ? 'pointer-events-none' : 'cursor-crosshair touch-none')}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        start.current = null;
        setLive(null);
      }}
    >
      {size.width > 0 && (
        <svg width={size.width} height={size.height} className="absolute inset-0 overflow-visible" style={{ pointerEvents: 'none' }} aria-hidden="true">
          {placed.map((item) => (
            <ShapeGraphic key={item.id} shape={item.shape} width={size.width} height={size.height} faded={item.resolved} active={item.active} label={item.label} onClick={tool === 'POINTER' ? item.onClick : undefined} />
          ))}
          {drafts.map((shape, index) => (
            <ShapeGraphic key={`draft-${index}`} shape={shape} width={size.width} height={size.height} active label={shape.annotationType === 'PIN' ? '+' : undefined} />
          ))}
          {live && <ShapeGraphic shape={live} width={size.width} height={size.height} active />}
        </svg>
      )}
    </div>
  );
}

const TOOLS: Array<{ tool: Tool; icon: typeof Square }> = [
  { tool: 'POINTER', icon: MousePointer2 },
  { tool: 'PIN', icon: MapPin },
  { tool: 'RECTANGLE', icon: Square },
  { tool: 'CIRCLE', icon: Circle },
  { tool: 'ARROW', icon: ArrowUpRight },
  { tool: 'FREEHAND', icon: PenLine },
  { tool: 'HIGHLIGHT', icon: Highlighter },
];

export function DrawingToolbar({
  tool,
  onTool,
  color,
  onColor,
  tools = TOOLS.map((entry) => entry.tool),
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  color: string;
  onColor: (color: string) => void;
  tools?: Tool[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label={t('lp.draw.toolbar')}>
      {TOOLS.filter((entry) => tools.includes(entry.tool)).map(({ tool: value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={tool === value}
          aria-label={t(`lp.draw.${value}` as never)}
          title={t(`lp.draw.${value}` as never)}
          onClick={() => onTool(value)}
          className={cx('grid h-8 w-8 place-items-center rounded-lg', tool === value ? 'bg-navy text-white' : 'text-ink-muted hover:bg-surface-sunken')}
        >
          <Icon size={15} />
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-surface-line" aria-hidden="true" />
      {COLORS.map((value) => (
        <button
          key={value}
          type="button"
          aria-label={t('lp.draw.color')}
          aria-pressed={color === value}
          onClick={() => onColor(value)}
          className={cx('h-5 w-5 rounded-full border-2', color === value ? 'border-navy' : 'border-white shadow-[0_0_0_1px_#E6ECF3]')}
          style={{ background: value }}
        />
      ))}
      <span className="mx-1 h-5 w-px bg-surface-line" aria-hidden="true" />
      <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-surface-sunken disabled:opacity-40" onClick={onUndo} disabled={!canUndo} aria-label={t('lp.draw.undo')}>
        <Undo2 size={15} />
      </button>
      <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-surface-sunken disabled:opacity-40" onClick={onRedo} disabled={!canRedo} aria-label={t('lp.draw.redo')}>
        <Redo2 size={15} />
      </button>
    </div>
  );
}

/** Unsaved shapes with undo and redo. */
export function useDrafts(limit = 50) {
  const [drafts, setDrafts] = useState<Shape[]>([]);
  const [redo, setRedo] = useState<Shape[]>([]);
  return {
    drafts,
    add: (shape: Shape) => {
      setDrafts((list) => [...list, shape].slice(-limit));
      setRedo([]);
    },
    undo: () =>
      setDrafts((list) => {
        if (!list.length) return list;
        setRedo((stack) => [...stack, list[list.length - 1]]);
        return list.slice(0, -1);
      }),
    redo: () =>
      setRedo((stack) => {
        if (!stack.length) return stack;
        setDrafts((list) => [...list, stack[stack.length - 1]]);
        return stack.slice(0, -1);
      }),
    canRedo: redo.length > 0,
    clear: () => {
      setDrafts([]);
      setRedo([]);
    },
  };
}
