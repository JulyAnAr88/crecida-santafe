import { useState } from 'react';
import { fmtM } from '../lib/format.js';

export default function AnualesChart({ anios, umbrales, onSelect, anioActual, lo = 2.5, hi = 7.6 }) {
  const [hover, setHover] = useState(null);
  const W = 320;
  const H = 104;
  const pad = { l: 8, r: 8, t: 12, b: 16 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = anios.length;
  const bw = innerW / n;
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * innerH;

  const conAlerta =
    Number.isFinite(umbrales.alerta) && umbrales.alerta > lo && umbrales.alerta < hi;
  const conEvac =
    Number.isFinite(umbrales.evacuacion) && umbrales.evacuacion > lo && umbrales.evacuacion < hi;

  const href = (a) => {
    if (Number.isFinite(umbrales.evacuacion) && a.max >= umbrales.evacuacion) return '#ef4444';
    if (Number.isFinite(umbrales.alerta) && a.max >= umbrales.alerta) return '#f59e0b';
    return '#3b82c4';
  };

  return (
    <svg className="chart chart-anual" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Máximas anuales del río">
      {conAlerta && (
        <line
          x1={pad.l}
          x2={W - pad.r}
          y1={y(umbrales.alerta)}
          y2={y(umbrales.alerta)}
          stroke="#f59e0b"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.55"
        />
      )}
      {conEvac && (
        <line
          x1={pad.l}
          x2={W - pad.r}
          y1={y(umbrales.evacuacion)}
          y2={y(umbrales.evacuacion)}
          stroke="#ef4444"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.55"
        />
      )}
      {anios.map((a, i) => {
        const h = Math.max(0.6, y(lo) - y(a.max));
        const sel = hover?.anio === a.anio;
        return (
          <rect
            key={a.anio}
            x={pad.l + i * bw}
            y={y(a.max)}
            width={Math.max(1, bw - 0.7)}
            height={h}
            rx="0.5"
            fill={href(a)}
            opacity={anioActual === a.anio ? 1 : sel ? 1 : 0.72}
            stroke={sel ? '#e0f4ff' : 'none'}
            strokeWidth="0.6"
            onPointerEnter={() => setHover(a)}
            onPointerLeave={() => setHover(null)}
            onClick={() => onSelect?.(a)}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            <title>{`${a.anio}: ${fmtM(a.max)} m`}</title>
          </rect>
        );
      })}
      <text x={pad.l} y={H - 4} fontSize="8" fill="rgba(148,190,214,0.7)">
        {anios[0]?.anio}
      </text>
      <text x={W - pad.r} y={H - 4} fontSize="8" textAnchor="end" fill="rgba(148,190,214,0.7)">
        {anios[n - 1]?.anio}
      </text>
      {hover && (
        <text
          x={Math.min(W - pad.r - 2, Math.max(pad.l + 2, pad.l + (anios.indexOf(hover) + 0.5) * bw))}
          y={pad.t - 2}
          fontSize="9"
          textAnchor={pad.l + (anios.indexOf(hover) + 0.5) * bw > W / 2 ? 'end' : 'start'}
          fill="#e9f1f7"
        >
          {hover.anio} · {fmtM(hover.max)} m
        </text>
      )}
    </svg>
  );
}
