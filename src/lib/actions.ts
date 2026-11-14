import { api } from "./api";
import type { Track } from "./types";
import { useLib } from "../store/library";
import { ensurePlayable } from "../store/player";
import { toast } from "../store/ui";

const queue: string[] = [];
let running = 0;
const MAX_PARALLEL = 3;

export async function downloadTrack(t: Track, silent = false) {
  if (t.local) return;
  const r = await ensurePlayable(t);
  if (!r?.yt) {
    if (!silent) toast(`Не найдено: ${t.title}`, "err");
    return;
  }
  const yt = r.yt;
  const lib = useLib.getState();
  if (lib.downloads[yt] || lib.dl[yt] != null) return;
  useLib.setState((s) => ({ dl: { ...s.dl, [yt]: 0 } }));
  queue.push(yt);
  pump(silent);
}

function pump(silent: boolean) {
  while (running < MAX_PARALLEL && queue.length) {
    const yt = queue.shift()!;
    running++;
    api
      .download(yt)
      .then(() => {
        useLib.setState((s) => {
          const dl = { ...s.dl };
          delete dl[yt];
          return { downloads: { ...s.downloads, [yt]: true }, dl };
        });
        if (!silent) toast("Скачано", "ok");
      })
      .catch((e) => {
        useLib.setState((s) => {
          const dl = { ...s.dl };
          delete dl[yt];
          return { dl };
        });
        toast("Ошибка загрузки: " + e, "err");
      })
      .finally(() => {
        running--;
        pump(silent);
      });
  }
}

export async function removeDownload(t: Track) {
  if (!t.yt) return;
  await api.deleteDownload(t.yt);
  useLib.setState((s) => {
    const d = { ...s.downloads };
    delete d[t.yt!];
    return { downloads: d };
  });
}

export function downloadMany(ts: Track[]) {
  ts.forEach((t) => downloadTrack(t, true));
  toast(`В очереди загрузки: ${ts.length}`);
}

export function playlistAsText(ts: Track[]) {
  return ts.map((t) => `${t.artist} - ${t.title}`).join("\n");
}
