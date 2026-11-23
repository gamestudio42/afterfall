/**
 * Absolute URL for a file in `public/`.
 *
 * A relative `url(./art/...)` stored in a CSS variable is resolved against the
 * stylesheet. The built sheet lives in `/assets/`, so the menu backdrop was
 * requested as `/assets/art/menu_bg.jpg` and 404'd. An absolute URL does not
 * depend on which file substitutes the variable.
 */
export function publicAssetUrl(baseUrl: string, assetPath: string, documentBase: string): string {
  const base = new URL(documentBase);
  if (!base.pathname.endsWith("/")) {
    const last = base.pathname.split("/").pop() ?? "";
    if (!last.includes(".")) base.pathname += "/";
  }
  return new URL(`${baseUrl}${assetPath}`, base).href;
}
