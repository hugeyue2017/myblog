/* ==========================================================
   capsule-pjax.js —— 站内「局部导航」（翻页不重载整个文档）
   ----------------------------------------------------------
   为什么需要它：
   本站是多页站。原来每点一个链接，浏览器就把整个文档销毁重建 ——
     · 背景乐挂件的 <audio> 跟着被销毁，音乐一秒断一次；下一页即使
       想接着放，也会被浏览器「新页面没有用户手势」的自动播放策略拦下，
       表现就是「一翻页就自动暂停」；
     · 整页重载本身也带来一次白屏 / 卡顿。
   改成局部导航后，<audio> 从头到尾是同一个元素，一秒都不停。

   做法（刻意保守，不碰任何现有结构）：
   · 正文区 = <header class="topbar"> 之后、<footer id="foot"> 之前的那一段。
     只换这一段，外加顶栏里的 .topnav（首页的导航项和其他页不一样）。
   · <head> 只同步 title / description / canonical / og / twitter。
   · 背景乐挂件、内容保护、进度条、主题按钮、页脚都在替换区之外，统统不动。
   ⚠️ 正因为不换 <head>，影像页的样式必须常载（capsule-gallery.css），
      不能挂在它自己的 {{ define "head" }} 里，否则从别的页点进去会「有内容没样式」。

   页面级脚本（胶片条 / 照片带）各自提供 boot / destroy，换页时先拆干净再重建。

   安全阀：任何一步出问题（网络失败、返回的不是本站页面、锚点找不到、超时）
   都直接 location.assign(url) 交回浏览器，退化成普通跳转，绝不放用户白屏。
   在 hugo.toml 里把 capsulePjax 设成 false 即可整体关闭（baseof 就不会引入本文件）。
   ========================================================== */
