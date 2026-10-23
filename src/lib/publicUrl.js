export function publicUrl(ruta) {
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  return `${base.href.replace(/\/?$/, '/')}${ruta}`;
}
