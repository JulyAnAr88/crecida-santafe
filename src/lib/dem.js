import {
  lonToTileX,
  latToTileY,
  tileYToLat,
  worldPx,
  metersPerPixel,
} from './geo.js';

const DEM_URL = (z, x, y) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

function median(values) {
  values.sort((a, b) => a - b);
  const n = values.length;
  return n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2;
}

export function filterMedian3(src, width, height) {
  const dst = new Float32Array(src.length);
  const win = new Float32Array(9);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      let n = 0;
      for (let yy = y0; yy <= y1; yy++) {
        const off = yy * width;
        for (let xx = x0; xx <= x1; xx++) win[n++] = src[off + xx];
      }
      for (let i = 1; i < n; i++) {
        const v = win[i];
        let j = i - 1;
        while (j >= 0 && win[j] > v) {
          win[j + 1] = win[j];
          j -= 1;
        }
        win[j + 1] = v;
      }
      dst[y * width + x] = win[n >> 1];
    }
  }
  return dst;
}

/**
 * Carga el DEM terrarium de la bbox y lo remuestrea a una grilla de ~32 m.
 * Se usan tiles de mayor zoom (SRTM) y se agrupan con mediana para evitar
 * que el suavizado de baja resolución (GMTED) mezcle el río con la barranca.
 */
export async function loadDem({
  bbox,
  zoom = 13,
  decimate = 2,
  onProgress,
}) {
  const [lonMin, latMin, lonMax, latMax] = bbox;
  const x0 = Math.floor(lonToTileX(lonMin, zoom));
  const x1 = Math.floor(lonToTileX(lonMax, zoom));
  const y0 = Math.floor(latToTileY(latMax, zoom));
  const y1 = Math.floor(latToTileY(latMin, zoom));

  const cols = x1 - x0 + 1;
  const rows = y1 - y0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = cols * 256;
  canvas.height = rows * 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const total = cols * rows;
  let done = 0;

  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      jobs.push(
        (async () => {
          const res = await fetch(DEM_URL(zoom, tx, ty));
          if (!res.ok) throw new Error(`DEM ${res.status}`);
          const bmp = await createImageBitmap(await res.blob());
          ctx.drawImage(bmp, (tx - x0) * 256, (ty - y0) * 256);
          bmp.close();
          done += 1;
          onProgress?.(done / total);
        })(),
      );
    }
  }
  await Promise.all(jobs);

  const px0 = Math.round((lonToTileX(lonMin, zoom) - x0) * 256);
  const px1 = Math.round((lonToTileX(lonMax, zoom) - x0) * 256);
  const py0 = Math.round((latToTileY(latMax, zoom) - y0) * 256);
  const py1 = Math.round((latToTileY(latMin, zoom) - y0) * 256);

  const srcW = px1 - px0;
  const srcH = py1 - py0;
  if (srcW < decimate * 2 || srcH < decimate * 2) {
    throw new Error('Área DEM inválida');
  }

  const width = Math.floor(srcW / decimate);
  const height = Math.floor(srcH / decimate);
  const img = ctx.getImageData(px0, py0, srcW, srcH).data;
  const heights = new Float32Array(width * height);

  const sample = (x, y) => {
    const p = (y * srcW + x) * 4;
    return img[p] * 256 + img[p + 1] + img[p + 2] / 256 - 32768;
  };

  const block = [];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      block.length = 0;
      for (let dy = 0; dy < decimate; dy++) {
        for (let dx = 0; dx < decimate; dx++) {
          block.push(sample(i * decimate + dx, j * decimate + dy));
        }
      }
      heights[j * width + i] = median(block);
    }
  }

  const filtered = filterMedian3(heights, width, height);

  const gx0 = x0 * 256 + px0;
  const gy0 = y0 * 256 + py0;
  const wp = worldPx(zoom);

  return {
    heights: filtered,
    width,
    height,
    zoom,
    decimate,
    gx0,
    gy0,
    worldPx: wp,
    lonMin,
    lonMax,
    latMin,
    latMax,

    lonLatToGrid(lon, lat) {
      const gx = lonToTileX(lon, zoom) * 256 - gx0;
      const gy = latToTileY(lat, zoom) * 256 - gy0;
      return [Math.floor(gx / decimate), Math.floor(gy / decimate)];
    },

    gridToLngLat(x, y) {
      const gx = gx0 + (x + 0.5) * decimate;
      const gy = gy0 + (y + 0.5) * decimate;
      const lon = (gx / wp) * 360 - 180;
      const lat = tileYToLat(gy / 256, zoom);
      return [lon, lat];
    },

    alturaEn(lon, lat) {
      const gx = (lonToTileX(lon, zoom) * 256 - gx0) / decimate - 0.5;
      const gy = (latToTileY(lat, zoom) * 256 - gy0) / decimate - 0.5;
      const x = Math.min(width - 1.001, Math.max(0, gx));
      const y = Math.min(height - 1.001, Math.max(0, gy));
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = x - xi;
      const fy = y - yi;
      const h00 = filtered[yi * width + xi];
      const h10 = filtered[yi * width + xi + 1];
      const h01 = filtered[(yi + 1) * width + xi];
      const h11 = filtered[(yi + 1) * width + xi + 1];
      return (
        h00 * (1 - fx) * (1 - fy) +
        h10 * fx * (1 - fy) +
        h01 * (1 - fx) * fy +
        h11 * fx * fy
      );
    },

    metersPerPixel(lat) {
      return decimate * metersPerPixel(lat, zoom);
    },
  };
}
