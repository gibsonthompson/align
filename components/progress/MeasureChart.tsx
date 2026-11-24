'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDaysISO, mondayOf, shortDate } from '@/lib/format';
import { fmtValue } from '@/lib/habits';
import type { Measure, MeasureLog } from '@/lib/types';

type Pt = { key: string; label: string; value: number };

// Levels (weight, savings) draw a line of logged values. Totals (miles, pages) draw
// one bar per week or month. The target is a dashed reference line, not a series.
export default function MeasureChart({ m, logs, today, height = 132 }: { m: Measure; logs: MeasureLog[]; today: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const bars = m.kind === 'total';
  const pts: Pt[] = useMemo(() => {
    if (!bars) {
      const byDay = new Map<string, number>();
      for (const l of [...logs].sort((a, b) => a.day.localeCompare(b.day) || a.created_at.localeCompare(b.created_at))) byDay.set(l.day, Number(l.value));
      return [...byDay].slice(-60).map(([d, v]) => ({ key: d, label: shortDate(d), value: v }));
    }
    if (m.period === 'month') {
      const out: Pt[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(`${today.slice(0, 8)}01T12:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() - i);
        const key = d.toISOString().slice(0, 7);
        out.push({ key, label: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), value: logs.filter((l) => l.day.slice(0, 7) === key).reduce((n, l) => n + Number(l.value), 0) });
      }
      return out;
    }
    // Weekly totals for weekly measures, and for running totals too (the line of the whole is less useful than the rhythm).
    const out: Pt[] = [];
    const thisWeek = mondayOf(today);
    for (let i = 11; i >= 0; i--) {
      const wk = addDaysISO(thisWeek, -7 * i);
      const end = addDaysISO(wk, 6);
      out.push({ key: wk, label: shortDate(wk), value: logs.filter((l) => l.day >= wk && l.day <= end).reduce((n, l) => n + Number(l.value), 0) });
    }
    return out;
  }, [logs, bars, m.period, today]);

  const target = m.target_value !== null && (bars ? m.period !== 'all' : true) ? Number(m.target_value) : null;
  const L = 44;
  const R = 10;
  const T = 10;
  const B = 20;
  const iw = Math.max(0, w - L - R);
  const ih = height - T - B;

  if (!pts.length || (!bars && pts.length < 1)) {
    return (
      <div ref={ref} className="mchart-empty" style={{ height }}>
        No entries yet. Log the first one below.
      </div>
    );
  }

  const values = pts.map((p) => p.value);
  const start = !bars && m.start_value !== null ? [Number(m.start_value)] : [];
  const rawLo = Math.min(...values, ...start, ...(target !== null ? [target] : []), ...(bars ? [0] : []));
  const rawHi = Math.max(...values, ...start, ...(target !== null ? [target] : []));
  const { lo, hi, ticks } = niceScale(bars ? 0 : rawLo, rawHi);
  const y = (v: number) => T + ih - ((v - lo) / (hi - lo)) * ih;

  const n = pts.length;
  const step = bars ? iw / n : n > 1 ? iw / (n - 1) : 0;
  const x = (i: number) => (bars ? L + step * i + step / 2 : n > 1 ? L + step * i : L + iw / 2);
  const bw = Math.max(4, Math.min(28, step - 2));

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0;
    let dist = Infinity;
    pts.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setHover(best);
  }

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const h = hover !== null ? pts[hover] : null;

  return (
    <div ref={ref} className="mchart" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`${m.name} over time`}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={L} x2={w - R} y1={y(t)} y2={y(t)} className="mchart-grid" />
              <text x={L - 6} y={y(t) + 3.5} textAnchor="end" className="mchart-axis">
                {fmtValue(t, '')}
              </text>
            </g>
          ))}
          {target !== null && (
            <g>
              <line x1={L} x2={w - R} y1={y(target)} y2={y(target)} className="mchart-target" />
              <text x={w - R} y={y(target) - 4} textAnchor="end" className="mchart-target-label">
                Target {fmtValue(target, m.unit)}
                {bars ? (m.period === 'week' ? ' a week' : ' a month') : ''}
              </text>
            </g>
          )}
          {bars
            ? pts.map((p, i) => {
                const top = y(Math.max(p.value, 0));
                const hgt = Math.max(0, y(0) - top);
                return (
                  <path
                    key={p.key}
                    d={roundedTop(x(i) - bw / 2, top, bw, hgt, Math.min(4, hgt))}
                    className="mchart-bar"
                    data-hit={target !== null && p.value >= target}
                    data-hover={hover === i}
                  />
                );
              })
            : (
              <>
                <path d={line} className="mchart-line" />
                {pts.length <= 24 && pts.map((p, i) => <circle key={p.key} cx={x(i)} cy={y(p.value)} r={n === 1 ? 4.5 : 2.5} className="mchart-dot" />)}
                {n === 1 && (
                  <text x={x(0) + 10} y={y(pts[0].value) + 4} className="mchart-axis">
                    First entry, more draw the line
                  </text>
                )}
              </>
            )}
          {h && hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ih} className="mchart-cross" />
              {!bars && <circle cx={x(hover)} cy={y(h.value)} r={4.5} className="mchart-focus" />}
            </g>
          )}
          <text x={bars ? x(0) : L} y={height - 5} textAnchor={bars ? 'middle' : 'start'} className="mchart-axis">
            {pts[0].label}
          </text>
          {n > 1 && (
            <text x={bars ? x(n - 1) : w - R} y={height - 5} textAnchor={bars ? 'middle' : 'end'} className="mchart-axis">
              {pts[n - 1].label}
            </text>
          )}
        </svg>
      )}
      {h && hover !== null && (
        <div className="mchart-tip" style={{ left: Math.min(Math.max(x(hover), 70), w - 70), top: 0 }}>
          <b>{fmtValue(h.value, m.unit)}</b>
          <span>{bars ? (m.period === 'month' ? h.label : `Week of ${h.label}`) : h.label}</span>
        </div>
      )}
    </div>
  );
}

// Round tick values (1, 2, 2.5, 5 times a power of ten) around the data.
function niceScale(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  if (min === max) {
    const d = Math.abs(min) * 0.1 || 1;
    min -= d;
    max += d;
  }
  const raw = (max - min) / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= raw) ?? 10 * pow;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}
