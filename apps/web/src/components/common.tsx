import type { ReactNode } from "react";
import { RESOURCE_IDS, type ResourceBag } from "@afterfall/content";
import { useT } from "../app/hooks";

const RES_COLORS: Record<string, string> = {
  food: "#e3b35a",
  water: "#5fb2e8",
  wood: "#b0834f",
  metal: "#a7b0ba",
  ammo: "#e2c46e",
  medicine: "#e66a7a",
  firearms: "#8e98a6",
};

export function ResDot({ id }: { id: string }) {
  return <i className="res-dot" style={{ background: RES_COLORS[id] }} />;
}

export function Bag({ bag, empty }: { bag: ResourceBag; empty?: ReactNode }) {
  const t = useT();
  const items = RESOURCE_IDS.filter((id) => (bag[id] ?? 0) >= 0.5);
  if (items.length === 0) return <>{empty ?? null}</>;
  return (
    <div className="bag">
      {items.map((id) => (
        <span key={id} title={t(`res.${id}`)}>
          <ResDot id={id} />
          {t(`res.${id}`)} {Math.floor(bag[id]!)}
        </span>
      ))}
    </div>
  );
}

export function Meter({ value, max = 100, color, label }: { value: number; max?: number; color?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="meter" title={label}>
      <div style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}
