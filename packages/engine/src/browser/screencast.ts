/**
 * **화면 전송** — 페이지의 화면을 JPEG 한 장씩 보낸다(CDP screencast). 녹화(recorder)와 실행 화면 보기(server)가 함께 쓴다.
 *
 * ★받는 쪽이 «아직 그 페이지인가»를 본다 — 창이 바뀐 뒤 늦게 온 화면은 받는 쪽이 버린다.
 * ★stop은 두 번 불러도 된다 · 보낸 화면은 받았다고 바로 알린다(안 알리면 크롬이 다음 화면을 보내지 않는다).
 */
import type { Page } from "playwright";

export interface CastSize { maxWidth: number; maxHeight: number }

export interface Screencast {
  readonly page: Page;
  /** 크기를 바꿔 다시 건다(같은 연결) */
  restart(size: CastSize): Promise<void>;
  stop(): Promise<void>;
}

/** device — 크롬이 그린 화면의 크기(CSS px) */
export async function startScreencast(
  page: Page,
  onFrame: (jpeg: Buffer, device: { width: number; height: number }) => void,
  opts: CastSize & { quality: number },
): Promise<Screencast> {
  const cdp = await page.context().newCDPSession(page);
  let live = true;
  cdp.on("Page.screencastFrame", (f) => {
    if (!live) return;
    onFrame(Buffer.from(f.data, "base64"), { width: f.metadata.deviceWidth, height: f.metadata.deviceHeight });
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  });
  const begin = (s: CastSize) => cdp.send("Page.startScreencast", { format: "jpeg", quality: opts.quality, maxWidth: s.maxWidth, maxHeight: s.maxHeight, everyNthFrame: 1 });
  try { await begin(opts); } catch (e) { live = false; await cdp.detach().catch(() => undefined); throw e; }
  return {
    page,
    restart: async (s) => { await cdp.send("Page.stopScreencast").catch(() => undefined); await begin(s); },
    stop: async () => {
      if (!live) return;
      live = false;
      await cdp.send("Page.stopScreencast").catch(() => undefined);
      await cdp.detach().catch(() => undefined);
    },
  };
}
