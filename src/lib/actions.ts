import { api } from "./api";
import type { Track } from "./types";
import { useLib } from "../store/library";
import { ensurePlayable } from "../store/player";
import { toast } from "../store/ui";

const queue: { id: string; url: string; silent: boolean }[] = [];
let running = 0;
const MAX_PARALLEL = 3;

/** Download the full-length file from the matched open source to the device. */
export async function downloadTrack(t: Track, silent = false) {
  if (t.local) return;
  if (t.scw && !t.src) {
    if (!silent) toast("Треки из плеера SoundCloud нельзя скачать — только слушать", "err");
    return;
  }
  const lib = useLib.getState();
  if (lib.downloads[t.id] || lib.dl[t.id] != null) return;
  useLib.setState((s) => ({ dl: { ...s.dl, [t.id]: 0 } }));
  const r = await ensurePlayable(t);
  if (!r?.src?.full) {
    useLib.setState((s) => {
      const dl = { ...s.dl };
      delete dl[t.id];
      return { dl };
    });
    if (!silent) toast(`Полной версии нет в открытых источниках: ${t.title}`, "err");
    return;
  }
  lib.upsert([{ ...t, src: r.src }]);
  queue.push({ id: t.id, url: r.src.url, silent });
  pump();
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift()!;
    running++;
    api
      .download(job.id, job.url)
      .then(() => {
        useLib.setState((s) => {
          const dl = { ...s.dl };
          delete dl[job.id];
          return { downloads: { ...s.downloads, [job.id]: true }, dl };
        });
        if (!job.silent) toast("Скачано", "ok");
      })
      .catch((e) => {
        useLib.setState((s) => {
          const dl = { ...s.dl };
          delete dl[job.id];
          return { dl };
        });
        toast("Ошибка загрузки: " + e, "err");
      })
      .finally(() => {
        running--;
        pump();
      });
  }
}

export async function removeDownload(t: Track) {
  await api.deleteDownload(t.id);
  useLib.setState((s) => {
    const d = { ...s.downloads };
    delete d[t.id];
    return { downloads: d };
  });
}

export function downloadMany(ts: Track[]) {
  ts.forEach((t) => downloadTrack(t, true));
  toast(`Ищем и скачиваем: ${ts.length}`);
}

export function playlistAsText(ts: Track[]) {
  return ts.map((t) => `${t.artist} - ${t.title}`).join("\n");
}
