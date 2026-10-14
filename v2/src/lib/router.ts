import { useEffect, useState } from "react";

/** Kleiner Hash-Router: funktioniert auf GitHub Pages in jedem Unterordner und offline. */
export function useRoute(): string[] {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => { setHash(location.hash); window.scrollTo({ top: 0 }); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
}
export const go = (path: string) => { location.hash = "#/" + path.replace(/^\//, ""); };
export const back = (fallback: string) => { if (history.length > 1) history.back(); else go(fallback); };
