'use strict';
'require baseclass';
'require view';
'require fs';
'require ui';
'require uci';

/*
 * Shared helpers for the meowMieru (mierukop) multi-page LuCI app.
 * Returned as a `baseclass` subclass (so `require` hands back the class, not an
 * auto-instantiated view) with a static `page()` that builds a view carrying all
 * these helpers. Each page does:
 *   'require mierukop.lib as lib';  return lib.page({ load, render });
 */

var RX_COL = '#16a34a', TX_COL = '#2563eb';

var CSS = `
.mk-chart{display:block;width:100%;height:130px;border:1px solid rgba(127,127,127,.3);border-radius:3px;
          background:rgba(127,127,127,.05)}
.mk-act{margin:10px 0 0;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.mk-leg{display:flex;gap:22px;flex-wrap:wrap;margin-top:8px;font-size:12px}
.mk-leg span{display:inline-flex;align-items:center;gap:7px}
.mk-leg i{width:12px;height:12px;border-radius:2px;display:inline-block;flex:0 0 auto}
.mk-leg b{font-weight:600}
.mk-out{white-space:pre-wrap;font-family:monospace;font-size:12px;background:rgba(127,127,127,.1);
        padding:10px 12px;border-radius:4px;margin-top:10px;max-height:200px;overflow:auto;display:none}
.mk-up{color:#16a34a;font-weight:bold}.mk-down{color:#dc2626;font-weight:bold}.mk-warn{color:#d97706;font-weight:bold}
.mk-st td{padding:5px 8px}
.mk-badge{font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;line-height:1;white-space:nowrap;
          border:1px solid transparent}
.mk-badge.ok{color:#16a34a;background:rgba(22,163,74,.12);border-color:rgba(22,163,74,.35)}
.mk-badge.warn{color:#b45309;background:rgba(217,119,6,.12);border-color:rgba(217,119,6,.35)}
.mk-badge.bad{color:#dc2626;background:rgba(220,38,38,.12);border-color:rgba(220,38,38,.35)}
.mk-cards{display:flex;gap:10px;flex-wrap:wrap}
.mk-card{flex:1 1 210px;min-width:210px;border:1px solid rgba(127,127,127,.25);border-radius:8px;
         padding:10px 12px;background:rgba(127,127,127,.04)}
.mk-card-h{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.mk-card-h b{font-size:13px;font-weight:700}
.mk-card-r{display:flex;justify-content:space-between;font-size:12px;padding:2px 0;gap:10px}
.mk-card-r>span{opacity:.6;white-space:nowrap}
.mk-card-r>b{font-weight:600;text-align:right;word-break:break-all}
.mk-hint{font-size:12px;opacity:.75;margin-bottom:8px}
`;

function fmtRate(bps){
  bps = bps || 0;
  if (bps >= 1048576) return (bps/1048576).toFixed(1)+' МБ/с';
  if (bps >= 1024)    return (bps/1024).toFixed(0)+' КБ/с';
  return bps+' Б/с';
}

