'use strict';
'require baseclass';
'require view';
'require fs';
'require ui';
'require uci';
'require poll';

// pause ALL polling while the browser tab is hidden — LuCI's poll.js keeps
// hammering the router with exec chains from a backgrounded tab otherwise
document.addEventListener('visibilitychange', function(){
  if (document.hidden) poll.stop(); else poll.start();
});

/*
 * Shared helpers for the meownetvpn (meownetvpn) multi-page LuCI app.
 * Returned as a `baseclass` subclass (so `require` hands back the class, not an
 * auto-instantiated view) with a static `page()` that builds a view carrying all
 * these helpers. Each page does:
 *   'require meownetvpn.lib as lib';  return lib.page({ load, render });
 *
 * HOUSE RULE: every value that comes out of `meownetvpn` stdout is handed to E()
 * INSIDE AN ARRAY — E('b',{},[label]), never E('b',{},label). LuCI's dom.append()
 * escapes array children through createTextNode, but a BARE string child is
 * assigned straight to node.innerHTML. Group labels are free text, server labels
 * are copied verbatim out of the subscription YAML, and the self-check country
 * comes from ipinfo.io — so the bare form was an HTML-injection sink firing inside
 * a LuCI session whose rpcd login holds read/write '*'.
 */

var RX_COL = 'var(--mk-rx)', TX_COL = 'var(--mk-tx)';

// The only argv the health list's «Исправить» button is allowed to run. `meownetvpn`
// emits the fix command as the LAST field of a '|'-separated record, and a group
// label containing '|' used to shift a different word into that slot — see loadHealth().
var FIXES = { 'bypass on':1, 'restart':1, 'update':1 };

