/**
 * 페이지에 심는 레코더 — 모든 프레임에 들어간다(context.addInitScript).
 *
 * 하는 일:
 *   - 녹화 모드: 누르기 · 체크 · 엔터를 **가로채서**(페이지에는 아직 안 간다) 서버에 알린다.
 *     서버가 위치를 확인한 뒤 엔진의 Primitives로 **대신 누른다** — 녹화가 곧 재생 시험이다.
 *     칸에 넣은 값은 change(포커스가 빠질 때)에 알린다. ★비밀번호 칸의 값은 보내지 않는다.
 *   - 읽기 모드: 누른 요소를 고른다(페이지에는 안 간다). 표의 칸이면 표 전체 제안도 붙인다.
 *   - select: 기본 드롭다운은 screencast에 안 보인다 — 보기 목록을 보내 화면이 대신 띄운다.
 *
 * ★여기서 만든 위치 후보는 **후보일 뿐**이다. 정확히 하나를 가리키는지는 서버가 Playwright로
 *  다시 찾아 확인한다(접근성 이름 계산이 Playwright와 다를 수 있다 — M1 시험에서 실제로 걸렸다).
 *
 * 서버가 주는 것: window.__relayEmit(payload) · window.__relayGetMode()
 * 모드: record · read · browse · off(녹화가 끝났다 — 사람의 크롬에 남은 문서에서 아무것도 가로채지 않는다)
 */
