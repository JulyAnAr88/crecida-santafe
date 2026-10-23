import { lonToTileX, latToTileY } from './geo.js';

/**
 * Rasteriza los alineamientos de terraplenes sobre la grilla del DEM.
 *
 * Devuelve:
 * - cota: Float32Array con la cota levantada del terraplén en esa celda
 *   (0 = sin dato de cota). El BFS usa la altura máxima entre DEM y cota, así
 *   el agua puede sobrepasar el terraplén cuando supera su cresta.
 * - muro: Uint8Array con 1 en celdas de terraplén sin cota conocida: siempre
 *   bloquean el avance del agua.
 */
export function rasterizarTerraplenes(geojson, dem) {
  const { width, height, zoom, decimate, gx0, gy0 } = dem;
  const cota = new Float32Array(width * height);
  const muro = new Uint8Array(width * height);

  const aGrid = (lon, lat) => [
    (lonToTileX(lon, zoom) * 256 - gx0) / decimate,
    (latToTileY(lat, zoom) * 256 - gy0) / decimate,
  ];

  const paso = 0.34; // celdas entre muestras
  let celdasCota = 0;
  let celdasMuro = 0;

  // Marca la celda y el camino 4-conectado desde la celda anterior: sin esto
  // las diagonales dejan escaleras por las que el BFS de4 vecinos se escapa.
  const marcar = (ix, iy, conCota, anterior) => {
    const caminar = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = y * width + x;
      if (conCota > 0) {
        if (conCota > cota[i]) {
          if (cota[i] === 0) celdasCota += 1;
          cota[i] = conCota;
        }
      } else if (!muro[i]) {
        muro[i] = 1;
        if (cota[i] === 0) celdasMuro += 1;
      }
    };
    if (!anterior) {
      caminar(ix, iy);
      return [ix, iy];
    }
    let [cx, cy] = anterior;
    while (cx !== ix || cy !== iy) {
      if (cx !== ix) cx += Math.sign(ix - cx);
      else cy += Math.sign(iy - cy);
      caminar(cx, cy);
    }
    return [ix, iy];
  };

  for (const f of geojson?.features ?? []) {
    if (f.geometry?.type !== 'LineString') continue;
    const coords = f.geometry.coordinates;
    const z = f.properties?.z ?? [];
    let anterior = null;
    for (let k = 0; k + 1 < coords.length; k++) {
      const [x0, y0] = aGrid(coords[k][0], coords[k][1]);
      const [x1, y1] = aGrid(coords[k + 1][0], coords[k + 1][1]);
      const z0 = z[k] ?? 0;
      const z1 = z[k + 1] ?? 0;
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / paso));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        const ix = Math.floor(x0 + (x1 - x0) * t);
        const iy = Math.floor(y0 + (y1 - y0) * t);
        const conCota =
          z0 > 0 && z1 > 0 ? z0 + (z1 - z0) * t : z0 > 0 ? z0 : z1 > 0 ? z1 : 0;
        anterior = marcar(ix, iy, conCota, anterior);
      }
    }
  }

  return { cota, muro, celdasCota, celdasMuro };
}