var CSS = `
/* Palette lives in variables so the dark themes (Argon/Material) get colours
   that actually pass contrast — the old hard-coded hexes sat at ~3:1 on black. */
:root{
  --mk-ok:#16a34a; --mk-warn:#b45309; --mk-bad:#dc2626;
  --mk-rx:#16a34a; --mk-tx:#2563eb;
  --mk-line:rgba(127,127,127,.28); --mk-soft:rgba(127,127,127,.07);
}
@media (prefers-color-scheme: dark){
  :root{ --mk-ok:#4ade80; --mk-warn:#fbbf24; --mk-bad:#f87171;
         --mk-rx:#4ade80; --mk-tx:#60a5fa; }
}
.mk-chart{display:block;width:100%;height:130px;border:1px solid var(--mk-line);border-radius:3px;
          background:var(--mk-soft)}
.mk-act{margin:10px 0 0;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.mk-leg{display:flex;gap:22px;flex-wrap:wrap;margin-top:8px;font-size:12px}
.mk-leg span{display:inline-flex;align-items:center;gap:7px}
.mk-leg i{width:12px;height:12px;border-radius:2px;display:inline-block;flex:0 0 auto}
.mk-leg b{font-weight:600}
.mk-out{white-space:pre-wrap;font-family:monospace;font-size:12px;background:rgba(127,127,127,.1);
        padding:10px 12px;border-radius:4px;margin-top:10px;max-height:200px;overflow:auto;display:none}
.mk-up{color:var(--mk-ok);font-weight:bold}
.mk-down{color:var(--mk-bad);font-weight:bold}
.mk-warn{color:var(--mk-warn);font-weight:bold}
.mk-st td{padding:5px 8px}
.mk-badge{font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;line-height:1;white-space:nowrap;
          border:1px solid transparent}
.mk-badge.ok{color:var(--mk-ok);background:rgba(22,163,74,.12);border-color:rgba(22,163,74,.35)}
.mk-badge.warn{color:var(--mk-warn);background:rgba(217,119,6,.12);border-color:rgba(217,119,6,.35)}
.mk-badge.bad{color:var(--mk-bad);background:rgba(220,38,38,.12);border-color:rgba(220,38,38,.35)}
.mk-cards{display:flex;gap:10px;flex-wrap:wrap}
.mk-card{flex:1 1 210px;min-width:210px;border:1px solid var(--mk-line);border-radius:8px;
         padding:10px 12px;background:var(--mk-soft)}
.mk-card-h{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.mk-card-h b{font-size:13px;font-weight:700}
.mk-card-r{display:flex;justify-content:space-between;font-size:12px;padding:2px 0;gap:10px}
.mk-card-r>span{opacity:.6;white-space:nowrap}
.mk-card-r>b{font-weight:600;text-align:right;word-break:break-all}
.mk-hint{font-size:12px;opacity:.75;margin-bottom:8px}
/* health checks — one row per check, worst one drives the header badge */
.mk-checks{display:flex;flex-direction:column;gap:4px;margin-top:2px}
.mk-chk{display:flex;align-items:center;gap:10px;padding:8px 11px;border-radius:6px;
        background:var(--mk-soft);border:1px solid var(--mk-line);font-size:13px}
.mk-chk i{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
.mk-chk.ok i{background:var(--mk-ok)}
.mk-chk.warn i{background:var(--mk-warn)}
.mk-chk.bad i{background:var(--mk-bad)}
.mk-chk.na i{background:rgba(127,127,127,.5)}
.mk-chk>span{flex:1 1 auto}
.mk-chk button{margin-left:auto;flex:0 0 auto}
.mk-ev{font-size:12px}
.mk-ev td{padding:4px 8px;vertical-align:top}
.mk-ev .t{white-space:nowrap;opacity:.6}
.mk-ev .s-bad{color:var(--mk-bad);font-weight:600}
.mk-ev .s-warn{color:var(--mk-warn);font-weight:600}
.mk-qa{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.mk-qa input{flex:1 1 260px;min-width:0}
/* ---- visual layer: panels, hero, KPI tiles, server cards. Everything is scoped
   under .mk-page, the root of OUR pages only, so stock LuCI pages and the theme
   itself are never restyled. ---- */
.mk-page .cbi-section.mk-panel{border:1px solid var(--mk-line);border-radius:12px;padding:14px 16px 16px;
  margin:0 0 14px;background:var(--mk-soft);box-shadow:none}
.mk-page .cbi-section.mk-panel>h3{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:0;border:0;
  font-size:15px;font-weight:700;background:none}
.mk-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 2px 14px}
.mk-head h2{margin:0;font-weight:800;letter-spacing:-.02em}
.mk-head .mk-sub{font-size:12px;opacity:.6}
.mk-head .mk-ver{font-size:11px;opacity:.6;border:1px solid var(--mk-line);border-radius:999px;padding:2px 8px}
.mk-hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:16px;align-items:start}
.mk-hero-main{display:flex;flex-direction:column;gap:10px}
.mk-state{font-size:22px;font-weight:800;letter-spacing:-.01em;display:flex;align-items:center;gap:10px}
.mk-state i{width:12px;height:12px;border-radius:50%;background:currentColor;flex:0 0 auto}
.mk-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 14px;font-size:13px}
.mk-kv>span{opacity:.6;white-space:nowrap}
.mk-kv>b{font-weight:600;word-break:break-word}
.mk-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.mk-kpi{border:1px solid var(--mk-line);border-radius:10px;padding:9px 12px}
.mk-kpi>span{display:block;font-size:11px;opacity:.6;letter-spacing:.02em}
.mk-kpi>b{display:block;font-size:18px;font-weight:700;margin-top:2px;white-space:nowrap}
.mk-pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;
  background:rgba(127,127,127,.13);white-space:nowrap}
.mk-pill.ok{color:var(--mk-ok);background:rgba(22,163,74,.13)}
.mk-pill.warn{color:var(--mk-warn);background:rgba(217,119,6,.13)}
.mk-pill.bad{color:var(--mk-bad);background:rgba(220,38,38,.13)}
.mk-srvs{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.mk-srv{border:1px solid var(--mk-line);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:7px}
.mk-srv.active{border-color:var(--mk-ok);box-shadow:inset 0 0 0 1px var(--mk-ok)}
.mk-srv-h{display:flex;justify-content:space-between;align-items:center;gap:8px}
.mk-srv-h>b{font-size:14px;font-weight:700}
.mk-srv-m{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px}
.mk-srv-m>small{opacity:.55}
.mk-srv-a{margin-top:auto;display:flex;gap:6px}
.mk-lists{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
.mk-list{display:flex;gap:9px;align-items:flex-start;border:1px solid var(--mk-line);border-radius:10px;padding:9px 11px;cursor:pointer}
.mk-list.on{border-color:var(--mk-ok);box-shadow:inset 0 0 0 1px var(--mk-ok)}
.mk-list input{margin-top:3px}
.mk-list b{display:block;font-size:13px}
.mk-list small{display:block;font-size:11px;opacity:.6;line-height:1.35}
/* Phones: cards go full width, buttons become tappable, tables turn into
   stacked rows using each cell's data-label. */
@media (max-width:700px){
  .mk-hero{grid-template-columns:1fr}
  .mk-state{font-size:19px}
  .mk-card{min-width:100%;flex-basis:100%}
  .mk-act{gap:8px}
  .mk-act button,.mk-act input{flex:1 1 100%;min-height:44px}
  .mk-qa input{flex:1 1 100%}
  .mk-chk{align-items:flex-start;flex-wrap:wrap}
  .mk-chk button{margin-left:19px;min-height:38px}
  .mk-page table.mk-resp thead,.mk-page table.mk-resp tr.table-titles{display:none}
  .mk-page table.mk-resp tr{display:block;border-bottom:1px solid var(--mk-line);padding:6px 0}
  .mk-page table.mk-resp tr:last-child{border-bottom:0}
  .mk-page table.mk-resp td{display:flex;justify-content:space-between;gap:14px;padding:3px 8px;border:0}
  .mk-page table.mk-resp td::before{content:attr(data-label);opacity:.6;flex:0 0 auto}
  .mk-chart{height:100px}
}
`;


