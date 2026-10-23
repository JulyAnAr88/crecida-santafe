import { useId, useState } from 'react';
import { fmtM, fmtFecha } from '../lib/format.js';

export default function SerieChart({ serie, umbrales }) {
  const [hover, setHover] = useState(null);
  const gradientId = useId();
  const W = 320;
  const H = 124;
  const pad = { l: 8, r: 8, t: 14, b: 18 };

  if (!serie || serie.length < 2) {
    return <div className="vacio">Sin datos recientes de la serie.</div>;
  }

  const vals = serie.map((p) => p.v);
  const dataMin = Math.min(...vals);
  const dataMax = Math.max(...vals);
  const lo = Math.max(0, Math.floor((dataMin - 0.3) * 2) / 2);
  const hi = Math.ceil((dataMax + 0.3) * 2) / 2;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const x = (i) => pad.l + (i / (serie.length - 1)) * innerW;
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * innerH;

  const linea = serie
    .map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(' ');
  const area = `${linea} L${x(serie.length - 1).toFixed(1)},${(H - pad.b).toFixed(
    1,
  )} L${pad.l},${(H - pad.b).toFixed(1)} Z`;

  const marcas = [
    { v: umbrales.alerta, color: '#f59e0b', txt: 'alerta' },
    { v: umbrales.evacuacion, color: '#ef4444', txt: 'evacuación' },
  ].filter((m) => m.v > lo && m.v < hi);

  const ultimo = serie[serie.length - 1];
  const hoverPt = hover != null ? serie[hover] : null;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const rel = (px - pad.l) / innerW;
    const i = Math.max(0, Math.min(serie.length - 1, Math.round(rel * (serie.length - 1))));
    setHover(i);
  };

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Serie del nivel del río en los últimos días"
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(v)}
            y2={y(v)}
            stroke="rgba(148,190,214,0.12)"
            strokeWidth="1"
          />
          <text x={pad.l} y={y(v) - 3} fontSize="8" fill="rgba(148,190,214,0.7)">
            {fmtM(v, 1)}
          </text>
        </g>
      ))}

      {marcas.map((m) => (
        <g key={m.txt}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(m.v)}
            y2={y(m.v)}
            stroke={m.color}
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.65"
          />
          <text
            x={W - pad.r}
            y={y(m.v) - 3}
            fontSize="8"
            textAnchor="end"
            fill={m.color}
            opacity="0.9"
          >
            {m.txt}
          </text>
        </g>
      ))}

      <path d={area} fill={`url(#${gradientId})`} />
      <path d={linea} fill="none" stroke="#38bdf8" strokeWidth="1.6" strokeLinejoin="round" />

      <circle cx={x(serie.length - 1)} cy={y(ultimo.v)} r="2.6" fill="#e0f4ff" stroke="#0ea5e9" strokeWidth="1.5" />

      {hoverPt && (
        <g>
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.t}
            y2={H - pad.b}
            stroke="rgba(224,244,255,0.35)"
            strokeWidth="1"
          />
          <circle cx={x(hover)} cy={y(hoverPt.v)} r="3" fill="#e0f4ff" />
          <text
            x={Math.min(W - pad.r - 2, Math.max(pad.l + 2, x(hover)))}
            y={Math.max(pad.t + 8, y(hoverPt.v) - 8)}
            fontSize="9"
            textAnchor={x(hover) > W / 2 ? 'end' : 'start'}
            fill="#e9f1f7"
          >
            {fmtFecha(hoverPt.t)} · {fmtM(hoverPt.v)} m
          </text>
        </g>
      )}

      <text x={pad.l} y={H - 5} fontSize="8" fill="rgba(148,190,214,0.7)">
        {fmtFecha(serie[0].t)}
      </text>
      <text x={W - pad.r} y={H - 5} fontSize="8" textAnchor="end" fill="rgba(148,190,214,0.7)">
        {fmtFecha(ultimo.t)}
      </text>
    </svg>
  );
}
