/**
 * 워커에 등록된 **코드 모듈**을 부른다 (PLAN 결정 8). 커스텀 노드와 달리 코드가 플로우에 없다 —
 * 워커에 설치된 확장(예: 사내 주문 시스템의 주문 읽기)을 이름으로 부른다.
 * ☆core는 어떤 확장이 있는지 모른다. 이름이 실제로 있는지는 실행기가 본다.
 */
export interface ExtensionConfig {
  /** 확장 id — 「shop.order-read」 */
  extension: string;
  /** 확장이 받는 값. 표현식을 쓸 수 있다(시크릿은 안 된다) */
  options: Record<string, string>;
  /** 내보내는 이름들 — 확장이 알려 준 것을 화면이 채워 둔다. 뒤 노드의 `$input.x` 검사가 이걸 본다 */
  outputs: string[];
}