(function () {
  'use strict';

  /* 老浏览器没有这些就先别玩：直接不接管，保持原生多页跳转 */
  if (!window.fetch || !window.Promise || !window.DOMParser ||
      !window.history || !history.pushState || !Element.prototype.closest) return;

  var doc = document;
  var TIMEOUT = 8000;                 /* 超过这个时间没回来就退化成普通跳转 */
  var busy = false;
  var prefetched = Object.create(null);

  /* ---------- 取新文档 ---------- */
  function load(url) {
    return new Promise(function (resolve, reject) {
      var ac = null, tid = 0;
      if (typeof AbortController === 'function') {
        ac = new AbortController();
        tid = setTimeout(function () { try { ac.abort(); } catch (e) {} }, TIMEOUT);
      }
      fetch(url, {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'capsule-pjax' },
        signal: ac ? ac.signal : undefined
      }).then(function (r) {
        if (tid) clearTimeout(tid);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (html) {
        var d;
        try { d = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { throw e }
        if (!d || !topbar(d) || !foot(d)) throw new Error('不是本站页面');
        resolve(d);
      })['catch'](function (e) { if (tid) clearTimeout(tid); reject(e) });
    });
  }

  /* ---------- 锚点 ---------- */
  function topbar(d) { return d.querySelector('header.topbar'); }
  function foot(d) { return d.querySelector('footer#foot'); }

  /* 把 [topbar 之后, footer 之前) 的节点摘出来 */
  function takeBody(d, into) {
    var a = topbar(d), b = foot(d);
    if (!a || !b) return false;
    var n = a.nextSibling;
    while (n && n !== b) { var nx = n.nextSibling; into.appendChild(n); n = nx; }
    return true;
  }

  function swapBody(newDoc) {
    var oa = topbar(doc), ob = foot(doc);
    if (!oa || !ob) return false;
    var frag = doc.createDocumentFragment();
    if (!takeBody(newDoc, frag)) return false;
    if (frag.childNodes.length === 0) return false;
    var n = oa.nextSibling;
    while (n && n !== ob) { var nx = n.nextSibling; n.parentNode.removeChild(n); n = nx; }
    ob.parentNode.insertBefore(frag, ob);
    return true;
  }

  function swapNav(newDoc) {
    var on = doc.querySelector('header.topbar .topnav');
    var nn = newDoc.querySelector('header.topbar .topnav');
    if (on && nn) on.parentNode.replaceChild(nn, on);
  }

  /* ---------- <head> 里需要跟着走的那几项 ---------- */
  var HEAD_PAIRS = [
    ['meta[name="description"]', 'content'],
    ['meta[property="og:title"]', 'content'],
    ['meta[property="og:description"]', 'content'],
    ['meta[property="og:url"]', 'content'],
    ['meta[property="og:type"]', 'content'],
    ['meta[property="og:image"]', 'content'],
    ['meta[name="twitter:image"]', 'content'],
    ['meta[name="twitter:title"]', 'content'],
    ['meta[name="twitter:description"]', 'content'],
    ['link[rel="canonical"]', 'href']
  ];
  function syncHead(newDoc) {
    try { if (newDoc.title) doc.title = newDoc.title; } catch (e) {}
    for (var i = 0; i < HEAD_PAIRS.length; i++) {
      var sel = HEAD_PAIRS[i][0], attr = HEAD_PAIRS[i][1];
      var a = doc.querySelector(sel), b = newDoc.querySelector(sel);
      if (!a || !b) continue;
      var v = b.getAttribute(attr);
      if (v != null) a.setAttribute(attr, v);
    }
  }

  /* ---------- 页面级脚本：拆干净 / 重建 ---------- */
  function teardownPage() {
    try { if (window.CapStrip) window.CapStrip.destroy(); } catch (e) {}
    try { if (window.CapGallery) window.CapGallery.destroy(); } catch (e) {}
  }
  function bootPage() {
    /* .rv 淡入。这是最容易出人命的一步 —— 漏掉的话整页正文都停在
       opacity:0（「换了页但一片空白」），所以两条路都留着。 */
    try {
      if (window.__capReveal) { window.__capReveal(); }
      else {
        var l = doc.querySelectorAll('.rv:not(.in)');
        for (var i = 0; i < l.length; i++) l[i].classList.add('in');
      }
    } catch (e) {
      try {
        var m = doc.querySelectorAll('.rv:not(.in)');
        for (var j = 0; j < m.length; j++) m[j].classList.add('in');
      } catch (e2) {}
    }
    try { if (window.CapStrip) window.CapStrip.boot(); } catch (e) {}
    try { if (window.CapGallery) window.CapGallery.boot(); } catch (e) {}
    try {
      doc.dispatchEvent(new CustomEvent('cap:pjax', { bubbles: true }));
    } catch (e) {}
  }

  /* ---------- 走 ---------- */
  function go(url, push, restoreY) {
    if (busy) return;
    busy = true;
    var root = doc.documentElement;
    root.classList.add('cap-nav');
    load(url).then(function (newDoc) {
      teardownPage();
      if (!swapBody(newDoc)) throw new Error('正文区对不上');
      swapNav(newDoc);
      syncHead(newDoc);
      if (push) {
        try {
          history.replaceState({ cap: 1, capY: Math.round(window.pageYOffset || 0) }, '', location.href);
          history.pushState({ cap: 1, capY: 0 }, '', url);
        } catch (e) { location.assign(url); return; }
      }
      try { window.scrollTo(0, restoreY || 0); } catch (e) {}
      bootPage();
      busy = false;
      root.classList.remove('cap-nav');
    })['catch'](function () {
      /* 任何异常都不在半路上晾着用户：退回普通跳转 */
      busy = false;
      root.classList.remove('cap-nav');
      window.location.assign(url);
    });
  }

  /* ---------- 拦截点击 ---------- */
  function sameTarget(a) {
    var t = a.getAttribute('target');
    return !t || t === '_self';
  }
  function okHref(href) {
    if (!href) return false;
    if (href.indexOf('#') === 0) return false;           /* 页内锚点：交给浏览器 */
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) return false;
    var u;
    try { u = new URL(href, location.href); } catch (e) { return false }
    if (u.origin !== location.origin) return false;      /* 外链 */
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    /* 同路径只换了 hash（灯箱那种）→ 不是换页 */
    if (u.pathname === location.pathname && u.search === location.search) return false;
    return u;
  }

  doc.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;                      /* 别的脚本已经处理（如胶片条拖过就不算点击） */
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (busy) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !sameTarget(a) || a.hasAttribute('download')) return;
    var rel = a.getAttribute('rel');
    if (rel && rel.indexOf('external') > -1) return;
    var u = okHref(a.getAttribute('href'));
    if (!u) return;
    e.preventDefault();
    go(u.href, true, 0);
  }, false);

  /* ---------- 后退 / 前进 ---------- */
  window.addEventListener('popstate', function (ev) {
    var st = ev.state;
    var y = (st && typeof st.capY === 'number') ? st.capY : 0;
    go(location.href, false, y);
  });

  /* ---------- 顺手预热：鼠标划过站内链接时先让浏览器把文档抓进 HTTP 缓存 ---------- */
  doc.addEventListener('pointerover', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !sameTarget(a) || a.hasAttribute('download')) return;
    var u = okHref(a.getAttribute('href'));
    if (!u || prefetched[u.href]) return;
    prefetched[u.href] = 1;
    try {
      var l = doc.createElement('link');
      l.rel = 'prefetch';
      l.as = 'document';
      l.href = u.href;
      doc.head.appendChild(l);
    } catch (err) {}
  }, true);

  /* 调试钩子：验收脚本用，正常使用无感 */
  window.__capPjax = {
    go: go,
    get busy() { return busy; },
    swapBody: swapBody,
    /* 给验收脚本问「这个 href 你们会接管吗」—— 直接派发点击会真的把页面导走 */
    canHandle: function (href) { return !!okHref(href); }
  };
})();