function relayRecorder(opts) {
  if (window.__relayInstalled) return;
  window.__relayInstalled = true;
  // ★듣기는 document가 아니라 window에 단다 — 팝업은 처음 about:blank 문서가 같은 출처 문서로 바뀔 때
  //  Window 객체를 그대로 쓴다. 그래서 이 함수는 다시 돌지 않고(위의 표시가 남는다) 옛 document에 단 것만 사라졌다

  const els = (window.__relayEls = window.__relayEls || {});
  let seq = 0;
  let mode = "browse";
  const forbidden = (opts.forbidden || []).map((s) => new RegExp(s, "u"));
  // 되돌릴 수 없어 보이는 단추 — 녹화에서 «되돌릴 수 없음»을 미리 켜 둔다(사람이 바꿀 수 있다)
  const RISKY = /저장|제출|등록|신청|결제|삭제|송금|이체|구매|주문하기|발행|확정|전송|submit|delete|remove|pay|buy|purchase|confirm|save|send/i;

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const emit = (p) => { try { window.__relayEmit && window.__relayEmit(p); } catch (_) { /* 바인딩이 아직 없다 */ } };

  // ★서버가 모드를 정하면 그것이 이긴다 — 페이지를 불러올 때 물어본 답이 **늦게** 오면
  //  (재생 중에 물어 «둘러보기»가 돌아오면) 그사이 서버가 정한 «읽기 · 녹화»를 덮어써 클릭이 그냥 지나갔다
  let modeSet = 0;
  window.__relaySetMode = (m) => { mode = m; modeSet++; hideOverlay(); };
  const asked = modeSet;
  if (window.__relayGetMode) window.__relayGetMode().then((m) => { if (modeSet === asked) mode = m; }, () => {});

  function mark(el) {
    const t = "r" + Date.now().toString(36) + (seq++).toString(36);
    els[t] = el;
    return t;
  }

  // ── 이름 짓기 ──
  const isControl = (el) => el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA";
  const textOf = (el) => norm(el.innerText || el.textContent || "").slice(0, 80);
  function labelOwnText(label) {
    const c = label.cloneNode(true);
    c.querySelectorAll("select,textarea,input,button,option").forEach((n) => n.remove());
    return norm(c.textContent);
  }
  function labelText(el) {
    const by = el.getAttribute && el.getAttribute("aria-labelledby");
    if (by) return norm(by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || "").join(" "));
    if (el.labels && el.labels.length) return norm(Array.from(el.labels).map(labelOwnText).join(" "));
    return "";
  }
  function roleOf(el) {
    const r = el.getAttribute("role");
    if (r) return r.split(/\s+/)[0];
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "select") return el.multiple || el.size > 1 ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "search") return "searchbox";
      if (type === "number") return "spinbutton";
      if (["", "text", "email", "tel", "url"].includes(type)) return "textbox";
      return null; // password 등 — 역할이 없다
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img" && el.getAttribute("alt")) return "img";
    return null;
  }
  function nameOf(el, role) {
    const aria = el.getAttribute("aria-label");
    if (aria) return norm(aria);
    const lt = labelText(el);
    if (lt) return lt;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "input" && ["button", "submit", "reset"].includes(type)) return norm(el.value);
    if (tag === "img") return norm(el.getAttribute("alt"));
    if (role === "button" || role === "link" || role === "heading" || role === "tab" || role === "menuitem") return textOf(el) || norm(el.getAttribute("title"));
    return norm(el.getAttribute("title"));
  }
  const KIND = { button: "버튼", link: "링크", textbox: "칸", searchbox: "칸", spinbutton: "칸", combobox: "선택 칸", listbox: "선택 칸", checkbox: "체크 칸", radio: "선택 단추", heading: "제목", img: "그림", tab: "탭", menuitem: "메뉴" };
  function humanLabel(el) {
    const role = roleOf(el);
    const name = (role && nameOf(el, role)) || labelText(el) || el.getAttribute("placeholder") || textOf(el).slice(0, 30) || el.getAttribute("name") || el.tagName.toLowerCase();
    const kind = KIND[role] || (el.type === "password" ? "칸" : "");
    return kind ? "'" + name + "' " + kind : name;
  }

  // ── 위치 후보 ──
  const esc = (s) => CSS.escape(s);
  const q = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  // 매번 바뀌어 보이는 id는 믿지 않는다 — 숫자 덩어리 · 해시 · 프레임워크가 지은 이름
  const unstable = (s) => /\d{4,}|[0-9a-f]{8,}|^(ember|react|ng|mui|css|jsx|radix|headlessui)[-_:]/i.test(s) || s.includes(":");
  function cssPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (cur.id && !unstable(cur.id) && document.querySelectorAll("#" + esc(cur.id)).length === 1) {
        parts.unshift("#" + esc(cur.id));
        return parts.join(" > ");
      }
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
      parts.unshift(same.length > 1 ? tag + ":nth-of-type(" + (same.indexOf(cur) + 1) + ")" : tag);
      cur = parent;
    }
    return parts.join(" > ");
  }
  window.__relayCssPath = cssPath;

  function candidates(el) {
    const out = [];
    const tid = el.getAttribute("data-testid");
    if (tid) out.push({ kind: "testid", value: tid });
    for (const a of ["data-test", "data-test-id", "data-qa", "data-cy"]) {
      const v = el.getAttribute(a);
      if (v) out.push({ kind: "css", value: "[" + a + '="' + q(v) + '"]' });
    }
    const role = roleOf(el);
    const name = role ? nameOf(el, role) : "";
    if (role && name && name.length <= 60) out.push({ kind: "role", value: role, name });
    if (isControl(el)) {
      const lt = labelText(el);
      if (lt && lt.length <= 60) out.push({ kind: "label", value: lt });
    }
    const ph = el.getAttribute("placeholder");
    if (ph) out.push({ kind: "placeholder", value: ph });
    if (!isControl(el)) {
      const t = textOf(el);
      if (t && t.length <= 40 && el.children.length === 0) out.push({ kind: "text", value: t });
    }
    if (el.id && !unstable(el.id)) out.push({ kind: "css", value: "#" + esc(el.id) });
    const nm = el.getAttribute("name");
    if (nm) out.push({ kind: "css", value: el.tagName.toLowerCase() + '[name="' + q(nm) + '"]' });
    out.push({ kind: "css", value: cssPath(el) });
    return out;
  }

  function nearText(el) {
    const lt = labelText(el);
    if (lt) return lt.slice(0, 60);
    // 표의 칸이면 그 열의 머리글 — 행 전체 글자(「연필 10 5,000원」)는 이름이 못 된다
    const cell = el.closest && el.closest("td, th");
    const table = cell && cell.closest("table");
    if (cell && table) {
      const i = Array.from(cell.parentElement.children).indexOf(cell);
      const head = table.querySelectorAll("thead tr:last-child > *")[i];
      if (head && norm(head.textContent)) return norm(head.textContent).slice(0, 60);
    }
    let p = el.previousElementSibling;
    if (p && norm(p.textContent)) return norm(p.textContent).slice(0, 60);
    // ★부모의 **자기 글자**만 — 자식들 글자까지 넣으면 옆 단추의 글자가 바뀌어도 이 요소가 «바뀜»이 된다
    const parent = el.parentElement;
    return parent ? norm(Array.from(parent.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ")).slice(0, 60) : "";
  }
  function fingerprint(el) {
    const attrs = {};
    for (const a of ["id", "name", "type", "class", "role", "aria-label", "placeholder", "href", "data-testid", "title", "alt", "value"]) {
      const v = el.getAttribute(a);
      if (v !== null && !(a === "value" && el.type === "password")) attrs[a] = v.slice(0, 120);
    }
    return { tag: el.tagName.toLowerCase(), attrs, text: el.type === "password" ? "" : textOf(el), nearText: nearText(el) };
  }
  function describe(el) {
    return { token: mark(el), label: humanLabel(el), candidates: candidates(el), fingerprint: fingerprint(el), tag: el.tagName.toLowerCase(), type: (el.getAttribute("type") || "").toLowerCase() };
  }

  // ── 표 ──
  function tableOf(el) {
    const row = el.closest("tr");
    if (!row || !el.closest("td, th")) return null;
    const body = row.parentElement;
    if (!body || body.tagName === "THEAD") return null;
    const rows = Array.from(body.children).filter((r) => r.tagName === "TR");
    if (rows.length < 2) return null;
    const table = row.closest("table");
    const headers = table ? Array.from(table.querySelectorAll("thead th, thead td")).map((th) => norm(th.textContent)) : [];
    const cells = Array.from(row.children).filter((c) => c.tagName === "TD" || c.tagName === "TH");
    const columns = cells.map((c, i) => ({ name: headers[i] || "열" + (i + 1), selector: c.tagName.toLowerCase() + ":nth-child(" + (i + 1) + ")" }));
    const caption = table && ((table.caption && norm(table.caption.textContent)) || table.getAttribute("aria-label"));
    return { rowsCss: cssPath(body) + " > tr", columns, count: rows.length, label: caption || "표" };
  }

  /**
   * **화면 요약**(AI가 사이트를 본다 · PLAN §42-8) — 보이는 요소들(누를 것 · 넣을 칸 · 읽을 글자 · 표)을 위치 후보와 함께.
   * 표의 몸통 행은 둘째 줄까지만(목록이 길면 요약이 커진다 — 표 전체는 table 하나로) · 넣은 값 · 비밀번호는 보내지 않는다
   */
  window.__relaySnapshot = (max) => {
    const limit = max || 160;
    const out = [];
    const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0"; };
    const deepRow = (el) => { const tr = el.closest && el.closest("tbody tr"); if (!tr) return false; return Array.from(tr.parentElement.children).indexOf(tr) >= 2; };
    const INTERACTIVE = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=menuitem], [role=combobox], [role=textbox]";
    const kindOf = (el) => {
      const role = roleOf(el);
      if (el.tagName === "SELECT" || role === "combobox" || role === "listbox") return "select";
      if (role === "checkbox" || role === "radio") return role;
      if (role === "textbox" || role === "searchbox" || role === "spinbutton" || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["button", "submit", "reset", "image"].includes((el.type || "").toLowerCase()))) return "input";
      if (role === "link") return "link";
      return "button";
    };
    const seen = new Set();
    const push = (el, kind) => {
      if (out.length >= limit || seen.has(el)) return;
      seen.add(el);
      const d = describe(el);
      const item = { token: d.token, kind, label: d.label, candidates: d.candidates, fingerprint: d.fingerprint, tag: d.tag, type: d.type };
      if (kind === "select") item.options = Array.from(el.options || []).slice(0, 15).map((o) => norm(o.textContent));
      if (kind === "text") item.text = textOf(el);
      out.push(item);
    };
    // 표 — 몸통 행이 둘 이상인 것
    for (const table of Array.from(document.querySelectorAll("table"))) {
      if (out.length >= limit) break;
      const body = table.tBodies && table.tBodies[0];
      const first = body && Array.from(body.children).find((r) => r.tagName === "TR");
      const cell = first && first.querySelector("td, th");
      if (!cell || !visible(table)) continue;
      const t = tableOf(cell);
      if (!t) continue;
      const near = table.previousElementSibling && /^H[1-6]$/.test(table.previousElementSibling.tagName) ? norm(table.previousElementSibling.textContent) : "";
      out.push({ token: mark(table), kind: "table", label: t.label !== "표" ? t.label : near || "표", table: t });
    }
    // 누를 것 · 넣을 칸 · 고를 것
    for (const el of Array.from(document.querySelectorAll(INTERACTIVE))) {
      if (out.length >= limit) break;
      if (!visible(el) || deepRow(el) || el.closest("[aria-hidden=true]")) continue;
      push(el, kindOf(el));
    }
    // 읽을 글자 — 자식이 없는 짧은 글(제목 · 값). 표 몸통은 표로
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (out.length >= limit) break;
      if (el.children.length || el.closest("tbody, script, style, noscript, button, a, select, option, textarea")) continue;
      const t = textOf(el);
      if (!t || t.length > 80 || !visible(el)) continue;
      push(el, "text");
    }
    return { url: location.href, title: document.title, items: out };
  };

  /** 표의 행 안을 눌렀으면 — 「행 고르기」로 바꿀 수 있게 행 · 칸 · 누른 것을 알린다 */
  function rowOf(el) {
    const t = tableOf(el);
    if (!t) return null;
    const row = el.closest("tr");
    const cell = el.closest("td, th");
    const cells = Array.from(row.children).filter((c) => c.tagName === "TD" || c.tagName === "TH");
    const cellSel = cell.tagName.toLowerCase() + ":nth-child(" + (cells.indexOf(cell) + 1) + ")";
    let click = cellSel;
    if (el !== cell) {
      const inner = cellSel + " " + el.tagName.toLowerCase();
      if (row.querySelectorAll(inner).length === 1) click = inner;
    }
    const rows = Array.from(row.parentElement.children).filter((r) => r.tagName === "TR");
    return { rowsCss: t.rowsCss, label: t.label, count: t.count, index: rows.indexOf(row), click,
      columns: t.columns.map((c, i) => ({ name: c.name, selector: c.selector, text: norm(cells[i] ? cells[i].innerText : "") })) };
  }
  /** 떠 있는 창(안내창 · 레이어) 안인가 — 처음만 뜨는 창이면 «있을 때만»이 맞다 */
  function floating(el) {
    for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
      if (cur.tagName === "DIALOG" || cur.getAttribute("role") === "dialog" || cur.getAttribute("aria-modal") === "true") return true;
      if (getComputedStyle(cur).position === "fixed") return true;
    }
    return false;
  }

  // ── 목록 — 표가 아니어도 같은 모양이 되풀이되면(뉴스 · 검색 결과 · 상품 카드) ──
  const classesOf = (e) => Array.from(e.classList).filter((c) => c && !/^\d/.test(c));
  /**
   * 빌드할 때마다 바뀌는 해시 클래스(「G9AjKl_FKMqXujGm」 · 「t_Om6lnKIHMRgeAj」) — 다음 배포에 이름이 바뀐다.
   * 사람이 지은 클래스(「sds-comps-full-layout」 · 「news_tit」)로 먼저 찾고, 그것으로 안 될 때만 쓴다
   */
  const hashed = (c) => c.length >= 10 && !c.includes("-") && /[a-z]/.test(c) && /[A-Z]/.test(c) && (/\d/.test(c) || /[A-Z]{2}/.test(c));
  const clsSel = (e, all) => classesOf(e).filter((c) => all || !hashed(c)).map((c) => "." + esc(c)).join("");
  const count = (root, sel) => { try { return root.querySelectorAll(sel).length; } catch (_) { return -1; } };
  /** 항목 안에서 고른 요소를 가리키는 상대 위치 — 항목마다 정확히 하나여야 쓸 수 있다 */
  function relSelector(item, el) {
    if (item === el) return ":scope";
    const steps = [];
    for (let cur = el; cur && cur !== item; cur = cur.parentElement) steps.unshift(cur);
    const tagOf = (e) => e.tagName.toLowerCase();
    const chain = (mode) => ":scope > " + steps.map((s) => {
      if (mode === "stable" || mode === "all") return tagOf(s) + clsSel(s, mode === "all");
      // 자리 번호 — «stable+nth»는 사람이 지은 클래스가 같은 형제 사이에서만 센다
      const cls = mode === "stable+nth" ? clsSel(s, false) : "";
      const same = Array.from(s.parentElement.children).filter((x) => x.tagName === s.tagName && (mode !== "stable+nth" || clsSel(x, false) === cls));
      if (same.length <= 1) return tagOf(s) + cls;
      // nth-of-type은 태그만 센다 — 클래스로 거른 형제 사이의 순서가 아니면 nth-child로
      const all = Array.from(s.parentElement.children).filter((x) => x.tagName === s.tagName);
      return tagOf(s) + cls + ":nth-of-type(" + (all.indexOf(s) + 1) + ")";
    }).join(" > ");
    const tries = [];
    if (clsSel(el, false)) tries.push(tagOf(el) + clsSel(el, false));
    tries.push(chain("stable"), chain("stable+nth"));
    if (clsSel(el, true)) tries.push(tagOf(el) + clsSel(el, true));
    tries.push(chain("all"), chain("nth"));
    return tries.find((sel) => count(item, sel) === 1) ?? null;
  }
  /**
   * ★가장 아래의 되풀이가 답이 아니다 — 뉴스 한 건 안에도 «제목 링크 · 요약 링크»처럼 같은 모양이 둘 있다.
   *  올라가며 목록이 될 수 있는 자리를 모두 찾고 **항목이 가장 많은** 자리를 고른다(같으면 아래쪽)
   */
  function listOf(el) {
    if (el.closest("table")) return null;   // 표는 tableOf가 맡는다
    let best = null;
    for (const found of listLevels(el)) if (!best || found.count > best.count) best = found;
    return best;
  }
  function* listLevels(el) {
    let item = el;
    for (let depth = 0; depth < 14 && item && item.parentElement && item !== document.body; depth++, item = item.parentElement) {
      const parent = item.parentElement;
      const mine = classesOf(item);
      const alike = Array.from(parent.children).filter((c) => c.tagName === item.tagName && (mine.length === 0 ? classesOf(c).length === 0 : classesOf(c).some((x) => mine.includes(x))));
      if (alike.length < 2) continue;
      const shared = mine.filter((x) => alike.every((c) => c.classList.contains(x)));
      const tag = item.tagName.toLowerCase();
      const full = tag + shared.map((c) => "." + esc(c)).join("");
      const stable = tag + shared.filter((c) => !hashed(c)).map((c) => "." + esc(c)).join("");
      // 해시 클래스를 빼도 같은 항목들만 가리키면 뺀 것으로
      const itemSel = stable !== full && count(parent, ":scope > " + stable) === count(parent, ":scope > " + full) ? stable : full;
      const rel = relSelector(item, el);
      if (rel === null) continue;
      const rows = Array.from(parent.querySelectorAll(":scope > " + itemSel));
      // ★항목 대부분에 같은 자리가 있어야 목록이다 — 항목 안의 작은 되풀이(제목 줄 · 요약 줄)에 속지 않게
      const hits = rows.filter((r) => rel === ":scope" || r.querySelectorAll(rel).length === 1);
      if (hits.length < 2 || hits.length < rows.length * 0.6) continue;
      const titleLike = el.tagName === "A" || /^H[1-6]$/.test(el.tagName) || !!el.closest("h1,h2,h3,h4,h5,h6");
      const columns = [{ name: titleLike ? "제목" : "값", selector: rel }];
      if (el.closest("a[href]") || (rel !== ":scope" && el.querySelector && el.querySelector("a[href]"))) columns.push({ name: "링크", selector: rel, strategy: "link" });
      yield { rowsCss: cssPath(parent) + " > " + itemSel, columns, count: rows.length, label: "목록", list: true };
    }
  }
  /** 읽기에서 누른 것 — 링크 안의 강조 글자(<mark>오늘</mark>)를 눌러도 링크 전체를 고른다 */
  function pickedOf(target) {
    const el = target.nodeType === 1 ? target : target.parentElement;
    if (/^(MARK|B|STRONG|EM|I|SPAN|SMALL|U)$/.test(el.tagName)) {
      const a = el.closest("a, h1, h2, h3, h4, h5, h6");
      if (a && norm(a.innerText).length <= 200) return a;
    }
    return el;
  }

  // ── 무엇을 누른 것인가 ──
  const INTERACTIVE = "button, a[href], input, select, textarea, label, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [onclick]";
  function controlOf(target) {
    let el = (target.closest && target.closest(INTERACTIVE)) || target;
    if (el.tagName === "LABEL" && el.control) el = el.control;
    return el;
  }
  const isTextual = (el) => el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["button", "submit", "reset", "image", "checkbox", "radio", "file", "hidden", "range", "color"].includes((el.type || "").toLowerCase()));
  function isForbidden(el) {
    if (forbidden.length === 0) return false;
    const text = norm([el.innerText, el.value, el.getAttribute("alt"), el.getAttribute("title"), el.getAttribute("aria-label"), el.id, el.getAttribute("onclick")].filter(Boolean).join(" "));
    return forbidden.some((re) => re.test(text));
  }
  // 서버가 대신 누를 때는 한 번 지나가게 한다
  function passing() {
    if (window.__relayPass > 0) { window.__relayPass--; return true; }
    return false;
  }

  // ── 읽기 모드의 덧칠 ──
  let overlay = null;
  function showOverlay(el) {
    if (!overlay || overlay.ownerDocument !== document) {
      overlay = document.createElement("div");
      overlay.setAttribute("data-relay-overlay", "");
      overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b5bdb;background:rgba(59,91,219,.12);border-radius:3px;transition:all .05s";
      document.documentElement.appendChild(overlay);
    }
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  }
  function hideOverlay() { if (overlay) overlay.style.display = "none"; }
  window.addEventListener("mousemove", (e) => {
    if (mode !== "read") return;
    const el = e.target;
    if (el && el.nodeType === 1 && !el.hasAttribute("data-relay-overlay")) showOverlay(el);
  }, true);

  // ── 가로채기 ──
  window.addEventListener("mousedown", (e) => {
    const el = controlOf(e.target);
    if (el.tagName !== "SELECT" || mode === "read" || mode === "off" || !e.isTrusted) return;
    // 기본 드롭다운은 screencast에 안 보인다 — 막고 보기를 보낸다
    e.preventDefault();
    const r = el.getBoundingClientRect();
    emit({ kind: "select-open", ...describe(el), record: mode === "record",
      options: Array.from(el.options).map((o) => ({ value: o.value, label: norm(o.textContent), selected: o.selected })),
      rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
  }, true);

  // ★막힌(disabled) 칸은 click이 오지 않는다 — 상세 화면의 «배송 방법» 같은 읽기 전용 고르기. 읽기 모드에서는 pointerdown으로 고른다
  const isDisabled = (el) => !!(el && el.closest && el.closest(":disabled"));
  window.addEventListener("pointerdown", (e) => {
    if (!e.isTrusted || mode !== "read") return;
    const el = e.target && e.target.nodeType === 1 ? e.target : null;
    if (!isDisabled(el)) return;
    e.preventDefault();
    hideOverlay();
    emit({ kind: "pick", ...describe(el.closest(":disabled")), table: tableOf(el) });
  }, true);

  window.addEventListener("click", (e) => {
    if (!e.isTrusted || mode === "browse" || mode === "off") return;
    if (mode === "read") {
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = pickedOf(e.target);
      hideOverlay();
      emit({ kind: "pick", ...describe(el), table: tableOf(el) || listOf(el) });
      return;
    }
    if (passing()) return;
    const el = controlOf(e.target);
    if (el.tagName === "SELECT" || isTextual(el)) return;   // 칸에 들어가는 것은 그대로 둔다
    e.preventDefault();
    e.stopImmediatePropagation();
    if (isForbidden(el)) { emit({ kind: "blocked", label: humanLabel(el) }); return; }
    const type = (el.type || "").toLowerCase();
    if (el.tagName === "INPUT" && (type === "checkbox" || type === "radio")) {
      emit({ kind: "check", ...describe(el), checked: type === "radio" ? true : !el.checked });
      return;
    }
    // ☆POST 제출이라고 다 위험하지 않다 — 로그인도 POST다. 낱말로만 미리 켠다(사람이 바꿀 수 있다)
    emit({ kind: "click", ...describe(el), risky: RISKY.test(humanLabel(el)), row: rowOf(el), floating: floating(el) });
  }, true);

  window.addEventListener("change", (e) => {
    if (mode !== "record") return;
    const el = e.target;
    if (!isTextual(el) || el.__relayLastFill === el.value) return;
    el.__relayLastFill = el.value;
    const secret = (el.type || "").toLowerCase() === "password";
    emit({ kind: "fill", ...describe(el), value: secret ? null : el.value, secret });
  }, true);

  window.addEventListener("keydown", (e) => {
    if (mode !== "record" || !e.isTrusted || e.key !== "Enter" || e.isComposing) return;
    const el = e.target;
    if (!isTextual(el) || el.tagName === "TEXTAREA") return;
    if (passing()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const secret = (el.type || "").toLowerCase() === "password";
    const changed = el.__relayLastFill !== el.value;
    el.__relayLastFill = el.value;
    emit({ kind: "enter", ...describe(el), fill: changed ? { value: secret ? null : el.value, secret } : null });
  }, true);
}
