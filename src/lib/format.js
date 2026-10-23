export const fmtM = (v, dec = 2) =>
  v == null || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('es-AR', {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
      });

export const fmtKm2 = (v) =>
  v == null || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('es-AR', {
        minimumFractionDigits: v < 10 ? 1 : 0,
        maximumFractionDigits: v < 10 ? 1 : 0,
      });

const fechaCortaFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
});

const fechaHoraFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const mesAnioFmt = new Intl.DateTimeFormat('es-AR', {
  month: 'short',
  year: '2-digit',
});

export function fmtFecha(t) {
  const d = t instanceof Date ? t : null;
  if (!d || Number.isNaN(d.getTime())) return typeof t === 'string' ? t : '—';
  return fechaCortaFmt.format(d);
}

export function fmtFechaHora(t) {
  const d = t instanceof Date ? t : null;
  if (!d || Number.isNaN(d.getTime())) return typeof t === 'string' ? t : '—';
  return fechaHoraFmt.format(d);
}

export function fmtMesAnio(t) {
  return mesAnioFmt.format(t);
}

export function fechaDesdeISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
