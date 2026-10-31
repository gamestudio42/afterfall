import { BUILDING_TYPES } from "@afterfall/content";
import { FUNCTION_TINT } from "@afterfall/renderer";
import { useEffect, useRef } from "react";
import { useFrame, useGame, useT } from "../app/hooks";

/** Width of the minimap in CSS pixels; the height follows the map's aspect ratio. */
const WIDTH = 200;

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/**
 * Top-down overview of the city: roads, buildings (settlement ones tinted),
 * survivors, infected and the camera's view. Clicking or dragging moves the
 * camera there.
 */
export function Minimap() {
  const frame = useFrame();
  const t = useT();
  const game = useGame();
  const sim = game.sim!;
  const ref = useRef<HTMLCanvasElement>(null);
  const city = sim.city;
  const scale = WIDTH / city.width;
  const height = Math.round(city.height * scale);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== WIDTH * dpr) {
      canvas.width = WIDTH * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.fillStyle = "#2a2f27";
    ctx.fillRect(0, 0, city.width, city.height);
    const fillPoly = (poly: { x: number; y: number }[]) => {
      ctx.beginPath();
      poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = "#3c6b3a";
    for (const p of city.parks) p.polygon ? fillPoly(p.polygon) : ctx.fillRect(p.rect.x, p.rect.y, p.rect.w, p.rect.h);
    ctx.fillStyle = "#4a4d52";
    ctx.strokeStyle = "#4a4d52";
    ctx.lineCap = ctx.lineJoin = "round";
    for (const r of city.roads) {
      if (!r.path) {
        ctx.fillRect(r.rect.x, r.rect.y, r.rect.w, r.rect.h);
        continue;
      }
      ctx.lineWidth = Math.max(r.width ?? 8, 2 / scale);
      ctx.beginPath();
      r.path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
    city.buildings.forEach((b, i) => {
      const st = sim.state.buildings[i];
      ctx.fillStyle = st.fn !== "none" ? hex(FUNCTION_TINT[st.fn] ?? 0xffffff) : hex(BUILDING_TYPES[b.type].color);
      ctx.globalAlpha = st.fn !== "none" ? 1 : st.searchProgress >= st.searchTotal ? 0.4 : 0.75;
      if (b.footprint) fillPoly(b.footprint);
      else ctx.fillRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
    });
    ctx.globalAlpha = 1;
    if (sim.state.hq >= 0) {
      const r = city.buildings[sim.state.hq].rect;
      ctx.strokeStyle = "#ffd28a";
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(r.x - 1.5 / scale, r.y - 1.5 / scale, r.w + 3 / scale, r.h + 3 / scale);
    }
    const dot = (x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.arc(x, y, r / scale, 0, Math.PI * 2);
      ctx.fill();
    };
    ctx.fillStyle = "#c9a36b";
    for (const s of sim.structures()) dot(s.transform!.x, s.transform!.y, 1);
    ctx.fillStyle = "#ff5a3c";
    for (const z of sim.infected()) dot(z.transform!.x, z.transform!.y, 1.4);
    ctx.fillStyle = "#6ff0c8";
    for (const s of sim.survivors()) if (s.survivor.inside < 0) dot(s.transform!.x, s.transform!.y, 1.8);
    // Camera footprint on the ground.
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => game.renderer.groundPoint(x, y));
    if (corners.every(Boolean)) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p!.x, p!.y) : ctx.lineTo(p!.x, p!.y)));
      ctx.closePath();
      ctx.stroke();
    }
  }, [frame, sim, game, city, scale, height]);

  const moveTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    game.focusOn(((e.clientX - r.left) / r.width) * city.width, ((e.clientY - r.top) / r.height) * city.height);
  };

  return (
    <canvas
      ref={ref}
      className="minimap"
      data-testid="minimap"
      title={t("minimap.title")}
      style={{ width: WIDTH, height }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e);
      }}
      onPointerMove={(e) => e.buttons & 1 && moveTo(e)}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
