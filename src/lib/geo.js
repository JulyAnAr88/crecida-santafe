const R = 6378137;
const WORLD = Math.PI * R;

export const lonToTileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;

export const latToTileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z;
};

export const tileXToLon = (x, z) => (x / 2 ** z) * 360 - 180;

export const tileYToLat = (y, z) =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

export const worldPx = (z) => 256 * 2 ** z;

export const metersPerPixel = (lat, z) =>
  (2 * WORLD * Math.cos((lat * Math.PI) / 180)) / worldPx(z);
