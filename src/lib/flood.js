import { contours } from 'd3-contour';

function perpDistance(p, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - x1, p[1] - y1);
  return Math.abs(dx * (y1 - p[1]) - (x1 - p[0]) * dy) / len;
}

function rdp(points, tol) {
  if (points.length < 3) return points;
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], x1, y1, x2, y2);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > tol) {
    const left = rdp(points.slice(0, idx + 1), tol);
    const right = rdp(points.slice(idx), tol);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

function simplifyRing(points, tol) {
  if (points.length < 5) return points;
  const last = points[points.length - 1];
  const closed = points[0][0] === last[0] && points[0][1] === last[1];
  const open = closed ? points.slice(0, -1) : points.slice();
  if (open.length < 4) return points;
  const simplified = rdp(open, tol);
  if (simplified.length < 3) return [];
  simplified.push(simplified[0]);
  return simplified;
}

export function computeFlood(dem, waterLevel, seeds, tolerance = 0.00009, terraplenes = null) {
  const { heights, width, height } = dem;
  const n = width * height;
  const cotaT = terraplenes?.cota?.length === n ? terraplenes.cota : null;
  const muroT = terraplenes?.muro?.length === n ? terraplenes.muro : null;

  // Altura efectiva: el terraplén eleva la celda por sobre el DEM (30 m
  // promedia la cresta); la cota del levantamiento manda si es mayor.
  const alturaDe = (i) =>
    cotaT && cotaT[i] > 0 && cotaT[i] > heights[i] ? cotaT[i] : heights[i];
  // Terraplén sin cota conocida: barrera absoluta.
  const bloqueado = (i) =>
    !!(muroT && muroT[i] === 1 && !(cotaT && cotaT[i] > 0));

  const mask = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const visit = (i) => {
    if (!mask[i] && !bloqueado(i) && alturaDe(i) <= waterLevel) {
      mask[i] = 1;
      queue[tail++] = i;
    }
  };

  for (const [lon, lat] of seeds) {
    const [sx, sy] = dem.lonLatToGrid(lon, lat);
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
    const i = sy * width + sx;
    if (!bloqueado(i) && alturaDe(i) <= waterLevel && !mask[i]) {
      mask[i] = 1;
      queue[tail++] = i;
    }
  }

  if (tail === 0) {
    let best = -1;
    let bestH = Infinity;
    for (let i = 0; i < heights.length; i++) {
      if (bloqueado(i)) continue;
      const h = alturaDe(i);
      if (h < bestH) {
        bestH = h;
        best = i;
      }
    }
    if (best >= 0 && bestH <= waterLevel) {
      mask[best] = 1;
      queue[tail++] = best;
    }
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < width * (height - 1)) visit(i + width);
  }

  const field = new Float64Array(width * height);
  let floodedCells = 0;
  for (let i = 0; i < field.length; i++) {
    if (mask[i]) {
      field[i] = 1;
      floodedCells += 1;
    }
  }

  const multi = contours().size([width, height]).thresholds([0.5])(field)[0];
  const features = [];
  if (multi) {
    for (const polygon of multi.coordinates) {
      const rings = [];
      for (const ring of polygon) {
        const lngLat = ring.map(([x, y]) => dem.gridToLngLat(x, y));
        const simplified = simplifyRing(lngLat, tolerance);
        if (simplified.length >= 4) rings.push(simplified);
      }
      if (!rings.length) continue;
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: rings },
      });
    }
  }

  let areaM2 = 0;
  const mid = Math.floor(width / 2);
  for (let y = 0; y < height; y++) {
    const lat = dem.gridToLngLat(mid, y)[1];
    const mpp = dem.metersPerPixel(lat);
    let count = 0;
    const off = y * width;
    for (let x = 0; x < width; x++) if (mask[off + x]) count += 1;
    areaM2 += count * mpp * mpp;
  }

  return {
    geojson: { type: 'FeatureCollection', features },
    mask,
    areaKm2: areaM2 / 1e6,
    floodedCells,
    waterLevel,
    conTerraplenes: !!terraplenes,
  };
}
