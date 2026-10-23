/**
 * **확장** — 워커에 설치된 코드 모듈을 노드로 부른다 (PLAN 결정 8).
 *
 * 커스텀 노드는 코드가 **플로우 안에** 있다. 확장은 코드가 **워커에** 있고 플로우는 이름만 적는다 —
 * 몇 달 실측으로 다듬은 코드(사내 시스템의 주문 읽기 · 주문 넣기)를 그대로 쓰는 자리다.
 * ☆확장은 녹화 · 변경 감시 밖이다. 그 안의 사이트 지식은 확장이 책임진다.
 */
import type { Output } from "@flowsmith/core";

export interface ExtensionOption {
  name: string;
  label: string;
  required: boolean;
  /** 비워 두면 넣을 값 — 화면이 미리 채워 둔다(표현식도 된다) */
  default?: string;
  hint?: string;
}

export interface ExtensionMeta {
  /** 「shop.order-read」 */
  id: string;
  title: string;
  description: string;
  options: ExtensionOption[];
  /** 내보내는 이름들 — 화면이 노드의 outputs에 채운다 */
  outputs: string[];
  /** 어떤 브라우저가 필요한가 — attach면 워커의 CDP 주소를 받는다 */
  browser: "none" | "attach";
  /** 되돌릴 수 없는 일을 하는가 — 점검 실행이 여기서 멈춘다 */
  risk: "safe" | "unsafe";
  /**
   * ★개인정보가 든 출력 이름들 — 뒤 노드에는 그대로 넘기되, **실행 기록 · 화면 · 결과에는 가린다.**
   *  실행 기록은 DB에 남고 화면에 보인다. 고객의 주소 · 이름이 거기 쌓이면 안 된다
   */
  pii?: string[];
  /** 확장 플러그인에서 왔으면 그 플러그인 · 버전(PLAN §41) — 환경변수로 실은 것은 없다 */
  plugin?: { id: string; name: string; version: string };
}

export interface ExtensionContext {
  /** 앞 노드들이 넘긴 객체 */
  input: Output;
  /** 노드에 적힌 값 — 표현식을 채운 뒤 */
  options: Record<string, string>;
  params: Record<string, string>;
  vars: Record<string, string>;
  /** 사람의 크롬 CDP 주소 — browser가 attach인 확장만 쓴다 */
  cdpUrl: string;
  log(text: string): void;
}

export interface Extension extends ExtensionMeta {
  run(ctx: ExtensionContext): Promise<Output>;
}

export class ExtensionRegistry {
  readonly #byId = new Map<string, Extension>();

  register(...exts: Extension[]): this {
    for (const e of exts) {
      if (this.#byId.has(e.id)) throw new Error(`확장 ${e.id}가 두 번 등록됐습니다`);
      this.#byId.set(e.id, e);
    }
    return this;
  }

  get(id: string): Extension | undefined {
    return this.#byId.get(id);
  }

  /** 등록된 것 전부(run까지) */
  all(): Extension[] {
    return [...this.#byId.values()];
  }

  /** 통째로 바꾼다 — 플러그인을 올리고 내릴 때. ★겹치면 아무것도 바꾸지 않고 던진다 */
  replace(exts: readonly Extension[]): void {
    const next = new Map<string, Extension>();
    for (const e of exts) {
      if (next.has(e.id)) throw new Error(`확장 ${e.id}가 두 번 등록됐습니다`);
      next.set(e.id, e);
    }
    this.#byId.clear();
    for (const [k, v] of next) this.#byId.set(k, v);
  }

  /** 지금 것의 사본 — 실행은 시작할 때의 확장으로 끝까지 간다(도중에 플러그인이 바뀌어도) */
  snapshot(): ExtensionRegistry {
    return new ExtensionRegistry().register(...this.#byId.values());
  }

  /** 화면에 보일 것 — run은 빼고 */
  list(): ExtensionMeta[] {
    return [...this.#byId.values()].map(({ run: _run, ...meta }) => meta);
  }
}

/** 확장 모듈의 모양 — `export const extensions: Extension[]` */
export interface ExtensionModule {
  extensions: Extension[];
}
