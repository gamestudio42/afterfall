import { useEffect, useState } from "react";

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Coarse pointer or a device that reports a touch screen. Mouse-only desktops stay false. */
export function useTouchUi(): boolean {
  const coarse = useMedia("(pointer: coarse)");
  const [touchPoints] = useState(() => navigator.maxTouchPoints);
  return coarse || touchPoints > 0;
}

/** Phone and tablet portrait, where a side panel would cover the map. */
export const PORTRAIT_LAYOUT = "(orientation: portrait) and (max-width: 900px)";
