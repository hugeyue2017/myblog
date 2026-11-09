/* ==========================================================
   capsule-imgfb.js —— 图片兜底（全站，2026-11-09）

   背景：全站图片都走 partials/capsule-img.html，输出的是
     <picture>
       <source type="image/webp" srcset="...">   ← 优先
       <img src="...jpg" srcset="...">            ← 退路
     </picture>

   ⚠️ 关键事实（2026-11-09 实测）：**<source> 加载失败时，
      <img> 上不会收到 error 事件**。也就是说那个「退到 JPEG」
      的写法在浏览器里根本不会自动发生 —— webp 那一档一旦取不到
      （手机断网重连、运营商/数据节省模式改写响应、某台机器解不出 webp），
      整张照片就永远停在空框里，页面上看就是「照片全都没了」。

      实测数据（Chrome，只拦掉 *.webp）：
        · 修复前：影像页 36 张 → 显示 0 张；首页 34 张 → 显示 0 张
        · 修复后：影像页 36 张 → 显示 36 张（自动走 JPEG）；首页 34 → 34

   做法：不指望 error 事件，改成「主动扫」——
     · 文档上挂一个捕获阶段的 error 监听，哪张报错立刻救哪张；
     · 页面就绪后按 0 / 1.2 / 4 / 9 / 16 秒各扫一遍，把
       naturalWidth === 0 的（= 没画出来）挑出来救；
     · 最后那次（16 秒）连「一直在下、但还没到」的也救，但**三个条件都要满足**：
       在视口内、6 秒内没有任何下载进展（progress 事件）、才动手。
       ⚠️ 只看「在视口内」是不够的 —— 慢网络下（比如这台机器到 Vercel 要
       60 秒才把 36 张下完）9 秒时首屏图**几乎都还在正常下载**，一刀切下去
       会把好端端的请求掐断、改去重下更大的 JPEG，反而更慢。
       实测到过 `nw=760 / complete=false`（已经下到 760px 在解码）被误掐的情况。
   救 = 撤掉 <picture> 里的 <source> + 去掉 srcset + 把 src 重设一遍
        （尾上带 ?fb=1，绕开「失败过」的缓存记录）。
   每张只救一次（data-imgfb 记着），救完还不行就认了，不会来回抖。

   为什么单独一个文件：影像页、首页胶片条、文章里的插图**都用同一个
   partial**，兜底就得是同一份逻辑，不然又是三处各写一遍、改一处漏两处。
   ========================================================== */
(function () {
  'use strict';

  var FLAG = 'data-imgfb';

  function rescue(im) {
    if (!im || im.tagName !== 'IMG' || im.getAttribute(FLAG)) return;
    im.setAttribute(FLAG, '1');
    var pic = im.parentNode;
    if (pic && pic.tagName === 'PICTURE') {
      var ss = [].slice.call(pic.querySelectorAll('source'));
      for (var k = 0; k < ss.length; k++) pic.removeChild(ss[k]);
    }
    im.removeAttribute('srcset');
    var back = im.getAttribute('src');
    if (back) im.src = back + (back.indexOf('?') < 0 ? '?fb=1' : '&fb=1');
  }

  function inView(im) {
    var r = im.getBoundingClientRect();
    return r.right > 0 && r.left < (window.innerWidth || 0) &&
           r.bottom > 0 && r.top < (window.innerHeight || 0);
  }

  /* 还在下 / 已经卡死，两种都表现为 complete=false + naturalWidth=0。
     区别在「有没有进展」：progress 事件只要还在来字节就会刷新时间戳。
     STALL = 多久没有任何进展才算卡死。 */
  var STALL = 6000;
  var lastProgress = new WeakMap();
  document.addEventListener('progress', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG') lastProgress.set(t, Date.now());
  }, true);

  function stalled(im) {
    var lp = lastProgress.get(im);
    return !lp || (Date.now() - lp) > STALL;
  }

  function sweep(force) {
    var ims = document.querySelectorAll('picture img');
    for (var i = 0; i < ims.length; i++) {
      var im = ims[i];
      if (im.naturalWidth > 0 || im.getAttribute(FLAG)) continue;
      /* naturalWidth 为 0 有两种：确实失败了（complete=true）、还在路上（complete=false）。
         前者马上救；后者必须「在眼前 + 6 秒毫无进展」才动，
         不然会把正在正常下载的图掐断重来（慢网络下越救越慢）。 */
      if (im.complete || (force && inView(im) && stalled(im))) rescue(im);
    }
  }

  /* 报错就当场救（捕获阶段，不依赖事件冒泡到具体元素） */
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG') rescue(t);
  }, true);

  var timers = [];
  function arm() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
    /* 最后一档（16s）是唯一会动「还在下载」的图的那次，配合 stalled() 用。
       别把它提前 —— 慢网络下 9 秒时首屏图几乎都还在正常下载。 */
    [0, 1200, 4000, 9000, 16000].forEach(function (ms, idx, arr) {
      timers.push(setTimeout(function () { sweep(idx === arr.length - 1); }, ms));
    });
  }

  /* PJAX 换页：正文被换掉，新进来的图要重新兜一遍 */
  document.addEventListener('cap:pjax', function () { setTimeout(arm, 0); }, false);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arm, { once: true });
  } else {
    arm();
  }

  window.CapImgFb = { sweep: sweep, rescue: rescue };
})();
