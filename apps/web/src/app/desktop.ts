/** Bridge from the Electron preload (`apps/desktop`). Null in the browser. */
export interface AfterfallDesktop {
  quit(): void;
}

export const desktop: AfterfallDesktop | null = (window as unknown as { afterfallDesktop?: AfterfallDesktop }).afterfallDesktop ?? null;
