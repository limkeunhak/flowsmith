// 정적 사이트의 트리 · 검색 — 서버 없이(file://) 돈다. 데이터는 site-data.js(트리) · search-data.js(본문 — 검색할 때 싣는다)
(function () {
  var root = document.body.dataset.root || "";
  var here = document.body.dataset.page || "";
  var site = window.SITE || { pages: [] };
  var enc = function (p) { return p.split("/").map(encodeURIComponent).join("/"); };
  var hrefOf = function (p) { return root + enc(p); };

  // ── 트리 — 깊이 차례(pages.csv의 순서)로 감싼다. 지금 페이지의 조상은 펼친다 ──
  var nav = document.getElementById("tree");
  if (nav) {
    var stack = [{ depth: -1, ul: document.createElement("ul") }];
    nav.appendChild(stack[0].ul);
    var current = null;
    site.pages.forEach(function (pg, i) {
      while (stack.length > 1 && stack[stack.length - 1].depth >= pg.d) stack.pop();
      var li = document.createElement("li");
      var hasKids = i + 1 < site.pages.length && site.pages[i + 1].d > pg.d;
      if (hasKids) {
        var t = document.createElement("button");
        t.className = "tog"; t.type = "button"; t.setAttribute("aria-label", "펼치기"); t.textContent = "▸";
        t.addEventListener("click", function () { li.classList.toggle("open"); t.textContent = li.classList.contains("open") ? "▾" : "▸"; });
        li.appendChild(t);
      }
      var a = document.createElement("a");
      a.href = hrefOf(pg.p); a.textContent = pg.t; a.title = pg.t;
      if (pg.p === here) { a.className = "here"; current = li; }
      li.appendChild(a);
      stack[stack.length - 1].ul.appendChild(li);
      if (hasKids) { var ul = document.createElement("ul"); li.appendChild(ul); stack.push({ depth: pg.d, ul: ul, li: li }); }
    });
    // 조상을 펼친다(맨 위는 늘 펼침)
    for (var el = current; el && el !== nav; el = el.parentElement) {
      if (el.tagName === "LI" && el.querySelector(":scope > ul")) { el.classList.add("open"); var b = el.querySelector(":scope > .tog"); if (b) b.textContent = "▾"; }
    }
    var top = nav.querySelector("ul > li");
    if (top) { top.classList.add("open"); var tb = top.querySelector(":scope > .tog"); if (tb) tb.textContent = "▾"; }
    if (current) current.scrollIntoView({ block: "center" });
  }

  // ── 검색 — 처음 칠 때 search-data.js를 싣는다 ──
  var q = document.getElementById("q");
  var hits = document.getElementById("hits");
  var loaded = false;
  var load = function (then) {
    if (loaded) return then();
    var s = document.createElement("script");
    s.src = root + "search-data.js";
    s.onload = function () { loaded = true; then(); };
    document.head.appendChild(s);
  };
  var show = function () {
    var w = q.value.trim().toLowerCase();
    if (!w) { hits.hidden = true; return; }
    var words = w.split(/\s+/);
    var found = (window.SEARCH || []).filter(function (d) {
      var hay = (d.t + " " + d.x).toLowerCase();
      return words.every(function (x) { return hay.indexOf(x) >= 0; });
    }).slice(0, 30);
    hits.innerHTML = "";
    if (!found.length) { hits.textContent = "찾은 것이 없습니다"; }
    found.forEach(function (d) {
      var a = document.createElement("a");
      a.href = hrefOf(d.p);
      var at = d.x.toLowerCase().indexOf(words[0]);
      var snip = at >= 0 ? d.x.slice(Math.max(0, at - 30), at + 90) : d.x.slice(0, 120);
      var b = document.createElement("b"); b.textContent = d.t;
      var sp = document.createElement("span"); sp.textContent = snip;
      a.appendChild(b); a.appendChild(sp);
      hits.appendChild(a);
    });
    hits.hidden = false;
  };
  if (q) {
    q.addEventListener("input", function () { load(show); });
    q.addEventListener("keydown", function (e) { if (e.key === "Escape") { q.value = ""; hits.hidden = true; } });
    document.addEventListener("click", function (e) { if (e.target !== q && !hits.contains(e.target)) hits.hidden = true; });
  }
})();