function fmtRate(bps){
  bps = bps || 0;
  if (bps >= 1048576) return (bps/1048576).toFixed(1)+' МБ/с';
  if (bps >= 1024)    return (bps/1024).toFixed(0)+' КБ/с';
  return bps+' Б/с';
}

// Human names for the community lists — the raw ids (russia_inside, google_ai…)
// meant nothing to the people choosing them.
var LIST_INFO = {
  telegram:      ['Telegram',               'мессенджер и звонки'],
  meta:          ['Instagram, Facebook, WhatsApp', 'сервисы Meta'],
  twitter:       ['X (Twitter)',            ''],
  discord:       ['Discord',                'голос и чаты'],
  roblox:        ['Roblox',                 ''],
  youtube:       ['YouTube',                'видео и YouTube Music'],
  tiktok:        ['TikTok',                 ''],
  google_ai:     ['Google AI',              'Gemini и другие AI-сервисы Google'],
  google_play:   ['Google Play',            'магазин приложений'],
  hdrezka:       ['HDrezka',                ''],
  russia_inside: ['Заблокированное в России','большой список заблокированных сайтов'],
  russia_outside:['Российские сервисы из-за рубежа','для тех, кто за границей'],
  geoblock:      ['Сервисы с геоблоком',    'те, что сами не пускают из России'],
  block:         ['Прочие блокировки',      ''],
  anime:         ['Аниме-сайты',            ''],
  news:          ['Новостные сайты',        ''],
  porn:          ['Сайты для взрослых',     ''],
  cloudflare:    ['Сети Cloudflare',        'целиком — много лишнего трафика'],
  hetzner:       ['Сети Hetzner',           'хостинг целиком'],
  digitalocean:  ['Сети DigitalOcean',      'хостинг целиком'],
  phasmophobia:  ['Phasmophobia',           'вход в игру и голос (Photon, Vivox)']
};

