import type { CarEntry } from '@apex/shared';

/** Real renders and photos for the UI (tools/asset-pipeline/ui_renders.mjs, tools/e2e/photos.mjs). */
export function uiAsset(file: string): string {
  return `${import.meta.env.BASE_URL}assets/ui/${file}`;
}

/** Studio render of a car (falls back to its thumbnail in an onerror handler where used). */
export function heroUrl(car: CarEntry): string {
  return uiAsset(`cars/${car.id}.webp`);
}
