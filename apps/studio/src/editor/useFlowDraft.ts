/**
 * 편집 중인 초안 — 서버에서 읽고 · 고치고 · 저장한다. 저장하지 않은 고침이 있으면 창을 닫을 때 묻는다.
 * ★초안은 언제나 불변 값 — update는 새 객체를 받는다(없어진 포트의 선은 여기서 치운다).
 */
import { useCallback, useEffect, useState } from "react";
import type { Flow } from "@flowsmith/core";
import { api, ApiError, type FlowDetail } from "../api.ts";
import { normalize, pruneEdges } from "../model/index.ts";

export function useFlowDraft(id: string, say: (text: string) => void) {
  const [detail, setDetail] = useState<FlowDetail | null>(null);
  const [draft, setDraft] = useState<Flow | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** 서버가 준 것으로 — 초안 · 저장된 상태를 함께 */
  const accept = useCallback((d: FlowDetail) => {
    const f = normalize(d.draft);
    setDetail(d);
    setDraft(f);
    setSavedJson(JSON.stringify(f));
  }, []);

  useEffect(() => { api.getFlow(id).then(accept, (e: Error) => setLoadError(e.message)); }, [id, accept]);

  const update = useCallback((fn: (f: Flow) => Flow) => setDraft((d) => (d ? pruneEdges(fn(d)) : d)), []);
  const dirty = draft !== null && JSON.stringify(draft) !== savedJson;

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    setBusy(true);
    try { accept(await api.saveDraft(id, draft)); return true; }
    catch (e) { say(e instanceof ApiError ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  }, [draft, id, say, accept]);

  const ensureSaved = useCallback(async () => (dirty ? save() : true), [dirty, save]);

  useEffect(() => {
    const on = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    addEventListener("beforeunload", on);
    return () => removeEventListener("beforeunload", on);
  }, [dirty]);

  return { detail, setDetail, draft, update, dirty, save, ensureSaved, accept, busy, loadError };
}
