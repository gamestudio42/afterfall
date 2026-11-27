/**
 * GoatCounter belongs on the GitHub Pages build only.
 * The desktop shell serves those files from `app://`, where a protocol-relative
 * script URL is resolved as `app://gc.zgo.at` and blocked by `script-src 'self'`.
 * Remove the tag instead of widening the policy.
 */
export function stripDesktopAnalytics(html) {
  return html.replace(/<script\b[^>]*>\s*<\/script>/gi, (tag) => (/data-goatcounter|gc\.zgo\.at/i.test(tag) ? "" : tag));
}