var Base = baseclass.extend({
  CSS: CSS,
  buf: [],
  MAXPTS: 90,
  pingMap: {},

  // load uci + the cached server pings into this.pingMap
  loadBase: function(){
    var self=this;
    return Promise.all([
      uci.load('mierukop'),
      fs.exec('/usr/bin/mierukop',['pingcache']).catch(function(){ return {stdout:''}; })
    ]).then(function(res){
      self.pingMap={};
      ((res[1]&&res[1].stdout)||'').trim().split('\n').forEach(function(l){
        var f=l.split('|'); if(f[0]) self.pingMap[f[0]]=f[3]; });
      return res;
    });
  },

  exec: function(args){ return fs.exec('/usr/bin/mierukop', args)
    .then(function(r){ return (r.stdout||'')+(r.stderr||''); }).catch(function(){ return ''; }); },

  parse: function(t){ var o={}; (t||'').split('\n').forEach(function(l){
    var i=l.indexOf(':'); if(i>0) o[l.slice(0,i).trim()]=l.slice(i+1).trim(); }); return o; },

  srvLabel: function(sec, base){
    var ms=this.pingMap[sec];
    return base + (ms && ms!=='—' ? ' · '+ms+'ms' : '');
  },

  pingClass: function(ms, kind){
    var n=parseInt(ms); if(isNaN(n)) return 'mk-down';
    var g=(kind==='tun')?200:60, y=(kind==='tun')?400:120;
    return n<=g ? 'mk-up' : (n<=y ? 'mk-warn' : 'mk-down');
  },

  colorPings: function(){
    var col=function(ms){ var n=parseInt(ms); return isNaN(n)?'#dc2626':(n<=60?'#16a34a':(n<=120?'#d97706':'#dc2626')); };
    document.querySelectorAll('table').forEach(function(tbl){
      var hdr=tbl.querySelector('tr'); if(!hdr) return; var idx=-1;
      Array.prototype.forEach.call(hdr.children,function(th,i){ if((th.textContent||'').trim()==='Пинг, мс') idx=i; });
      if(idx<0) return;
      var rows=tbl.querySelectorAll('tr');
      for(var r=1;r<rows.length;r++){ var c=rows[r].children[idx]; if(!c) continue;
        c.style.fontWeight='bold'; c.style.color=col(c.textContent); }
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
      var last=b[n-1], col=(last<=60?RX_COL:(last<=120?'#d97706':'#dc2626'));
      self._pingsvg.innerHTML=
        '<svg class="mk-chart" style="height:70px" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'
        +'<path d="'+d+'L'+((n-1)*step).toFixed(1)+' '+H+' L0 '+H+' Z" fill="'+col+'" fill-opacity=".15"/>'
        +'<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="1.5" stroke-linejoin="round"/></svg>'
        +'<div class="mk-hint" style="margin-top:4px">'+_('текущий')+' <b class="'+self.pingClass(last,'net')
        +'">'+last+' ms</b> · '+_('мин')+' '+min+' · '+_('макс')+' '+max+'</div>';
    });
  },

  loadTunnels: function(){
    var self=this; if(!self._tuns) return Promise.resolve();
    return self.exec(['tunnels']).then(function(t){
      self._tuns.innerHTML='';
      (t||'').trim().split('\n').forEach(function(l){
        if(!l) return; var f=l.split('|'); if(f.length<4) return;
        var ok=(f[3]&&f[3]!=='—');
        self._tuns.appendChild(E('div',{'class':'mk-card'},[
          E('div',{'class':'mk-card-h'},[ E('b',{},f[0]),
            E('span',{'class':'mk-badge '+(ok?'ok':'bad')}, ok?_('● активен'):_('● нет выхода')) ]),
          E('div',{'class':'mk-card-r'},[E('span',{},_('Сервер')), E('b',{},f[1]||'—')]),
          E('div',{'class':'mk-card-r'},[E('span',{},_('Внешний IP')), E('b',{},f[3]||'—')]),
          E('div',{'class':'mk-card-r'},[E('span',{},'SOCKS'), E('b',{},f[2])])
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
        var routed=parseInt(f[3])||0, rc=E('td',{'class':'td'});
        rc.innerHTML = routed>0 ? '<b class="mk-up">● '+routed+'</b>' : '<span style="opacity:.5">—</span>';
        rows.push(E('tr',{'class':'tr'},[
          E('td',{'class':'td'}, f[1]==='?'?'—':f[1]),
          E('td',{'class':'td'}, f[0]),
          E('td',{'class':'td'}, f[2]),
          rc,
          E('td',{'class':'td'}, self.fmtBytes(f[4]))
        ]));
      });
      if(rows.length===1) rows.push(E('tr',{'class':'tr'},[
        E('td',{'class':'td',colspan:'5',style:'opacity:.6'},_('нет активных клиентов'))]));
      self._clients.innerHTML=''; self._clients.appendChild(E('table',{'class':'table'},rows));
    });
  },

  runSelfcheck: function(){
    var self=this;
    self._scout.innerHTML='<div class="mk-hint">'+_('проверяю выходы и сервисы (10–20 c)…')+'</div>';
    return self.exec(['selfcheck']).then(function(t){
      var code=function(c){ c=parseInt(c); var ok=(c>=200&&c<400);
        return '<b class="'+(ok?'mk-up':'mk-down')+'">'+(isNaN(c)?'—':(ok?'✓ '+c:'✗ '+c))+'</b>'; };
      var rows=[E('tr',{'class':'tr table-titles'},[
        E('th',{'class':'th'},_('Туннель')), E('th',{'class':'th'},_('Внешний IP')),
        E('th',{'class':'th'},_('Страна')), E('th',{'class':'th'},'YouTube'),
        E('th',{'class':'th'},'Telegram'), E('th',{'class':'th'},'Discord')])];
      (t||'').trim().split('\n').forEach(function(l){
        if(!l) return; var f=l.split('|'); if(f.length<6) return;
        var tr=E('tr',{'class':'tr'},[
          E('td',{'class':'td'},f[0]), E('td',{'class':'td'},f[1]), E('td',{'class':'td'},f[2])]);
        ['3','4','5'].forEach(function(i){ var td=E('td',{'class':'td'}); td.innerHTML=code(f[i]); tr.appendChild(td); });
        rows.push(tr);
      });
      self._scout.innerHTML=''; self._scout.appendChild(E('table',{'class':'table'},rows));
      return null;
    });
  },

  refreshStatus: function(){
    var self=this;
    if(!self._v && !self._badge) return Promise.resolve();   // page has no live status widgets
    return this.exec(['status']).then(function(out){
      var s=self.parse(out);
      var svc=(s.service==='running'), mieru=(s.mieru==='up'), tun=(s.tun2socks==='up');
      var connected=svc&&mieru&&tun;
      if(self._v){
        var set=function(node,cls,txt){ node.className=cls; node.textContent=txt; };
        set(self._v.service, svc?'mk-up':'mk-down', svc?_('работает'):_('остановлен'));
        set(self._v.tunnel, connected?'mk-up':(mieru?'mk-warn':'mk-down'),
            connected?_('подключён'):(mieru?_('только mieru'):_('недоступен')));
        self._v.server.textContent=s.server||'—';
        self._v.subnets.textContent=s.subnets||'—';
      }
      if(self._badge){
        self._badge.className='mk-badge '+(connected?'ok':(svc?'warn':'bad'));
        self._badge.textContent=connected?_('● подключён'):(svc?_('● деградация'):_('● остановлен'));
      }
      self._setBtn('start', svc); self._setBtn('stop', !svc);
      self._setBtn('restart', !svc); self._setBtn('test', !connected);
      self._setBtn('speed', !connected); self._setBtn('ping', !connected);
      return s;
    });
  },

  // a compact page header with the brand + live connection badge
  brandBar: function(subtitle){
    this._badge=E('span',{'class':'mk-badge'},'…');
    return E('div',{style:'display:flex;align-items:center;gap:10px;margin:2px 2px 12px'},[
      E('h2',{style:'margin:0;font-weight:700;letter-spacing:-.01em'},'meowMieru'),
      E('span',{style:'font-size:12px;opacity:.6'}, subtitle||_('маршрутизация через mieru')),
      this._badge
    ]);
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
