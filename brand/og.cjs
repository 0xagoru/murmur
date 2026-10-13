const {chromium}=require(process.argv[2]);
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1200,height:630},deviceScaleFactor:+(process.argv[3]||1)});
await p.goto('https://murmuragents.io',{waitUntil:'networkidle',timeout:60000}).catch(()=>{});await p.waitForTimeout(3500);
await p.evaluate(()=>{
 const wm=document.querySelector('header .wordmark')||document.querySelector('header a');
 const h1=document.querySelector('.dream-hero h1');const beats=document.querySelector('.hero-beats');
 const stats=document.querySelector('.dream-stats');const xchip=document.querySelector('.nav-right .chip-link');
 const o=document.createElement('div');o.id='og';
 const css=document.createElement('style');css.textContent=`
 body>*:not(#og):not(canvas.meadow){visibility:hidden!important}
 canvas.meadow{visibility:visible!important}
 #og{position:fixed;inset:0;z-index:9999;visibility:visible;padding:44px 52px;box-sizing:border-box;color:#fff;font-family:inherit}
 #og *{visibility:visible!important;opacity:1!important;transform:none!important;animation:none!important}
 #og .top{display:flex;align-items:center;justify-content:space-between}
 #og .wm{display:flex;align-items:center;gap:10px;font-size:30px;font-weight:600;color:#fff}#og .wm svg{color:#fff}
 #og .wm svg{width:38px;height:38px}
 #og h1{color:#fff!important;text-shadow:0 2px 24px rgba(10,30,110,.35);font-size:66px!important;line-height:1.02!important;margin:46px 0 26px!important;max-width:900px;letter-spacing:-.035em}
 #og .hero-beats{max-width:1100px;gap:8px!important;flex-wrap:wrap}
 #og .hero-beats li{font-size:16px!important}
 #og .desk{position:absolute;left:52px;right:52px;bottom:40px;display:flex;align-items:stretch;gap:0;background:rgba(248,250,255,.86);color:#16204a;border-radius:10px;overflow:hidden;backdrop-filter:blur(8px)}
 #og .desk div{flex:1;padding:14px 20px;border-left:1px solid rgba(22,32,74,.12)}
 #og .desk div:first-child{border-left:0}
 #og .desk small{display:block;font-size:15px;opacity:.65;margin-bottom:4px}
 #og .desk b{white-space:nowrap;font-family:var(--mono, 'Geist Mono', monospace);font-weight:500;font-size:24px;letter-spacing:-.01em}
 #og .site{font-family:var(--mono,'Geist Mono',monospace);font-size:20px;opacity:.95}
 #og .handle{display:flex;align-items:center;gap:10px;font-size:20px}
 `;document.head.appendChild(css);
 const top=document.createElement('div');top.className='top';
 const w=document.createElement('div');w.className='wm';const m=document.querySelector('header svg.mark').cloneNode(true);w.append(m,'murmur');
 const r=document.createElement('div');r.className='handle';const xc=xchip.querySelector('.chip').cloneNode(true);r.append(xc,'@murmurbnb');
 top.append(w,r);o.append(top,h1.cloneNode(true),beats.cloneNode(true));
 const d=document.createElement('div');d.className='desk';
 [['ERC-8004 agent','#371999'],['Token audit','0.003 BNB'],['Hire it over','A2A, MCP'],['Every note anchored','BNB Chain'],['Visit','murmuragents.io']].forEach(([k,v])=>{const c=document.createElement('div');c.innerHTML='<small>'+k+'</small><b>'+v+'</b>';d.append(c)});
 o.append(d);document.body.append(o);
});
await p.waitForTimeout(800);await p.screenshot({path:process.argv[4]||'og-new.png'});
await p.setViewportSize({width:1200,height:630});await b.close();})();
