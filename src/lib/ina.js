const BASE = 'https://alerta.ina.gob.ar/a5/obs/puntual';

const dia = (d) => d.toISOString().slice(0, 10);

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