var Base = baseclass.extend({
  CSS: CSS,
  LIST_INFO: LIST_INFO,
  buf: [],
  MAXPTS: 90,
  pingMap: {},
  // real latency THROUGH each server (`urltest`): sec -> ms or '—'
  utMap: {},
  utMeta: {},
  utNote: {},

  // load uci + the cached server pings into this.pingMap / this.utMap
  loadBase: function(){
    var self=this;
    return Promise.all([
      uci.load('meownetvpn'),
      fs.exec('/usr/bin/meownetvpn',['pingcache']).catch(function(){ return {stdout:''}; }),
      fs.exec('/usr/bin/meownetvpn',['urltest','status']).catch(function(){ return {stdout:''}; })
    ]).then(function(res){
      self.pingMap={};
      ((res[1]&&res[1].stdout)||'').trim().split('\n').forEach(function(l){
        var f=l.split('|'); if(f[0]) self.pingMap[f[0]]=f[3]; });
      self.parseUrltest((res[2]&&res[2].stdout)||'');
      return res;
    });
  },

  // "#ts=<epoch>|state=running|done=N|total=M" then "<sec>|<label>|<ms|—>|<note>"
  parseUrltest: function(text){
    var self=this; self.utMap={}; self.utMeta={}; self.utNote={};
    (text||'').trim().split('\n').forEach(function(l){
      if(l.charAt(0)==='#'){
        l.slice(1).split('|').forEach(function(kv){ var i=kv.indexOf('='); if(i>0) self.utMeta[kv.slice(0,i)]=kv.slice(i+1); });
      } else { var f=l.split('|'); if(f[0]){ self.utMap[f[0]]=f[2]; self.utNote[f[0]]=f[3]||''; } }
    });
  },

  // one line under the button: when the numbers were taken, or how far a run is
  utText: function(){
    var m=this.utMeta;
    if(!m.ts) return 'Реальная задержка ещё не проверялась — нажмите «Проверить серверы».';
    if(m.state==='running') return 'Проверяю серверы… '+(m.done||0)+' из '+(m.total||'?');
    var d=new Date((+m.ts)*1000), ago=Math.max(0,Math.round((Date.now()-d.getTime())/60000));
    var self=this, bad=Object.keys(this.utNote).filter(function(k){ return self.utFailed(k); }).length;
    var hh=('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
    return 'Проверено в '+hh+' ('+(ago<1?'только что':ago+' мин назад')+'). '+
      (bad?'Не ответили: '+bad+'. ':'')+
      '«Через сервер» — полный путь: роутер → вход → выход → интернет. «До входа» одинаков у серверов с общим входом.';
  },

  // the last urltest said this server did not pass a request at all
  utFailed: function(sec){ return /no answer/.test(this.utNote[sec]||''); },
  // what the «Через сервер» table cell shows: ms, «нет ответа» or —
  utCell: function(sec){ var v=this.utMap[sec];
    return (v&&v!=='—') ? v : (this.utFailed(sec) ? 'нет ответа' : '—'); },

  srvLabel: function(sec, base){
    var rt=this.utMap[sec], ms=this.pingMap[sec];
    if(rt && rt!=='—') return base+' · '+rt+'ms';
    return base + (ms && ms!=='—' ? ' · вход '+ms+'ms' : '');
  },

  // fs.exec resolves with {code,stdout,stderr} whatever the command returned, and
  // rejects when rpcd denies the call. Both used to be thrown away: a `sub` that
  // exited 1 was indistinguishable from a successful import, and a missing ubus
  // ACL rendered as blank tables with no error anywhere. run() keeps the code for
  // callers that must branch on it; exec() keeps the plain-text contract everything
  // else expects but no longer hides a failure.
  run: function(args){ return fs.exec('/usr/bin/meownetvpn', args)
    .then(function(r){ return { code:(r.code|0), out:(r.stdout||'')+(r.stderr||'') }; })
    .catch(function(e){ return { code:-1, out:'[RPC error: '+((e&&e.message)||e)+']' }; }); },

  exec: function(args){ return this.run(args).then(function(r){
    return r.code ? (r.out+'\n[exit '+r.code+']') : r.out; }); },

  parse: function(t){ var o={}; (t||'').split('\n').forEach(function(l){
    var i=l.indexOf(':'); if(i>0) o[l.slice(0,i).trim()]=l.slice(i+1).trim(); }); return o; },

  pingClass: function(ms, kind){
    var n=parseInt(ms); if(isNaN(n)) return 'mk-down';
    var g=(kind==='tun')?200:60, y=(kind==='tun')?400:120;
    return n<=g ? 'mk-up' : (n<=y ? 'mk-warn' : 'mk-down');
  },

  // colour the latency columns: ICMP to the entry (green <=60) and the real path
  // through the server (green <=500: TLS to the entry + the exit + the request)
  colorPings: function(){
    var lim={ 'До входа, мс':[60,120], 'Пинг, мс':[60,120], 'Через сервер, мс':[500,1000] };
    var col=function(ms,g,y){ var n=parseInt(ms);
      return isNaN(n)?'var(--mk-bad)':(n<=g?'var(--mk-ok)':(n<=y?'var(--mk-warn)':'var(--mk-bad)')); };
    document.querySelectorAll('table').forEach(function(tbl){
      var hdr=tbl.querySelector('tr'); if(!hdr) return;
      Array.prototype.forEach.call(hdr.children,function(th,idx){
        var l=lim[(th.textContent||'').trim()]; if(!l) return;
        var rows=tbl.querySelectorAll('tr');
        for(var r=1;r<rows.length;r++){ var c=rows[r].children[idx]; if(!c) continue;
          c.style.fontWeight='bold'; c.style.color=col(c.textContent,l[0],l[1]); }
      });
    });
  },

  // write fresh urltest numbers into the "Через сервер" cells without a reload
  paintUrltest: function(){
    var self=this;
    document.querySelectorAll('table').forEach(function(tbl){
      var hdr=tbl.querySelector('tr'); if(!hdr) return; var idx=-1;
      Array.prototype.forEach.call(hdr.children,function(th,i){ if((th.textContent||'').trim()==='Через сервер, мс') idx=i; });
      if(idx<0) return;
      tbl.querySelectorAll('tr[data-sid]').forEach(function(tr){
        var sid=tr.getAttribute('data-sid'), c=tr.children[idx];
        if(c && self.utMap[sid]!=null) c.textContent=self.utCell(sid);
      });
    });
    self.colorPings();
    if(typeof self.paintCards==='function') self.paintCards();   // servers page cards
  },

  // poll a background `urltest start` until it finishes (or 3 min), repainting as
  // each server lands; resolves so the button leaves its busy state
  pollUrltest: function(stateEl){
    var self=this, t0=Date.now();
    return new Promise(function(resolve){
      var tick=function(){
        self.run(['urltest','status']).then(function(r){
          self.parseUrltest(r.out);
          if(stateEl) stateEl.textContent=self.utText();
          self.paintUrltest();
          if(self.utMeta.state==='done' || Date.now()-t0>180000) resolve(null);
          else setTimeout(tick,1500);
        });
      };
      setTimeout(tick,800);
    });
  },

  fmtBytes: function(n){ n=+n||0;
    if(n>=1073741824) return (n/1073741824).toFixed(2)+' ГБ';
    if(n>=1048576)    return (n/1048576).toFixed(1)+' МБ';
    if(n>=1024)       return (n/1024).toFixed(0)+' КБ';
    return n+' Б'; },

  mkBtn: function(key, cls, label, fn, out){
    var self=this;
    var b=E('button',{'class':'cbi-button '+cls, click: ui.createHandlerFn(self,function(){
      b._busy=true; b.setAttribute('disabled',''); var orig=b.textContent; b.textContent=label+'…';
      return fn().then(function(txt){ if(txt!=null && out){ out.style.display='block'; out.textContent=txt; } })
        .finally(function(){ b._busy=false; b.textContent=orig; self.refreshStatus(); });
    })}, label);
    (this._btns=this._btns||{})[key]=b; return b;
  },

  _setBtn: function(k, disabled){
    var b=this._btns&&this._btns[k]; if(!b||b._busy) return;
    if(disabled) b.setAttribute('disabled',''); else b.removeAttribute('disabled');
  },

  row: function(label, valNode){
    return E('tr',{'class':'tr'},[
      E('td',{'class':'td left','width':'34%'},label),
      E('td',{'class':'td left'},[valNode])
    ]);
  },

  drawChart: function(){
    if(!this._svg) return;
    var b=this.buf, W=600, H=130, pad=6;
    var max=1; b.forEach(function(p){ if(p.rx>max)max=p.rx; if(p.tx>max)max=p.tx; });
    var n=b.length, step = n>1 ? W/(n-1) : W;
    var Y=function(v){ return (H-pad-(v/max)*(H-pad*2)).toFixed(1); };
    var path=function(key,close){
      if(!n) return '';
      var d=''; b.forEach(function(p,i){
        var x=(i*step).toFixed(1);
        d += (i?'L':'M')+x+' '+Y(p[key])+' ';
      });
      if(close) d += 'L'+((n-1)*step).toFixed(1)+' '+H+' L0 '+H+' Z';
      return d;
    };
    var grid=''; for(var g=1; g<4; g++){ var gy=(H*g/4).toFixed(1);
      grid += '<line x1="0" y1="'+gy+'" x2="'+W+'" y2="'+gy+'" stroke="currentColor" stroke-opacity=".12"/>'; }
    var last=b[n-1]||{rx:0,tx:0};
    this._leg.innerHTML=''
      + '<span><i style="background:'+RX_COL+'"></i>'+_('Загрузка')+' <b>'+fmtRate(last.rx)+'</b></span>'
      + '<span><i style="background:'+TX_COL+'"></i>'+_('Отдача')+' <b>'+fmtRate(last.tx)+'</b></span>'
      + '<span style="opacity:.65">'+_('пик')+' <b>'+fmtRate(max)+'</b></span>';
    this._svg.innerHTML=''
      + '<svg class="mk-chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'
      + grid
      + '<path d="'+path('rx',true)+'" fill="'+RX_COL+'" fill-opacity=".22"/>'
      + '<path d="'+path('rx',false)+'" fill="none" stroke="'+RX_COL+'" stroke-width="1.5" stroke-linejoin="round"/>'
      + '<path d="'+path('tx',true)+'" fill="'+TX_COL+'" fill-opacity=".18"/>'
      + '<path d="'+path('tx',false)+'" fill="none" stroke="'+TX_COL+'" stroke-width="1.5" stroke-linejoin="round"/>'
      + '</svg>';
  },

  pushSample: function(rx,tx){
    this.buf.push({rx:+rx||0, tx:+tx||0});
    if(this.buf.length>this.MAXPTS) this.buf.shift();
    this.drawChart();
  },

  drawPingChart: function(){
    var self=this; if(!self._pingsvg) return Promise.resolve();
    return self.exec(['ping-history']).then(function(csv){
      var b=[]; (csv||'').trim().split('\n').forEach(function(l){
        var f=l.split(','); if(f.length>=2){ var v=parseInt(f[1]); if(!isNaN(v)) b.push(v); } });
      b=b.slice(-90);
      if(!b.length){ self._pingsvg.innerHTML='<div class="mk-hint">'+_('история накапливается (раз в минуту)…')+'</div>'; return; }
      var W=600,H=70,pad=8, max=1,min=1e9;
      b.forEach(function(v){ if(v>max)max=v; if(v<min)min=v; });
      if(min===1e9)min=0; var rng=(max-min)||1, n=b.length, step=n>1?W/(n-1):W;
      var Y=function(v){ return (H-pad-((v-min)/rng)*(H-pad*2)).toFixed(1); };
      var d=''; b.forEach(function(v,i){ d+=(i?'L':'M')+(i*step).toFixed(1)+' '+Y(v)+' '; });
      var last=b[n-1], col=(last<=60?'var(--mk-ok)':(last<=120?'var(--mk-warn)':'var(--mk-bad)'));
      self._pingsvg.innerHTML=
        '<svg class="mk-chart" style="height:70px" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'
        +'<path d="'+d+'L'+((n-1)*step).toFixed(1)+' '+H+' L0 '+H+' Z" fill="'+col+'" fill-opacity=".15"/>'
        +'<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="1.5" stroke-linejoin="round"/></svg>'
        +'<div class="mk-hint" style="margin-top:4px">'+_('текущий')+' <b class="'+self.pingClass(last,'net')
        +'">'+last+' ms</b> · '+_('мин')+' '+min+' · '+_('макс')+' '+max+'</div>';
    });
  },

  loadTunnels: function(force){
    var self=this; if(!self._tuns) return Promise.resolve();
    // plain call uses the CLI's 300s exit-IP cache; force=true re-probes
    return self.exec(force?['tunnels','fresh']:['tunnels']).then(function(t){
      // the default tunnel's exit IP also belongs in the hero card
      var d=(t||'').split('\n').filter(function(l){ return l.indexOf('default|')===0; })[0];
      if(self._hero && d){ var df=d.split('|'); self._hero.exit.textContent=(df[3]&&df[3]!=='—')?df[3]:_('нет выхода'); }
      self._tuns.innerHTML='';
      (t||'').trim().split('\n').forEach(function(l){
        if(!l) return; var f=l.split('|'); if(f.length<4) return;
        var ok=(f[3]&&f[3]!=='—');
        self._tuns.appendChild(E('div',{'class':'mk-card'},[
          E('div',{'class':'mk-card-h'},[ E('b',{},[self.tunName(f[0])]),
            E('span',{'class':'mk-badge '+(ok?'ok':'bad')}, ok?_('● активен'):_('● нет выхода')) ]),
          E('div',{'class':'mk-card-r'},[E('span',{},_('Сервер')), E('b',{},[f[1]||'—'])]),
          E('div',{'class':'mk-card-r'},[E('span',{},_('Внешний IP')), E('b',{},[f[3]||'—'])]),
          E('div',{'class':'mk-card-r'},[E('span',{},'SOCKS'), E('b',{},[f[2]])])
        ]));
      });
      if(!self._tuns.children.length) self._tuns.appendChild(E('div',{'class':'mk-hint'},_('нет туннелей')));
    });
  },

  loadClients: function(){
    var self=this; if(!self._clients) return Promise.resolve();
    return self.exec(['clients']).then(function(t){
      var rows=[E('tr',{'class':'tr table-titles'},[
        E('th',{'class':'th'},_('Устройство')), E('th',{'class':'th'},'IP'),
        E('th',{'class':'th'},_('Соединений')), E('th',{'class':'th'},_('Через туннель')),
        E('th',{'class':'th'},_('Трафик'))])];
      (t||'').trim().split('\n').forEach(function(l){
        if(!l) return; var f=l.split('|'); if(f.length<5) return;
        var routed=parseInt(f[3])||0, rc=E('td',{'class':'td','data-label':_('Через туннель')});
        rc.innerHTML = routed>0 ? '<b class="mk-up">● '+routed+'</b>' : '<span style="opacity:.5">—</span>';
        rows.push(E('tr',{'class':'tr'},[
          E('td',{'class':'td','data-label':_('Устройство')}, [f[1]==='?'?'—':f[1]]),
          E('td',{'class':'td','data-label':'IP'}, [f[0]]),
          E('td',{'class':'td','data-label':_('Соединений')}, [f[2]]),
          rc,
          E('td',{'class':'td','data-label':_('Трафик')}, [self.fmtBytes(f[4])])
        ]));
      });
      if(rows.length===1) rows.push(E('tr',{'class':'tr'},[
        E('td',{'class':'td',colspan:'5',style:'opacity:.6'},_('нет активных клиентов'))]));
      self._clients.innerHTML=''; self._clients.appendChild(E('table',{'class':'table mk-resp'},rows));
    });
  },

  runSelfcheck: function(){
    var self=this;
    self._scout.innerHTML='<div class="mk-hint">'+_('проверяю выходы и сервисы (10–20 c)…')+'</div>';
    return self.exec(['selfcheck']).then(function(t){
      var code=function(c){ c=parseInt(c); var ok=(c>=200&&c<400);
        return '<b class="'+(ok?'mk-up':'mk-down')+'">'+(isNaN(c)?'—':(ok?'✓ '+c:(c?'✗ '+c:_('✗ нет ответа'))))+'</b>'; };
      var rows=[E('tr',{'class':'tr table-titles'},[
        E('th',{'class':'th'},_('Туннель')), E('th',{'class':'th'},_('Внешний IP')),
        E('th',{'class':'th'},_('Страна')), E('th',{'class':'th'},'YouTube'),
        E('th',{'class':'th'},'Telegram'), E('th',{'class':'th'},'Discord')])];
      (t||'').trim().split('\n').forEach(function(l){
        if(!l) return; var f=l.split('|'); if(f.length<6) return;
        var tr=E('tr',{'class':'tr'},[
          E('td',{'class':'td','data-label':_('Туннель')},[self.tunName(f[0])]),
          E('td',{'class':'td','data-label':_('Внешний IP')},[f[1]]),
          E('td',{'class':'td','data-label':_('Страна')},[f[2]])]);
        ['YouTube','Telegram','Discord'].forEach(function(lbl,k){
          var td=E('td',{'class':'td','data-label':lbl}); td.innerHTML=code(f[k+3]); tr.appendChild(td); });
        rows.push(tr);
      });
      self._scout.innerHTML=''; self._scout.appendChild(E('table',{'class':'table mk-resp'},rows));
      return null;
    });
  },

  // One row per check from `meownetvpn health`; the worst one drives the header
  // badge. Deliberately per-tunnel — a single global "connected" hid a dead
  // group tunnel for a whole day.
  loadHealth: function(){
    var self=this; if(!self._checks) return Promise.resolve();
    return self.exec(['health']).then(function(t){
      var rows=(t||'').trim().split('\n').filter(function(l){ return l.indexOf('check|')===0; });
      var rank={ok:0,na:1,warn:2,bad:3}, worst='ok';
      self._checks.innerHTML='';
      rows.forEach(function(l){
        // `emit` interpolates the group label into field 3 unescaped, so a label
        // containing '|' shifted every later field: f[4] stopped being the fix
        // command and the button ran whatever word landed there (`stop` is a real
        // subcommand — it drops all routed traffic). The fix is always the LAST
        // field, the message is everything between; and only the three commands
        // `meownetvpn health` can actually ask for are ever executed.
        var f=l.split('|'), sev=f[2]||'na', wide=(f.length>4);
        var fix=wide?f[f.length-1]:'';
        var txt=f.slice(3, wide?f.length-1:f.length).join('|');
        if(!FIXES[fix]) fix='';
        if((rank[sev]||0)>(rank[worst]||0)) worst=sev;
        var row=E('div',{'class':'mk-chk '+sev},[ E('i',{}), E('span',{},[txt]) ]);
        if(fix) row.appendChild(E('button',{'class':'cbi-button cbi-button-apply',
          click: ui.createHandlerFn(self,function(){
            return self.exec(fix.split(' ')).then(function(){ return self.loadHealth(); });
          })}, _('Исправить')));
        self._checks.appendChild(row);
      });
      if(!rows.length) self._checks.appendChild(E('div',{'class':'mk-hint'},_('нет данных')));
      if(self._badge){
        var m={ok:['ok',_('● всё работает')],warn:['warn',_('● есть замечания')],
               bad:['bad',_('● есть проблемы')],na:['',_('● mesh-нода')]}[worst];
        self._badge.className='mk-badge '+m[0]; self._badge.textContent=m[1];
      }
      return worst;
    });
  },

  loadEvents: function(){
    var self=this; if(!self._events) return Promise.resolve();
    return self.exec(['events','60']).then(function(t){
      var lines=(t||'').trim().split('\n').filter(function(l){ return l.indexOf('|')>0; }).reverse();
      var rows=[E('tr',{'class':'tr table-titles'},[
        E('th',{'class':'th'},_('Время')), E('th',{'class':'th'},_('Источник')), E('th',{'class':'th'},_('Событие'))])];
      lines.forEach(function(l){
        var f=l.split('|'), sev=f[1]||'info';
        rows.push(E('tr',{'class':'tr'},[
          E('td',{'class':'td t','data-label':_('Время')}, [f[0]||'']),
          E('td',{'class':'td','data-label':_('Источник')}, [f[2]||'']),
          E('td',{'class':'td '+(sev==='bad'?'s-bad':(sev==='warn'?'s-warn':'')),'data-label':_('Событие')}, [f[3]||''])
        ]));
      });
      if(rows.length===1) rows.push(E('tr',{'class':'tr'},[
        E('td',{'class':'td',colspan:'3',style:'opacity:.6'},_('событий пока нет'))]));
      self._events.innerHTML='';
      self._events.appendChild(E('table',{'class':'table mk-ev mk-resp'},rows));
    });
  },

  refreshStatus: function(){
    var self=this;
    if(!self._v && !self._badge) return Promise.resolve();   // page has no live status widgets
    // the header asks once on its own and pages ask again on load: one fork is enough
    if(self._rsP) return self._rsP;
    // ui-status = status + traffic rates in one CLI fork (the 5s hot path)
    return self._rsP=this.exec(['ui-status']).then(function(out){
      var s=self.parse(out);
      var svc=(s.service==='running'), xray=(s.xray==='up'), tun=(s.tun2socks==='up');
      var connected=svc&&xray&&tun;
      if(self._v){
        var set=function(node,cls,txt){ node.className=cls; node.textContent=txt; };
        set(self._v.service, svc?'mk-up':'mk-down', svc?_('работает'):_('остановлен'));
        set(self._v.tunnel, connected?'mk-up':(xray?'mk-warn':'mk-down'),
            connected?_('подключён'):(xray?_('только xray'):_('недоступен')));
        self._v.server.textContent=s.server||'—';
        self._v.subnets.textContent=s.subnets||'—';
      }
      if(self._hero) self.paintHero(s, svc, xray, tun);
      // pages showing the check list let loadHealth own the badge
      if(self._badge && !self._checks){
        self._badge.className='mk-badge '+(connected?'ok':(svc?'warn':'bad'));
        self._badge.textContent=connected?_('● подключён'):(svc?_('● деградация'):_('● остановлен'));
      }
      self._setBtn('start', svc); self._setBtn('stop', !svc);
      self._setBtn('restart', !svc); self._setBtn('test', !connected);
      self._setBtn('speed', !connected); self._setBtn('ping', !connected);
      return s;
    }).finally(function(){ self._rsP=null; });
  },

  // the overview's hero card, repainted by every 5 s ui-status tick
  paintHero: function(s, svc, xray, tun){
    var h=this._hero, ok=svc&&xray&&tun;
    h.state.className='mk-state '+(ok?'mk-up':(svc?'mk-warn':'mk-down'));
    h.stateTxt.textContent= ok?_('VPN подключён'):(svc?_('Связь нестабильна'):_('VPN остановлен'));
    h.server.textContent=s.server||'—';
    h.subnets.textContent=s.subnets||'—';
    if(s.rx_rate!=null){ h.rx.textContent=fmtRate(+s.rx_rate); h.tx.textContent=fmtRate(+s.tx_rate); }
  },

  // page header: brand, what this page is, module version, live connection badge
  brandBar: function(subtitle){
    var ver=E('span',{'class':'mk-ver'},'…');
    var self=this;
    this._badge=E('span',{'class':'mk-badge'},'…');
    // every page carries the badge, not only those that poll the status
    setTimeout(function(){ self.refreshStatus(); }, 0);
    this.exec(['version']).then(function(v){ v=(v||'').trim(); ver.textContent=v?('v'+v):''; });
    return E('div',{'class':'mk-head'},[
      E('h2',{},'meowMieru'),
      E('span',{'class':'mk-sub'}, subtitle||_('маршрутизация через VPN')),
      ver, this._badge
    ]);
  },

  tunName: function(n){ return n==='default' ? _('Основной туннель') : n; },

  // "YouTube — видео и YouTube Music" for a list id; unknown ids stay as they are
  listName: function(n){ var i=LIST_INFO[n]; return i ? (i[1] ? i[0]+' — '+i[1] : i[0]) : n; },

  // one card-styled section: title, optional one-line hint, content
  panel: function(title, hint, children){
    var kids=[E('h3',{},title)];
    if(hint) kids.push(E('div',{'class':'mk-hint'},hint));
    return E('div',{'class':'cbi-section mk-panel'}, kids.concat(children||[]));
  },

  // coloured latency pill; kind 'rt' = through the server (TLS+exit+request),
  // 'net' = ICMP to the entry; failed = measured and got no answer at all
  latPill: function(ms, kind, prefix, failed){
    var n=parseInt(ms), g=(kind==='rt')?500:60, y=(kind==='rt')?1000:120;
    var cls=isNaN(n)?(failed?'bad':''):(n<=g?'ok':(n<=y?'warn':'bad'));
    return E('span',{'class':'mk-pill '+cls},[(prefix||'')+(isNaN(n)?(failed?'нет ответа':'—'):n+' мс')]);
  },

  // build a view that carries every helper above (copying non-enumerable proto
  // methods too) plus this page's load/render. `require` hands callers a singleton
  // instance, so this is an instance method: lib.page({ load, render }).
  page: function(extra){
    var proto=Object.getPrototypeOf(this), props={};
    Object.getOwnPropertyNames(proto).forEach(function(k){
      if(k!=='constructor' && k!=='page') props[k]=proto[k];
    });
    Object.keys(extra||{}).forEach(function(k){ props[k]=extra[k]; });
    return view.extend(props);
  }
});

return Base;
