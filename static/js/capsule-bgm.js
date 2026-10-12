/* ==========================================================
   背景乐挂件（全站）—— 张悬《宝贝》
   · **进任何一页都自动起播**，点一下按钮才暂停 / 接着放
     （2026-10-12 用户要求。原先记着「你上次关了」，于是点过一次暂停之后，
      每次再进站都安静 —— 那条记忆已经去掉。暂停只在站内翻页之间保持。）
   · 自动播放被浏览器拦下时：第一次点按页面任意处就起播。
     真·自动播放在「没有用户手势的新文档」里一定会被拒，这是 Chrome 的策略，
     绕不过去；能做的只是把「要用户动一下」压缩到「随手动一下」。
   · **跨页不中断**：站内翻页走局部导航（capsule-pjax.js），文档不重载、
     <audio> 自始至终是同一个元素。万一退化成整页跳转，sessionStorage
     还记着「放到第几秒」，下一页接着往下走。
   · 位置：右上角（原为右下角）；顶栏滑下来时自动让位（body.nav-show）
   · 音频文件缺失（404）时挂件自己藏起来，不留一个坏按钮
   · 不依赖任何库
   ========================================================== */
(function () {
  'use strict';

  /* ⚠️ 一个文档里只允许有一个播放器实例。
     站点现在走局部导航（capsule-pjax.js），换页时正文被替换但本文件不会
     重新加载、<audio> 也不会重建；可万一它被重复执行（脚本被重跑），
     第二次初始化会把音量归零、进度重设 —— 听感上就是「卡一下」。
     这里直接挡住。 */
  if (window.__capBgm) return;

  var box = document.getElementById('bgm');
  if (!box) return;
  var audio = document.getElementById('bgmAudio');
  var btn = document.getElementById('bgmBtn');
  var ring = document.getElementById('bgmRing');
  if (!audio || !btn) return;

  var VOL = 0.55;                          // 目标音量（0~1）
  var RING_C = 2 * Math.PI * 24.5;         // 与 CSS / SVG 里的 r 对应
  /* 只记进度，不记「开还是关」—— 每次进站都该响起来（用户 2026-10-12 要求）。 */
  var K_T = 'capBgm.t';
  var fadeTimer = 0, metaTimer = 0, guard = 0, lastSave = 0;
  var armed = false, live = false, dead = false, backTo = false;

  audio.loop = true;
  audio.volume = 0;                        // 从 0 淡进来，别一开口吓人

  /* ---------- 小工具（隐私模式下 sessionStorage 会抛错，包起来） ---------- */
  function store(k, v) {
    try {
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch (e) { /* 存不了就算了，不影响播放 */ }
  }
  function load(k) {
    try { return sessionStorage.getItem(k); } catch (e) { return null; }
  }
  function setRing(p) {
    if (!ring) return;
    p = p < 0 ? 0 : (p > 1 ? 1 : p);
    ring.style.strokeDashoffset = (RING_C * (1 - p)).toFixed(2);
  }
  function paint() {
    var on = !audio.paused && !audio.ended;
    box.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function fade(to, ms, done) {
    clearInterval(fadeTimer);
    if (ms <= 0) { audio.volume = to; if (done) done(); return; }
    var from = audio.volume, t0 = Date.now();
    fadeTimer = setInterval(function () {
      var k = (Date.now() - t0) / ms;
      if (k >= 1) { audio.volume = to; clearInterval(fadeTimer); if (done) done(); return; }
      audio.volume = from + (to - from) * k;
    }, 40);
  }
  function showMeta(ms) {
    box.classList.add('is-show');
    clearTimeout(metaTimer);
    metaTimer = setTimeout(function () { box.classList.remove('is-show'); }, ms);
  }
  function saveTime() {
    if (!audio.paused && audio.currentTime > 0) store(K_T, audio.currentTime.toFixed(2));
  }

  /* ---------- 接上一页的进度 ---------- */
  var saved = parseFloat(load(K_T));
  var hasSaved = isFinite(saved) && saved > 1;
  if (hasSaved) {
    var seek = function () {
      try {
        var d = audio.duration;
        if (d && isFinite(d) && saved < d - 0.4) audio.currentTime = saved;
      } catch (e) { /* 还没准备好就算了 */ }
    };
    if (audio.readyState >= 1) seek();
    else audio.addEventListener('loadedmetadata', seek);
  }

  /* ---------- 起播 / 暂停 ---------- */
  function start() {
    if (dead) return;
    var p = audio.play();
    if (!p || !p.then) {                   // 老浏览器：当成功处理
      live = true; box.classList.remove('needs-tap');
      fade(VOL, 1400); paint(); showMeta(7000);
      return;
    }
    p.then(function () {
      live = true;
      box.classList.remove('needs-tap');
      fade(VOL, 1400);
      paint();
      showMeta(7000);
    })['catch'](function () {
      armTap();                            // 被浏览器拦下 → 等用户动一下再放
    });
  }
  function stop() {
    saveTime();                            // 记住放到第几秒，整页跳转时接着走
    fade(0, 260, function () { audio.pause(); });
  }

  /* ---------- 自动播放被拦：挂「轻触播放」提示 ---------- */
  function armTap() {
    if (armed || dead || live) return;
    armed = true;
    box.classList.add('needs-tap');
    document.addEventListener('pointerdown', onTap, true);
    document.addEventListener('touchstart', onTap, true);
    document.addEventListener('keydown', onTap, true);
  }
  function onTap(e) {
    if (box.contains(e.target)) return;    // 点挂件本身，交给按钮自己的 click
    armed = false;
    document.removeEventListener('pointerdown', onTap, true);
    document.removeEventListener('touchstart', onTap, true);
    document.removeEventListener('keydown', onTap, true);
    start();
  }

  btn.addEventListener('click', function () {
    if (dead) return;
    if (audio.paused) start(); else stop();
  });

  /* ---------- 音频自己的事件 ---------- */
  audio.addEventListener('play', paint);
  audio.addEventListener('pause', paint);
  audio.addEventListener('playing', paint);
  audio.addEventListener('timeupdate', function () {
    var d = audio.duration;
    setRing(d && isFinite(d) && d > 0 ? audio.currentTime / d : 0);
    var now = Date.now();                  // 每秒最多记一次进度，别写太勤
    if (now - lastSave > 900) { lastSave = now; saveTime(); }
  });

  function ready() { clearTimeout(guard); box.classList.add('is-ready'); }
  audio.addEventListener('loadedmetadata', ready);
  audio.addEventListener('canplay', ready);

  function kill() {                        // 文件不在 / 打不开 → 整个挂件退场
    if (dead) return;
    dead = true;
    clearTimeout(guard);
    box.classList.remove('is-ready', 'needs-tap');
    box.classList.add('is-dim');
    if (window.console && console.info) {
      console.info('[bgm] 背景乐没加载成功，挂件已自动隐藏。' +
        '把 mp3 放到 static/audio/ 下，或在 hugo.toml 里改 params.capsuleBgm。');
    }
  }
  audio.addEventListener('error', kill);
  guard = setTimeout(function () {         // 兜底：既没元数据、也不在加载中，就当它坏了
    if (audio.readyState < 1 && audio.networkState !== 2) kill();
  }, 9000);

  /* ---------- 右上角：顶栏滑下来时让位 ----------
     挂件在右上角，而固定顶栏（.topbar）也占着右上角 —— 它平时收起，
     滚动过 180px 才滑下来。顶栏的 class 只由 baseof 里那段滚动脚本改，
     这里跟着同步 body.nav-show，具体让多少由 CSS 决定。 */
  var tbar = document.getElementById('topbar');
  function syncNav() {
    if (!tbar) return;
    document.body.classList.toggle('nav-show', tbar.classList.contains('show'));
  }
  if (tbar) {
    addEventListener('scroll', syncNav, { passive: true });
    syncNav();
  }

  /* ---------- 切走时停一下，切回来接着放 ---------- */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      backTo = live && !audio.paused;
      if (backTo) stop();
    } else if (backTo) {
      backTo = false;
      start();
    }
  });
  addEventListener('pagehide', saveTime);  // 翻页前把进度带走

  /* ---------- 启动 ----------
     进站就试着自动起播 —— 不看你上次是不是亲手关过。 */
  setRing(0);
  paint();
  start();

  /* 调试钩子：验收脚本用，正常使用无感 */
  window.__capBgm = { box: box, audio: audio, start: start, stop: stop, saveTime: saveTime };
})();
