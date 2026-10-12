/* ==========================================================
   capsule-strip.js —— 首页胶片条：自动横滑（无缝跑马灯）
   每一帧仍然可以点进影像页 /gallery/#pN —— 这是硬要求，改动前先看下面的注释。

   原本内嵌在 layouts/_default/baseof.html 的 <script> 里。
   现在外置 + 改造成可重入模块，是为了配合全站的**局部导航**
   （capsule-pjax.js）：翻页时正文被换掉，首页的胶片条要能跟着重建，
   而上一份的逐帧循环必须停干净，否则多个循环叠着跑。

   重入的三条规矩（与 capsule-gallery.js 一致）：
   1) window / document 级监听走 onWin() / onDoc()，挂 AbortController 的
      signal；destroy() 一个 abort() 全摘。元素级监听随 DOM 一起回收，不管。
   2) 逐帧循环用 alive 开关退出，且只保留最新那一个 raf 句柄。
   3) 延后的 setTimeout（sSettle 里那个 300ms）用世代号 gen 守卫。
   ========================================================== */
(function () {
  'use strict';

  var ac = null, alive = false, raf = 0, gen = 0, dio = null;

  function bind(t, tgt, f, o) {
    if (!ac) { try { tgt.addEventListener(t, f, o); } catch (e) {} return; }
    var k = {}, p;
    if (o) { for (p in o) { if (Object.prototype.hasOwnProperty.call(o, p)) k[p] = o[p]; } }
    k.signal = ac.signal;
    try { tgt.addEventListener(t, f, k); } catch (e) { tgt.addEventListener(t, f, o); }
  }
  function onWin(t, f, o) { bind(t, window, f, o); }
  function onDoc(t, f, o) { bind(t, document, f, o); }

  function destroy() {
    alive = false;
    gen++;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (dio) { try { dio.disconnect(); } catch (e) {} dio = null; }
    if (ac) { try { ac.abort(); } catch (e) {} ac = null; }
  }

  function boot() {
    destroy();
    if (typeof AbortController === 'function') ac = new AbortController();
    var g0 = gen;

    /* ---------- 首页胶片条：自动横滑（无缝跑马灯），且每一帧仍可点进影像页 ----------
       做法：把 6 帧复制一组补在头部、再补到尾部，让内容宽度 ≥ 2 组，
       滚过 1 组的宽度就减去 1 组 —— 视觉上无缝绕回。速度 28px/s，
       用 rAF 按真实帧间隔推进（掉帧也不会忽快忽慢）。

       ⚠️ 这里有两个必须守住的坑：
       1) 「点一张能跳转」不能被自动滑动吞掉。判据**不能**是「scrollLeft 变了」——
          自动播自己每帧都在改 scrollLeft，那样点哪张都点不动（页面上完全看不出原因）。
          改成看「指针按下到抬起之间有没有横move 超过 8px」，并且按下就先 hold 住自动播，
          让这段窗口里的 scrollLeft 只可能由用户自己产生。
       2) .strip 是 scroll-snap-type:x proximity，程序化改 scrollLeft 会被吸回去。
          开始自动滑时给 .strip 加 .is-auto 把 snap 关掉（见 capsule.css）。
       另外 6 帧复制出来的副本都要 aria-hidden + tabindex=-1，
       不然键盘用户会 Tab 过同一张照片三遍。 */
    var strip=document.querySelector('.strip');
    if(!strip||!strip.children.length){return false}
      var sHint=document.getElementById('stripHint');
      var sReduce=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion:reduce)').matches);
      var S_SPEED=0.028;                       /* px / ms ≈ 28px 每秒 */
      var sStep=0,sAcc=0,sRun=false,sHover=false,sVisible=true;
      var sHoldUntil=0,sNeedSync=true,sLast=0;

      function sHold(ms){sHoldUntil=Math.max(sHoldUntil,performance.now()+ms);sNeedSync=true}
      function sPaint(){
        if(sHint){sHint.textContent=sRun?(sHover?'PAUSED':'AUTO ↻'):'SCROLL →'}
      }
      function sClone(node){
        var c=node.cloneNode(true);
        c.setAttribute('data-clone','');c.setAttribute('aria-hidden','true');c.tabIndex=-1;
        return c;
      }
      function sBuild(prog){
        if(sStep>0){return true}
        var frames=[].slice.call(strip.querySelectorAll('.frame:not([data-clone])'));
        if(!frames.length){return false}
        var i,lead=strip.scrollWidth;         /* 未复制前「一组」的宽度 */
        for(i=frames.length-1;i>=0;i--){strip.insertBefore(sClone(frames[i]),strip.firstChild)}
        sStep=strip.scrollWidth-lead;         /* 一组的步进宽度（含组尾那道间隙） */
        if(sStep<=0){return false}
        var view=strip.clientWidth,guard=0;
        while(strip.scrollWidth<sStep*2+view&&guard++<6){
          for(i=0;i<frames.length;i++){strip.appendChild(sClone(frames[i]))}
        }
        /* prog = 重建前在「这一份」里已经走到哪了。按原进度落回去，
           重建前后看起来是同一个位置，不会突然跳回开头。 */
        sAcc=sStep+Math.min(Math.max(prog||0,0),sStep-1);
        strip.scrollLeft=sAcc;strip.classList.add('is-auto');
        return true;
      }

      /* 直接量「一组」有多宽（只量真帧，不用把克隆摘掉）。
         口径与 sBuild 里的 sStep 一致：各帧宽之和 + 帧数 × 间隙
         （帧之间 n-1 道，再加组尾那一道）。 */
      function sBase(){
        var fr=[].slice.call(strip.querySelectorAll('.frame:not([data-clone])'));
        if(!fr.length){return 0}
        var w=0,i;
        for(i=0;i<fr.length;i++){w+=fr[i].getBoundingClientRect().width}
        var cs=getComputedStyle(strip),gap=parseFloat(cs.columnGap||cs.gap||'0')||0;
        return Math.round(w+gap*fr.length);
      }

      /* 懒加载的图逐个到位，进页面那一刻帧宽可能还没定下来，所以布局稳定后重算一次。

         ⚠️ 这里必须带「宽度真变了才重建」的判断，否则会自我触发成死循环：
         重建会新建一批 <img> 副本 → 它们（从缓存）加载完又各抛一次 load →
         又调 sSettle → 又重建 …… 结果是位置被反复按回起点，看着像「根本不动」。
         宽度没变就直接返回，循环自然就断了。 */
      var sSettleT=0;
      function sSettle(){
        clearTimeout(sSettleT);
        sSettleT=setTimeout(function(){
          if(g0!==gen){return}
          if(!sStep){return}
          var b=sBase();
          if(b>0&&Math.abs(b-sStep)<=4){return}
          var prog=sAcc-sStep;
          [].slice.call(strip.querySelectorAll('[data-clone]')).forEach(function(n){n.remove()});
          strip.classList.remove('is-auto');
          sStep=0;sNeedSync=true;sRun=sBuild(prog);sPaint();
        },300);
      }
      onWin('load',sSettle);
      strip.addEventListener('load',function(e){
        /* 自己复制出来的副本再抛 load 就忽略掉 */
        var n=e.target;
        while(n&&n!==strip){if(n.getAttribute&&n.hasAttribute('data-clone')){return}n=n.parentNode}
        sSettle();
      },true);

      /* 滚轮**不接管**（按用户要求）：光标停在胶片条上时，滚轮照常竖着滚页面，
         不再把竖向滚轮改成横向滑。 */
      strip.addEventListener('pointerenter',function(e){if(e.pointerType==='mouse'){sHover=true;sPaint()}});
      strip.addEventListener('pointerleave',function(e){if(e.pointerType==='mouse'){sHover=false;sHold(400);sPaint()}});

      var sDownX=0,sDownL=0,sDown=false,sMoved=false;
      strip.addEventListener('pointerdown',function(e){
        sHold(2600);sDown=true;sMoved=false;sDownX=e.clientX;sDownL=strip.scrollLeft;
      },{passive:true});
      strip.addEventListener('pointermove',function(e){
        if(sDown&&Math.abs(e.clientX-sDownX)>8){sMoved=true}
      },{passive:true});
      strip.addEventListener('pointerup',function(){sDown=false});
      strip.addEventListener('pointercancel',function(){sDown=false});
      /* 捕获阶段拦：真拖过（含触屏原生滑动把位置挪了）就不算点击；
         只是点一下某张，照常跳到影像页那一张。键盘回车产生的 click 没有指针轨迹
         （e.detail===0），绝不能拦，否则键盘用户点不动。 */
      strip.addEventListener('click',function(e){
        if(e.detail!==0&&(sMoved||Math.abs(strip.scrollLeft-sDownL)>8)){
          e.preventDefault();e.stopPropagation();
        }
        sMoved=false;
      },true);

      if('IntersectionObserver' in window){
        dio=new IntersectionObserver(function(es){
          es.forEach(function(e){sVisible=e.isIntersecting});
        },{threshold:0});
        dio.observe(strip);
      }
      onDoc('visibilitychange',function(){if(document.hidden){sLast=0}});

      onWin('resize',sSettle);

      if(sReduce){sPaint()}                 /* 系统开了「减少动态效果」就不自动滑 */
      else{
        sRun=sBuild();sPaint();
        alive=true;
        raf=requestAnimationFrame(function sTick(t){
          if(!alive){return}
          if(!sLast){sLast=t}
          var dt=Math.min(t-sLast,64);sLast=t;   /* 切回标签页时别一次跳很远 */
          if(sRun&&sVisible&&!sHover&&t>sHoldUntil){
            if(sNeedSync){sAcc=strip.scrollLeft;sNeedSync=false}
            sAcc+=dt*S_SPEED;
            if(sAcc>=sStep*2){sAcc-=sStep}       /* 无缝回绕 */
            strip.scrollLeft=sAcc;
          }
          raf=requestAnimationFrame(sTick);
        });
      }
    return true;
  }

  window.CapStrip = {
    boot: boot,
    destroy: destroy,
    get alive() { return alive; }
  };

  /* 首屏自启；PJAX 换页后由 capsule-pjax.js 再 boot */
  function auto() { boot(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', auto, { once: true });
  } else { auto(); }
})();
