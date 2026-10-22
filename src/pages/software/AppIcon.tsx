import { useEffect, useState } from "react";
import { api, type SoftwareApp } from "../../lib/api";
import { CategoryIcon } from "./ui";

/** Icons by `id:version`, shared by every tile and the progress modal, so the
 *  folder poll never re-downloads an icon that has not changed. */
const cache = new Map<string, Promise<string | null>>();

function loadIcon(id: string, version: number): Promise<string | null> {
  const key = `${id}:${version}`;
  let icon = cache.get(key);
  if (!icon) {
    icon = api.swIcon(id).catch(() => null);
    cache.set(key, icon);
  }
  return icon;
}

/** The app's own icon, or its category icon until (or unless) there is one. */
export function AppIcon({ app, size }: { app: SoftwareApp; size: number }) {
  const [loaded, setLoaded] = useState<{ key: string; src: string | null } | null>(null);
  const key = app.iconVersion === null ? null : `${app.id}:${app.iconVersion}`;

  useEffect(() => {
    if (app.iconVersion === null || key === null) return;
    let current = true;
    loadIcon(app.id, app.iconVersion).then((src) => current && setLoaded({ key, src }));
    return () => {
      current = false;
    };
  }, [app.id, app.iconVersion, key]);

  const src = loaded && loaded.key === key ? loaded.src : null;
  return (
    <span
      className={`grid flex-shrink-0 place-items-center overflow-hidden rounded-xl ${src ? "bg-[#f7f9fc]" : "bg-[#eef4ff] text-[#2563eb]"}`}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt="" className="object-contain" style={{ width: size * 0.75, height: size * 0.75 }} draggable={false} />
      ) : (
        <CategoryIcon category={app.category} size={Math.round(size * 0.48)} />
      )}
    </span>
  );
}
