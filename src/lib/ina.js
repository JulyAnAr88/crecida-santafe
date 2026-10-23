const BASE = 'https://alerta.ina.gob.ar/a5/obs/puntual';
const WFS = 'https://alerta.ina.gob.ar/geoserver/public2/ows';

const dia = (d) => d.toISOString().slice(0, 10);

const umbral = (v) => (Number.isFinite(v) && v > 0 ? v : null);

export async function fetchEstacion(serieId) {
  const res = await fetch(`${BASE}/series/${serieId}`);
  if (!res.ok) throw new Error(`INA ${res.status}`);
  return res.json();
}

export async function fetchSerie(serieId, dias = 120) {
  const end = new Date();
  const start = new Date(end.getTime() - dias * 86400000);
  const url = `${BASE}/observaciones?series_id=${serieId}&timestart=${dia(start)}&timeend=${dia(end)}&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`INA ${res.status}`);
  const data = await res.json();
  return data
    .filter((o) => Number.isFinite(o.valor))
    .map((o) => ({ t: new Date(o.timestart), v: o.valor }))
    .sort((a, b) => a.t - b.t);
}

async function saladoDesdeA5(dias) {
  const [meta, serie] = await Promise.all([
    fetchEstacion(103),
    fetchSerie(103, dias),
  ]);
  const e = meta.estacion;
  const ultimo = serie[serie.length - 1];
  const previo = serie[serie.length - 2];
  return {
    nombre: e.nombre,
    rio: 'Río Salado',
    serieId: 103,
    ceroIgn: umbral(e.cero_ign),
    umbrales: {
      alerta: umbral(e.nivel_alerta),
      evacuacion: umbral(e.nivel_evacuacion),
      aguasBajas: umbral(e.nivel_aguas_bajas),
    },
    valor: ultimo?.v ?? null,
    fecha: ultimo?.t ?? null,
    delta: ultimo && previo ? ultimo.v - previo.v : null,
    tendencia: null,
    serie,
    fuente: 'INA–SIyAH · Prefectura Naval',
  };
}

async function saladoDesdeWFS(dias) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const end = new Date();
    const start = new Date(end.getTime() - dias * 86400000);
    const url =
      `${WFS}?service=WFS&version=1.0.0&request=GetFeature` +
      '&typeName=public2:ultimas_alturas_con_timeseries' +
      `&viewParams=timeStart:${dia(start)};timeEnd:${dia(end)}` +
      '&CQL_FILTER=unid=103&outputFormat=application/json';
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`WFS ${res.status}`);
    const geo = await res.json();
    const p = geo?.features?.[0]?.properties;
    if (!p || !Number.isFinite(Number(p.valor))) throw new Error('sin datos');
    const serie = JSON.parse(p.timeseries || '[]')
      .map(([t, v]) => ({ t: new Date(t), v: Number(v) }))
      .filter((o) => Number.isFinite(o.v))
      .sort((a, b) => a.t - b.t);
    return {
      nombre: p.nombre,
      rio: p.rio === 'SALADOSANTAFE' ? 'Río Salado' : p.rio ?? 'Río Salado',
      serieId: p.series_id ?? 103,
      ceroIgn: umbral(p.cero_ign),
      umbrales: {
        alerta: umbral(p.nivel_de_alerta),
        evacuacion: umbral(p.nivel_de_evacuacion),
        aguasBajas: umbral(p.nivel_de_aguas_bajas),
      },
      valor: Number(p.valor),
      fecha: new Date(p.fecha),
      delta:
        p.valor_precedente != null && Number.isFinite(Number(p.valor_precedente))
          ? Number(p.valor) - Number(p.valor_precedente)
          : null,
      tendencia: p.tendencia ?? null,
      serie,
      fuente: 'INA–SIyAH · Prefectura Naval',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Nivel del río Salado en la estación Recreo (serie/unid 103).
 *
 * Paralelo: el WFS de alturas con ventana corta (14 d ≈ 2 s) da el valor
 * actual y el a5 da la serie larga (120 d). Después se mezclan por hora para
 * que el gráfico quede completo. Si alguno falla, se usa el otro.
 * (El WFS con ventana de 120 d tarda ~20-60 s, por eso no se espera.)
 */
export async function fetchSalado(dias = 120) {
  const [wfs, largo] = await Promise.allSettled([
    saladoDesdeWFS(14),
    saladoDesdeA5(dias),
  ]);

  if (wfs.status === 'fulfilled' && largo.status === 'fulfilled') {
    const w = wfs.value;
    const a = largo.value;
    const porHora = new Map(a.serie.map((p) => [p.t.toISOString().slice(0, 13), p]));
    for (const p of w.serie) porHora.set(p.t.toISOString().slice(0, 13), p);
    const serie = [...porHora.values()].sort((x, y) => x.t - y.t);
    return {
      ...w,
      serie: serie.length ? serie : w.serie,
      fuente: 'INA–SIyAH · Prefectura Naval',
    };
  }
  if (wfs.status === 'fulfilled') return wfs.value;
  if (largo.status === 'fulfilled') return largo.value;
  throw largo.reason ?? new Error('sin datos de la estación Recreo');
}
