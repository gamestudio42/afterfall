import { en } from "./en";
import { ptBR } from "./pt-BR";

export type Lang = "pt-BR" | "en";
const tables: Record<Lang, Record<string, string>> = { "pt-BR": ptBR, en };

export function translate(lang: Lang, key: string, params: Record<string, string | number> = {}): string {
  const raw = tables[lang][key] ?? tables.en[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    if (v === undefined) return `{${k}}`;
    // Parameters that are themselves keys (building types, structures, ...) get translated.
    if (typeof v === "string") {
      for (const prefix of ["building.", "struct.", "fn.", "dir."]) {
        const nested = tables[lang][prefix + v];
        if (nested && (k === "type" || k === "kind" || k === "fn" || k === "dir")) return nested;
      }
    }
    return String(v);
  });
}

/** Alert keys may carry a per-entity suffix (alert.noAmmo.12). */
export function alertKey(key: string): string {
  const parts = key.split(".");
  return parts.length > 2 ? `${parts[0]}.${parts[1]}` : key;
}
