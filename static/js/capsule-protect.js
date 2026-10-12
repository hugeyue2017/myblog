/* ==========================================================
   capsule-protect.js —— 复制密码门（全站）
   ----------------------------------------------------------
   什么时候弹密码框：
     · 按 Ctrl/Cmd + C、剪切
     · 桌面端右键（在链接上放行，还要能「在新标签页打开」）
     · 拖拽图片
     · F12 / Ctrl+Shift+I(J/C/K) / Ctrl+U（查看源码）/ Ctrl+S（保存）
   密码对了以后：本标签页内（sessionStorage）不再拦，关闭标签即失效。

   刻意**不拦**的东西（否则正常访客会被烦死）：
     · 选中文字（selectstart）—— 想引用一句、查个词都不行会很糟
     · Ctrl+A 全选、Tab 切换、页面滚动
     · 手机长按选词（只在有鼠标的设备才接右键）

   ⚠️ 劝退层，不是加密：爬虫直接 GET HTML，不跑这段 JS。
      对 AI 抓取真正有用的是 layouts/robots.txt 与 vercel.json 的响应头。
   ========================================================== */
(function(){
  var box = document.getElementById('cguard');
  if(!box) return;

  var PASS = String(box.getAttribute('data-pass') || '');
  if(!PASS) return;
  var KEY  = 'capsule-guard-ok';

  var form  = document.getElementById('cgForm');
  var input = document.getElementById('cgInput');
  var errEl = document.getElementById('cgErr');
  var noteEl= document.getElementById('cgNote');

  if(noteEl){ noteEl.textContent = String(box.getAttribute('data-note') || '') }

  /* 本次会话已经解锁过：一个监听器都不装，零开销、零干扰 */
  var done = false;
  try{ done = sessionStorage.getItem(KEY) === '1' }catch(e){}
  if(done) return;

  /* 有没有真鼠标。触摸设备上长按文字也会派发 contextmenu，
     那是在选词、不是要「另存」，所以手机上不接这一路。 */
  var hasMouse = !!(window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches);

  var isOpen = false;
  var bound  = [];                     /* [target,type,fn,opts]，解锁后整体摘除 */
  function on(t,type,fn,opt){ try{ t.addEventListener(type,fn,opt); bound.push([t,type,fn,opt]) }catch(e){} }
  function offAll(){
    for(var i=0;i<bound.length;i++){
      var b=bound[i];
      try{ b[0].removeEventListener(b[1],b[2],b[3]) }catch(e){}
    }
    bound = [];
  }
  function closest(el,sel){
    if(!el || el.nodeType!==1) return null;
    return el.closest ? el.closest(sel) : null;
  }

  function show(){
    if(isOpen){ try{ input.focus(); input.select() }catch(e){} return }
    isOpen = true;
    box.hidden = false;
    box.removeAttribute('aria-hidden');
    if(errEl){ errEl.textContent = ''; errEl.classList.remove('on') }
    form.classList.remove('shake');
    try{ input.value = '' }catch(e){}
    setTimeout(function(){ try{ input.focus() }catch(e){} }, 40);
  }
  function hide(){
    isOpen = false;
    box.hidden = true;
    box.setAttribute('aria-hidden','true');
  }
  function fail(){
    if(errEl){ errEl.textContent = '密码不对，再想想。'; errEl.classList.add('on') }
    form.classList.remove('shake');
    void form.offsetWidth;             /* 重排一下，让动画能重新播 */
    form.classList.add('shake');
    try{ input.value=''; input.focus() }catch(e){}
  }
  function unlock(){
    done = true;
    try{ sessionStorage.setItem(KEY,'1') }catch(e){}
    offAll();
    hide();
    /* 本来就是要复制的话，顺手替他复制好，省得再按一次 */
    var sel = '';
    try{ sel = String((window.getSelection && window.getSelection()) || '') }catch(e){}
    if(sel){
      try{ document.execCommand('copy') }catch(e){}
      if(noteEl){ noteEl.textContent = '已解锁 · 内容已复制' }
    }
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();
    if(String(input.value||'').trim() === PASS){ unlock() } else { fail() }
  });
  box.addEventListener('click', function(e){
    if(closest(e.target,'[data-cg-close]')) hide();
  });

  /* ---------- 拦截器 ---------- */
  function blockCopy(e){ e.preventDefault(); e.stopPropagation(); show() }

  on(document,'copy',blockCopy,true);
  on(document,'cut', blockCopy,true);

  if(hasMouse){
    on(document,'contextmenu', function(e){
      if(closest(e.target,'a[href]')) return;      /* 链接右键放行 */
      e.preventDefault();
      show();
    }, true);
  }

  on(document,'dragstart', function(e){
    var t = e.target;
    if(t && (t.tagName === 'IMG' || closest(t,'img'))){ e.preventDefault(); show() }
  }, true);

  /* 快捷键。只挡「看源码 / 存页面 / 开控制台」这一类，
     不动 Ctrl+C（那一路上面的 copy 事件已经管了）。 */
  on(document,'keydown', function(e){
    var k = e.key || '';
    var mod = e.ctrlKey || e.metaKey;
    var dev = mod && e.shiftKey && 'IiJjCcKk'.indexOf(k) > -1;
    var src = mod && 'UuSs'.indexOf(k) > -1;
    if(k === 'F12' || dev || src){ e.preventDefault(); show() }
  }, true);

  /* Esc 关掉弹窗 */
  on(document,'keydown', function(e){
    if(e.key === 'Escape' && isOpen){ e.preventDefault(); hide() }
  }, true);
})();
