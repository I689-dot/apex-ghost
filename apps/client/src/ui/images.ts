import type { CarEntry } from '@apex/shared';

/** Real renders and photos for the UI (tools/asset-pipeline/ui_renders.mjs, tools/e2e/photos.mjs). */
export function uiAsset(file: string): string {
  return `${import.meta.env.BASE_URL}assets/ui/${file}`;
}

/**
 * A CSS `url()` for a UI image, absolute: one passed through a custom property (`--photo: url(…)`) is resolved
 * against the stylesheet that uses it (assets/index-….css in a build), not the page, so a relative one broke there.
 */
export function cssUrl(file: string): string {
  return `url("${new URL(uiAsset(file), document.baseURI).href}")`;
}

/** Studio render of a car (falls back to its thumbnail in an onerror handler where used). */
export function heroUrl(car: CarEntry): string {
  return uiAsset(`cars/${car.id}.webp`);
}
