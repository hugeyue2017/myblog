/* ==========================================================
   capsule-gallery.js —— 影像页 · 横向照片带
   拖动换位 / 松手吸附居中 / 居中聚焦 / 悬停放大 / 点击开灯箱 /
   方向键翻张 / #pN 深链落位

   原本内嵌在 layouts/_default/gallery.html 的 <script> 里。
   现在外置 + 改造成可重入模块，是为了配合全站的**局部导航**
   （capsule-pjax.js）：翻页时正文被换掉，影像页会被「换进换出」，
   所以必须做到 boot → destroy 干净 → 还能再 boot。

   重入的两条规矩：
   1) 绑在 window / document 上的监听一律走 onWin()，内部挂
      AbortController 的 signal；destroy() 一个 abort() 全摘干净。
      （绑在 #cap-gallery 内部的元素级监听不用管 —— 节点被换掉就一起回收。）
   2) 逐帧循环用 alive 开关退出；延后的 setTimeout 用世代号 gen 守卫，
      销毁之后残留的那一次回调不许再碰 DOM。
   ========================================================== */
(function () {
  'use strict';

  var ac = null, alive = false, raf = 0, gen = 0;

  /* 把回调绑到 window 上，并跟随本次 boot 的生命周期 */
  function onWin(t, f, o) {
    if (!ac) { try { window.addEventListener(t, f, o); } catch (e) {} return; }
    var k = {}, p;
    if (o) { for (p in o) { if (Object.prototype.hasOwnProperty.call(o, p)) k[p] = o[p]; } }
    k.signal = ac.signal;
    try { window.addEventListener(t, f, k); } catch (e) { window.addEventListener(t, f, o); }
  }

  function destroy() {
    alive = false;
    gen++;                                   /* 让上一世代残留的 setTimeout 失效 */
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (ac) { try { ac.abort(); } catch (e) {} ac = null; }
  }

  function boot() {
    destroy();                               /* 先确保没有上一份还在跑 */
    if (typeof AbortController === 'function') ac = new AbortController();
    var g0 = gen;

  var root = document.getElementById('cap-gallery');
  if (!root) return false;
  var stage = root.querySelector('.stage');
  var view = root.querySelector('.view');
  var slides = [].slice.call(view.querySelectorAll('.slide'));
  var N = slides.length;
  if (!stage || !view || !N) return;

  var frames = [], INFO = [], hov = [];
  for (var n = 0; n < N; n++) {
    frames.push(slides[n].querySelector('.frame'));
    var im = slides[n].querySelector('img');
    INFO.push({
      t: slides[n].getAttribute('data-t') || '',
      n: slides[n].getAttribute('data-n') || '',
      d: slides[n].getAttribute('data-d') || '',
      /* 灯箱优先用 data-full（模板生成的 1600 宽去 EXIF 副本），
         没有才退回到页面上那张。 */
      src: slides[n].getAttribute('data-full') || (im ? im.getAttribute('src') : '')
    });
    hov.push(1);
  }

  var nowNum = root.querySelector('#nowNum');
  var nowTtl = root.querySelector('#nowTtl');
  var nowSub = root.querySelector('#nowSub');
  var ticks = [].slice.call(root.querySelectorAll('.ticks i'));

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ================= 尺寸与位置表 ================= */
  var stageW = 0, gap = 26, Wd = [], OFF = [], TOTAL = 1, ENTER_D = [];
  var activeIdx = 0, cur = 0, goal = 0;

  function wrapTo(d) {                       // 折到 [-TOTAL/2, TOTAL/2)
    return d - Math.round(d / TOTAL) * TOTAL;
  }

  function measure() {
    stageW = stage.clientWidth || window.innerWidth;
    gap = stageW <= 640 ? 14 : 26;
    var acc = 0;
    for (var i = 0; i < N; i++) {
      Wd[i] = slides[i].offsetWidth || 220;
      OFF[i] = acc + Wd[i] / 2;
      acc += Wd[i] + gap;
    }
    TOTAL = acc;                             // 各张宽度之和 + N 个间距 = 绕一圈的周期
  }

  // 入场顺序从当前居中那张往两边扩散（深链接进来时也是从那张开始亮）
  function measureEnter() {
    for (var i = 0; i < N; i++) {
      var steps = Math.abs(wrapTo(OFF[i] - cur)) / Math.max(Wd[i] + gap, 1);
      ENTER_D[i] = Math.min(steps, 7) * 0.055;
    }
  }

  function nearestIndex(px) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < N; i++) {
      var d = Math.abs(wrapTo(OFF[i] - px));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* ================= 运动状态 ================= */
  var vel = 0, spd = 0, elapsed = 0, last = 0, visible = true;
  var snapping = false, snapT0 = 0, snapFrom = 0, snapTarget = 0;
  var SNAP_MS = 720;
  var DRAG_GAIN = 1.15;                      // 拖 1px，照片带走 1.15px
  var FOCUS_K = 0.38;                        // 聚焦范围 = 展台宽度的这个比例

  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  function snapToIndex(i, instant) {
    i = ((i % N) + N) % N;
    var t = OFF[i] + Math.round((goal - OFF[i]) / TOTAL) * TOTAL;   // 就近绕，不空转一圈
    if (instant || reduce) {
      goal = cur = t; vel = 0; spd = 0; snapping = false; activeIdx = i;
      return;
    }
    snapFrom = goal; snapTarget = t; snapT0 = 0; snapping = true; vel = 0;
  }

  /* ================= 指针手势 ================= */
  var dragging = false, pressX = 0, pressY = 0, prevX = 0, dragFrom = 0;
  var dragDist = 0, pressIdx = -1, axis = 0, lastMoveT = 0;

  function indexAtPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return -1;
    var s = el.closest('.slide');
    return s ? slides.indexOf(s) : -1;
  }

  stage.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true; snapping = false;
    pressX = prevX = e.clientX; pressY = e.clientY;
    dragFrom = goal; dragDist = 0; axis = 0; vel = 0;
    pressIdx = indexAtPoint(e.clientX, e.clientY);
    lastMoveT = performance.now();
    stage.classList.add('is-grabbing');
  });

  onWin('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - pressX, dy = e.clientY - pressY;
    var adx = Math.abs(dx), ady = Math.abs(dy);

    if (!axis) {
      if (adx <= 4 && ady <= 4) return;
      axis = adx >= ady * 0.8 ? 1 : 2;        // 略偏向横向：这条带子就是横着用的
      if (axis === 2) {                       // 用户在竖向翻页面：放手，别抢
        dragging = false;
        stage.classList.remove('is-grabbing');
        return;
      }
    }
    if (axis === 2) return;

    dragDist = Math.max(adx, ady);
    goal = dragFrom - dx * DRAG_GAIN;

    var t = performance.now();
    var dts = Math.max((t - lastMoveT) / 1000, 0.008);
    lastMoveT = t;
    var step = e.clientX - prevX;
    prevX = e.clientX;
    vel = vel * 0.6 + (-step / dts) * 0.4;   // 单位：位置/秒
  });

  function release() {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-grabbing');

    if (dragDist <= 6 && pressIdx >= 0) {    // 基本没动 = 点击
      if (pressIdx === activeIdx) openLB(pressIdx);
      else snapToIndex(pressIdx);            // 点侧边那张 → 转到中间
      return;
    }
    snapToIndex(nearestIndex(goal + vel * 0.17));   // 带一点抛掷
  }
  onWin('pointerup', release);
  onWin('pointercancel', function () {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-grabbing');
    snapToIndex(nearestIndex(goal));
  });

  /* 横向滚轮 / shift+滚轮 → 换照片；普通竖向滚动交回页面 */
  var wheelT = 0;
  stage.addEventListener('wheel', function (e) {
    var dx = e.deltaX;
    if (Math.abs(dx) < Math.abs(e.deltaY)) dx = e.shiftKey ? e.deltaY : 0;
    if (!dx) return;
    e.preventDefault();
    snapping = false; vel = 0;
    goal += dx * 1.6;
    clearTimeout(wheelT);
    wheelT = setTimeout(function () { snapToIndex(nearestIndex(goal)); }, 130);
  }, { passive: false });

  /* 悬停放大 */
  slides.forEach(function (el, i) {
    el.addEventListener('mouseenter', function () { hov[i] = 1.065; el.classList.add('is-hot'); });
    el.addEventListener('mouseleave', function () { hov[i] = 1; el.classList.remove('is-hot'); });
  });

  /* ================= 渲染状态（逐帧缓动） ================= */
  var vis = [], memo = [];
  for (var v0 = 0; v0 < N; v0++) { vis.push({ o: 0, s: 1, h: 1 }); memo.push(''); }
  var tickFirst = true;
  var lastHUD = -1;

  function tick(now) {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    if (!last) last = now;
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!visible) return;
    elapsed += dt;

    /* --- 位置推进 --- */
    if (snapping) {
      if (!snapT0) snapT0 = now;
      var st = (now - snapT0) / SNAP_MS;
      if (st >= 1) { goal = snapTarget; snapping = false; snapT0 = 0; }
      else goal = snapFrom + (snapTarget - snapFrom) * easeOutExpo(st);
    }
    cur += (goal - cur) * (1 - Math.exp(-9 * dt));

    /* 速度（只用来做「快速拖动时整体微微收缩」的观感） */
    var wantSpd = dragging ? Math.abs(vel) : 0;
    spd += (wantSpd - spd) * (1 - Math.exp(-5 * dt));

    /* --- 逐张摆放 --- */
    var focusSpan = Math.max(150, stageW * FOCUS_K);
    var sp = 1 - Math.min(spd / 2600, 1) * 0.10;
    var kk = 1 - Math.exp(-10 * dt);
    var best = Infinity, ai = 0;

    for (var i = 0; i < N; i++) {
      var d = wrapTo(OFF[i] - cur);
      var ad = Math.abs(d);
      if (ad < best) { best = ad; ai = i; }
      var f = Math.max(0, 1 - ad / focusSpan);

      var et = reduce ? 1 : Math.max(0, Math.min(1, (elapsed - ENTER_D[i]) / 0.9));
      var ee = 1 - Math.pow(1 - et, 3);

      var v = vis[i];
      // 静止时所有照片同高同线（整条带子上下沿对齐才不显乱），
      // 「谁在中间」只靠明暗区分；拖动得快时整体微微收缩，是参考站那种呼吸感。
      var to = (ad > stageW * 0.92) ? 0 : (0.28 + 0.72 * f);
      v.o += (to * ee - v.o) * kk;
      v.s += (sp - v.s) * kk;
      v.h += (hov[i] - v.h) * kk;

      var el = slides[i];
      var tf = 'translate3d(' + d.toFixed(2) + 'px,0,0) scale(' + v.s.toFixed(4) + ')';
      if (memo[i] !== tf) { el.style.transform = tf; memo[i] = tf; }
      var op = v.o.toFixed(3);
      if (el.style.opacity !== op) el.style.opacity = op;

      var vs = (ad > stageW * 0.95 + Wd[i]) ? 'hidden' : 'visible';
      if (el.style.visibility !== vs) el.style.visibility = vs;

      frames[i].style.transform = 'scale(' + v.h.toFixed(4) + ')';
      if (ee < 1) {
        var cut = (50 * (1 - ee)).toFixed(2);
        frames[i].style.clipPath = 'inset(' + cut + '% 0 ' + cut + '% 0)';
      } else if (frames[i].style.clipPath !== 'none') {
        frames[i].style.clipPath = 'none';
      }
    }

    if (tickFirst || ai !== activeIdx) {
      activeIdx = ai;
      tickFirst = false;
      for (var q = 0; q < N; q++) slides[q].classList.toggle('is-active', q === ai);
      updateHUD();
    }
  }

  /* ================= HUD / 刻度 ================= */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* 备注 + 日期（写在哪一条下面就在那条显示；date 是可选字段） */
  function subOf(i) {
    var s = INFO[i].n || '', d = INFO[i].d || '';
    if (!d) return s;
    return s ? (s + ' · ' + d) : d;
  }
  function updateHUD() {
    if (lastHUD === activeIdx) return;
    lastHUD = activeIdx;
    if (nowNum) nowNum.textContent = pad(activeIdx + 1) + ' / ' + pad(N);
    if (nowTtl) nowTtl.textContent = INFO[activeIdx].t;
    if (nowSub) nowSub.textContent = subOf(activeIdx);
    for (var i = 0; i < ticks.length; i++) ticks[i].classList.toggle('on', i === activeIdx);
  }

  /* ================= 灯箱 ================= */
  var lb = root.querySelector('#lb');
  var lbImg = root.querySelector('#lbImg');
  var lbNum = root.querySelector('#lbNum');
  var lbTtl = root.querySelector('#lbTtl');
  var lbSub = root.querySelector('#lbSub');
  var curLB = 0, lbOpen = false;

  function openLB(i) {
    if (!lb) return;
    curLB = ((i % N) + N) % N;
    lbImg.src = INFO[curLB].src;
    lbImg.alt = INFO[curLB].t;
    lbNum.textContent = pad(curLB + 1) + ' / ' + pad(N);
    lbTtl.textContent = INFO[curLB].t;
    lbSub.textContent = subOf(curLB);
    lb.classList.add('is-open');
    lbOpen = true;
    if (history.replaceState) history.replaceState(null, '', '#p' + (curLB + 1));
  }
  function closeLB() { lb.classList.remove('is-open'); lbOpen = false; }

  if (lb) {
    root.querySelector('#lbX').addEventListener('click', closeLB);
    root.querySelector('#lbPrev').addEventListener('click', function (e) { e.stopPropagation(); openLB(curLB - 1); });
    root.querySelector('#lbNext').addEventListener('click', function (e) { e.stopPropagation(); openLB(curLB + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLB(); });
  }

  /* ================= 键盘 ================= */
  onWin('keydown', function (e) {
    if (lbOpen) {
      if (e.key === 'Escape') closeLB();
      else if (e.key === 'ArrowLeft') openLB(curLB - 1);
      else if (e.key === 'ArrowRight') openLB(curLB + 1);
      return;
    }
    if (!visible) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); snapToIndex(activeIdx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); snapToIndex(activeIdx + 1); }
  });

  /* ================= /gallery/#p7 这类深链接 =================
     首页胶片条每一帧都是 href="/gallery/#pN"，就是靠这里落位的。 */
  /* 兜底修复：老浏览器不认 overflow:clip，锚点滚动仍可能把 .view 横向滚走。
     这里把 stage 到 body 这一串的 scrollLeft/scrollTop 归零（documentElement 不动，
     那是页面自身的滚动位置）。 */
  function unstick(){
    var n = stage;
    while (n && n !== document.documentElement) {
      if (n.scrollLeft) n.scrollLeft = 0;
      if (n.scrollTop) n.scrollTop = 0;
      n = n.parentNode;
    }
  }
  function hashIndex() {
    var m = (location.hash || '').match(/^#p(\d+)$/);
    if (!m) return -1;
    var i = parseInt(m[1], 10) - 1;
    return (i >= 0 && i < N) ? i : -1;
  }
  function flash(i) {
    if (!slides[i]) return;
    slides[i].classList.add('is-hot');
    setTimeout(function () { slides[i].classList.remove('is-hot'); }, 2400);
  }
  onWin('hashchange', function () {
    var i = hashIndex();
    if (i >= 0) { snapToIndex(i); flash(i); }
    /* 锚点滚动可能发生在 hashchange 之后，所以多补几次 */
    unstick(); setTimeout(unstick, 0); setTimeout(unstick, 120); setTimeout(unstick, 400);
  });

  /* ================= 视口内外 & 尺寸变化 ================= */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        visible = e.isIntersecting;
        if (visible) last = 0;              // 回到画面里时重新对时，避免一帧跳很远
      });
    }, { threshold: 0 }).observe(stage);
  }

  var rt;
  onWin('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (g0 !== gen) return;
      measure();
      cur = goal = OFF[activeIdx];
      vel = 0; spd = 0; snapping = false; lastHUD = -1;
      measureEnter();
      for (var i = 0; i < N; i++) memo[i] = '';
      updateHUD();
    }, 150);
  });

  /* ================= 启动 ================= */
  unstick();
  setTimeout(unstick, 0);
  setTimeout(unstick, 350);
  measure();
  var hi = hashIndex();
  if (hi >= 0) activeIdx = hi;
  cur = goal = OFF[activeIdx];
  measureEnter();
  updateHUD();
  tickFirst = true;
  if (hi >= 0) flash(hi);
  alive = true;
  raf = requestAnimationFrame(tick);
  }

  window.CapGallery = {
    boot: boot,
    destroy: destroy,
    get alive() { return alive; }
  };

  /* 首屏自启（没有 PJAX 时也照常工作）；PJAX 换页后由 capsule-pjax.js 再 boot */
  function auto() { boot(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', auto, { once: true });
  } else { auto(); }
})();
