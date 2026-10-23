export const LOCALIDAD = {
  id: 'santa-fe',
  nombre: 'Santa Fe',
  provincia: 'Santa Fe',
  rio: 'Paraná',
  centro: [-60.7011643, -31.6373211],
  zoom: 12.7,
  centro3d: [-60.7002319185745, -31.6514772196376],
  zoom3d: 14.2,
  bbox: [-60.79, -31.735, -60.5, -31.55],
  demZoom: 13,
  demDecimate: 2,
  demToleranciaGrados: 0.00009,
  semillasRio: [
    [-60.682, -31.64],
    [-60.678, -31.66],
    [-60.678, -31.62],
    [-60.545, -31.63],
    [-60.525, -31.7],
  ],
  hidrometro: {
    nombre: 'Hidrómetro Puerto Santa Fe',
    serieId: 30,
    cotaCero_m: 8.378,
    posicion: [-60.7002319185745, -31.6514772196376],
  },
  umbrales: {
    aguasBajas: 2.0,
    alerta: 5.3,
    evacuacion: 5.7,
  },
  simulador: {
    min_m: 3.0,
    max_m: 8.0,
    paso_m: 0.05,
    inicial_m: 3.85,
  },
  capas: {
    distritos: 'publico:distrito',
    vecinales: 'publico:vecinal',
  },
  fuentes: [
    {
      nombre: 'INA — Sistema de Información y Alerta Hidrológico (SIyAH)',
      url: 'https://alerta.ina.gob.ar/a5',
    },
    {
      nombre: 'Prefectura Naval Argentina — Alturas de ríos',
      url: 'https://contenidosweb.prefecturanaval.gob.ar/alturas/',
    },
    {
      nombre: 'Municipalidad de Santa Fe — Geoservicios',
      url: 'https://geoservicios.santafeciudad.gov.ar',
    },
  ],
};
