import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isMobile } from "./api";
import { REPO } from "./config";

export interface UpdateInfo {
  version: string;
  notes?: string;
  apkUrl?: string;
  desktop?: unknown;
}

function newer(a: string, b: string) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (REPO.startsWith("OWNER/")) return null;
  if (isMobile()) {
    const cur = await getVersion();
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const rel = await r.json();
    const ver = String(rel.tag_name || "").replace(/^v/, "");
    if (!ver || !newer(ver, cur)) return null;
    const apk = (rel.assets || []).find((a: any) => String(a.name).endsWith(".apk"));
    if (!apk) return null;
    return { version: ver, notes: rel.body, apkUrl: apk.browser_download_url };
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  const u = await check();
  if (!u) return null;
  return { version: u.version, notes: u.body, desktop: u };
}

export async function installUpdate(info: UpdateInfo, onProgress?: (p: number) => void) {
  if (info.apkUrl) {
    await openUrl(info.apkUrl);
    return;
  }
  const u = info.desktop as import("@tauri-apps/plugin-updater").Update;
  let total = 0, got = 0;
  await u.downloadAndInstall((ev) => {
    if (ev.event === "Started") total = ev.data.contentLength ?? 0;
    if (ev.event === "Progress") {
      got += ev.data.chunkLength;
      if (total) onProgress?.(got / total);
    }
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
