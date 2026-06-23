'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require ui';
'require poll';

/*
 * mierukop dashboard — Nothing-inspired: monochrome, Space Grotesk / Space Mono,
 * structural hierarchy, no emoji, no gradients. Status colour lives on the value.
 */

var CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap');
.mk{
  --bg:transparent; --surf:#fafaf8; --surf2:#fff; --line:#e4e4e0;
  --fg:#0a0a0a; --fg2:#5c5c5c; --fg3:#9a9a9a;
  --up:#1c7d3e; --down:#c4302b; --warn:#b87503; --accent:#c4302b;
  font-family:'Space Grotesk',-apple-system,Segoe UI,Roboto,sans-serif; color:var(--fg);
}
@media (prefers-color-scheme:dark){.mk{
  --surf:#0e0e0e; --surf2:#161616; --line:#262626;
  --fg:#f4f4f2; --fg2:#9a9a9a; --fg3:#5e5e5e;
  --up:#34d058; --down:#ff5a4d; --warn:#e8a317; --accent:#ff5a4d;
}}
.mk *{box-sizing:border-box}
.mk-mono{font-family:'Space Mono',ui-monospace,Menlo,monospace}
.mk-lbl{font-family:'Space Mono',monospace; font-size:10.5px; font-weight:700; letter-spacing:.12em;
        text-transform:uppercase; color:var(--fg3)}

/* header */
.mk-hd{display:flex; align-items:baseline; gap:14px; padding:6px 2px 2px; flex-wrap:wrap}
.mk-hd h1{margin:0; font-size:30px; font-weight:700; letter-spacing:-.02em}
.mk-hd .tag{font-size:13px; color:var(--fg2)}
.mk-conn{margin-left:auto; display:flex; align-items:center; gap:9px; font-family:'Space Mono',monospace;
         font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase}
.mk-led{width:8px; height:8px; border-radius:50%; background:var(--fg3)}
.mk-led.on{background:var(--up)} .mk-led.deg{background:var(--warn)} .mk-led.off{background:var(--down)}

.mk-rule{height:1px; background:var(--line); margin:14px 0 22px}
.mk-sec{margin:30px 0 12px}

/* stat strip */
.mk-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:1px;
         background:var(--line); border:1px solid var(--line); border-radius:10px; overflow:hidden}
.mk-cell{background:var(--surf2); padding:15px 16px}
.mk-cell .v{font-size:23px; font-weight:700; letter-spacing:-.02em; line-height:1.15; display:flex; align-items:center; gap:8px}
.mk-cell .v.mono{font-family:'Space Mono',monospace; font-size:18px}
.mk-cell .v.up{color:var(--up)} .mk-cell .v.down{color:var(--down)} .mk-cell .v.warn{color:var(--warn)}
.mk-cell .k{margin-top:7px}

/* chart */
.mk-chart{background:var(--surf2); border:1px solid var(--line); border-radius:10px; padding:16px 16px 8px}
.mk-chart .top{display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px}
.mk-chart .now{font-family:'Space Mono',monospace; font-size:13px; color:var(--fg2)}
.mk-chart .now b{color:var(--fg); font-weight:700}
.mk-chart svg{display:block; width:100%; height:120px}
.mk-leg{display:flex; gap:16px; margin-top:6px}
.mk-leg span{display:flex; align-items:center; gap:6px; font-family:'Space Mono',monospace; font-size:10.5px;
             letter-spacing:.08em; text-transform:uppercase; color:var(--fg3)}
.mk-leg i{width:14px; height:2px; display:inline-block}

/* actions */
.mk-row{display:flex; gap:8px; flex-wrap:wrap; align-items:center}
.mk-btn{font-family:'Space Mono',monospace; font-size:11.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
        padding:9px 16px; border-radius:6px; border:1px solid var(--line); background:var(--surf2); color:var(--fg);
        cursor:pointer; transition:border-color .12s, color .12s, opacity .12s}
.mk-btn:hover:not([disabled]){border-color:var(--fg)}
.mk-btn[disabled]{opacity:.32; cursor:not-allowed}
.mk-btn.pri{background:var(--fg); color:var(--surf2); border-color:var(--fg)}
.mk-btn.pri:hover:not([disabled]){opacity:.85}
.mk-btn.dgr{color:var(--accent); border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
.mk-spin{display:inline-block; width:11px; height:11px; border:2px solid currentColor; border-right-color:transparent;
         border-radius:50%; animation:mkrot .7s linear infinite; vertical-align:-1px; margin-right:6px}
@keyframes mkrot{to{transform:rotate(360deg)}}
.mk-out{background:#0a0a0a; color:#dcdcdc; border-radius:8px; padding:12px 14px; font-family:'Space Mono',monospace;
        font-size:12px; white-space:pre-wrap; line-height:1.55; margin-top:12px; max-height:220px; overflow:auto}

/* servers */
.mk-srv{display:flex; flex-direction:column; gap:1px; background:var(--line); border:1px solid var(--line);
        border-radius:10px; overflow:hidden}
.mk-srv .it{background:var(--surf2); padding:13px 16px; display:flex; align-items:center; gap:12px}
.mk-srv .it .mark{width:7px; height:7px; border-radius:50%; background:var(--fg3); flex:0 0 auto}
.mk-srv .it.act .mark{background:var(--up)}
.mk-srv .it .nm{font-weight:700; font-size:14px}
.mk-srv .it .ad{font-family:'Space Mono',monospace; font-size:11.5px; color:var(--fg2)}
.mk-srv .it .rt{margin-left:auto; display:flex; align-items:center; gap:8px}
.mk-srv .it .pill{font-family:'Space Mono',monospace; font-size:9.5px; font-weight:700; letter-spacing:.1em;
                  text-transform:uppercase; color:var(--up); border:1px solid color-mix(in srgb,var(--up) 40%,transparent);
                  padding:2px 7px; border-radius:999px}

/* form polish */
.mk-form .cbi-section{background:var(--surf2); border:1px solid var(--line); border-radius:10px;
                      padding:4px 18px 14px; margin-bottom:14px; box-shadow:none}
.mk-form .cbi-section h3{font-size:13px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--fg2)}
.mk-form legend{font-weight:700}
.mk-form .cbi-tabmenu{margin-bottom:8px}
`;

function fmtRate(bps){
  bps = bps || 0;
  if (bps >= 1048576) return (bps/1048576).toFixed(1)+' MB/s';
  if (bps >= 1024)    return (bps/1024).toFixed(0)+' KB/s';
  return bps+' B/s';
}
function fmtBytes(b){
  b = b || 0;
  if (b >= 1073741824) return (b/1073741824).toFixed(2)+' GB';
  if (b >= 1048576)    return (b/1048576).toFixed(1)+' MB';
  if (b >= 1024)       return (b/1024).toFixed(0)+' KB';
  return b+' B';
}

return view.extend({
  buf: [],          // [{rx,tx}] rolling traffic samples
  MAXPTS: 90,

  load: function(){ return Promise.all([ uci.load('mierukop') ]); },

  parse: function(t){ var o={}; (t||'').split('\n').forEach(function(l){
    var i=l.indexOf(':'); if(i>0) o[l.slice(0,i).trim()]=l.slice(i+1).trim(); }); return o; },

  exec: function(args){ return fs.exec('/usr/bin/mierukop', args)
    .then(function(r){ return (r.stdout||'')+(r.stderr||''); }).catch(function(){ return ''; }); },

  // ── traffic chart (monochrome SVG area) ──
  drawChart: function(){
    var b=this.buf, W=600, H=120, pad=4;
    var max=1; b.forEach(function(p){ if(p.rx>max)max=p.rx; if(p.tx>max)max=p.tx; });
    var n=b.length, step = n>1 ? (W)/(n-1) : W;
    var path=function(key,close){
      if(!n) return '';
      var d=''; b.forEach(function(p,i){
        var x=(i*step).toFixed(1);
        var y=(H-pad-(p[key]/max)*(H-pad*2)).toFixed(1);
        d += (i?'L':'M')+x+' '+y+' ';
      });
      if(close) d += 'L'+((n-1)*step).toFixed(1)+' '+H+' L0 '+H+' Z';
      return d;
    };
    var last=b[n-1]||{rx:0,tx:0};
    this._chartNow.innerHTML = 'DOWN <b>'+fmtRate(last.rx)+'</b> &nbsp; UP <b>'+fmtRate(last.tx)+'</b>';
    var svg=''
      + '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'
      + '<line x1="0" y1="'+(H/2)+'" x2="'+W+'" y2="'+(H/2)+'" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 4"/>'
      + '<path d="'+path('rx',true)+'" fill="var(--fg)" opacity="0.10"/>'
      + '<path d="'+path('rx',false)+'" fill="none" stroke="var(--fg)" stroke-width="2" stroke-linejoin="round"/>'
      + '<path d="'+path('tx',false)+'" fill="none" stroke="var(--fg2)" stroke-width="1.5" stroke-dasharray="2 3" stroke-linejoin="round"/>'
      + '</svg>';
    this._chartSvg.innerHTML = svg;
  },

  pushSample: function(rx,tx){
    this.buf.push({rx:+rx||0, tx:+tx||0});
    if(this.buf.length>this.MAXPTS) this.buf.shift();
    this.drawChart();
  },

  refreshStatus: function(){
    var self=this;
    return this.exec(['status']).then(function(out){
      var s=self.parse(out);
      var svc=(s.service==='running'), mieru=(s.mieru==='up'), tun=(s.tun2socks==='up');
      var connected=svc&&mieru&&tun;
      // header LED + word
      self._led.className='mk-led '+(connected?'on':(svc?'deg':'off'));
      self._conn.textContent = connected?_('Connected'):(svc?_('Degraded'):_('Stopped'));
      // cells
      self._c.service.className='v '+(svc?'up':'down'); self._c.service.textContent=svc?_('running'):_('stopped');
      self._c.tunnel.className='v '+(connected?'up':(mieru?'warn':'down'));
      self._c.tunnel.textContent=connected?_('up'):(mieru?'mieru only':_('down'));
      self._c.subnets.textContent=s.subnets||'—';
      self._c.server.textContent=(s.server||'—');
      // state-aware buttons
      self._setBtn('start', svc); self._setBtn('stop', !svc);
      self._setBtn('restart', !svc); self._setBtn('test', !connected);
      self._setBtn('speed', !connected); self._setBtn('ping', !connected);
      return s;
    });
  },

  _setBtn: function(k, disabled){
    var b=this._btns&&this._btns[k]; if(!b||b._busy) return;
    if(disabled) b.setAttribute('disabled',''); else b.removeAttribute('disabled');
  },

  // a Space-Mono action button with spinner + busy lock
  mkBtn: function(key, cls, label, fn, out){
    var self=this;
    var b=E('button',{'class':'mk-btn '+cls, click: ui.createHandlerFn(self,function(){
      var orig=b.innerHTML; b._busy=true; b.setAttribute('disabled','');
      b.innerHTML=''; b.appendChild(E('span',{'class':'mk-spin'})); b.appendChild(E('span',{},label));
      return fn().then(function(txt){ if(txt!=null && out){ out.style.display='block'; out.textContent=txt; } })
        .finally(function(){ b._busy=false; b.innerHTML=orig; self.refreshStatus(); });
    })},label);
    (this._btns=this._btns||{})[key]=b; return b;
  },

  render: function(){
    var self=this, m, s, o;

    // ════ settings form ════
    m=new form.Map('mierukop','','');

    s=m.section(form.NamedSection,'settings','mierukop');
    s.anonymous=true; s.addremove=false;
    s.tab('conn',_('Connection'));
    s.tab('lists',_('Routing'));
    s.tab('adv',_('Advanced'));

    o=s.taboption('conn',form.Flag,'enabled',_('Enabled')); o.rmempty=false;
    o=s.taboption('conn',form.ListValue,'active_server',_('Active server'),
      _('Which server below carries traffic. Edit credentials in the Servers panel above.'));
    uci.sections('mierukop','server').forEach(function(sv){
      o.value(sv['.name'], (sv.label||sv['.name'])+' — '+(sv.address||'')+':'+(sv.port||''));
    });
    o=s.taboption('conn',form.Flag,'failover',_('Auto-failover'),
      _('Switch to the next server automatically if the active one stops passing traffic.'));

    o=s.taboption('lists',form.MultiValue,'community_lists',_('Community lists'),
      _('Services routed through the tunnel (itdoginfo/allow-domains). Press “Update lists” after changing.'));
    o.display_size=14;
    ['telegram','meta','twitter','discord','roblox','cloudflare','hetzner','digitalocean',
     'youtube','tiktok','google_ai','google_play','hdrezka',
     'russia_outside','anime','news','porn','geoblock','block'].forEach(function(n){ o.value(n,n); });
    o.rmempty=true;
    o=s.taboption('lists',form.Value,'routed_dns',_('Resolver for routed domains'),
      _('Real DNS used to resolve routed domains (tunneled, bypasses DPI/fake-IP).'));
    o.datatype='ipaddr'; o.placeholder='8.8.8.8'; o.optional=true;

    o=s.taboption('adv',form.Flag,'watchdog',_('Watchdog'),
      _('Auto-restart the tunnel if it stops passing traffic (checked every 5 min).'));
    o=s.taboption('adv',form.Flag,'killswitch',_('Kill-switch'),
      _('Drop routed traffic if the tunnel is down, instead of leaking it directly.'));
    o=s.taboption('adv',form.Flag,'dns_hijack',_('Force router DNS'),
      _('Redirect client DNS to the router so domain routing works for every device.'));
    o=s.taboption('adv',form.Value,'update_interval',_('List refresh (hours)'));
    o.datatype='uinteger'; o.placeholder='24';
    o=s.taboption('adv',form.Value,'socks_port',_('Local SOCKS5 port')); o.datatype='port'; o.optional=true;
    o=s.taboption('adv',form.Value,'tun_name',_('Tunnel interface')); o.optional=true; o.placeholder='mtun0';

    // ════ servers (native CRUD) ════
    s=m.section(form.GridSection,'server',_('Servers'),
      _('Add more for auto-failover. The active one is selected in Connection.'));
    s.addremove=true; s.anonymous=false; s.sortable=false;
    s.option(form.Value,'label',_('Label'));
    s.option(form.Value,'address',_('Address')).datatype='host';
    s.option(form.Value,'port',_('Port')).datatype='port';
    s.option(form.Value,'username',_('User'));
    o=s.option(form.Value,'password',_('Password')); o.password=true;
    o=s.option(form.ListValue,'transport',_('Transport')); o.value('TCP'); o.value('UDP');

    // ════ custom rules ════
    s=m.section(form.NamedSection,'user','policy',_('Custom rules'));
    s.anonymous=true; s.addremove=false;
    s.tab('routed',_('Routed (via tunnel)'));
    s.tab('excluded',_('Excluded (direct)'));
    o=s.taboption('routed',form.DynamicList,'domain',_('Domain')); o.placeholder='example.com';
    o=s.taboption('routed',form.DynamicList,'subnet',_('Subnet (CIDR)')); o.datatype='cidr4'; o.placeholder='203.0.113.0/24';
    o=s.taboption('excluded',form.DynamicList,'exclude_domain',_('Domain (always direct)')); o.placeholder='sberbank.ru';
    o=s.taboption('excluded',form.DynamicList,'exclude_subnet',_('Subnet (always direct)')); o.datatype='cidr4'; o.placeholder='192.168.0.0/16';

    return m.render().then(function(formNode){
      formNode.classList.add('mk-form');

      // header
      self._led=E('span',{'class':'mk-led'});
      self._conn=E('span',{},_('checking…'));
      var header=E('div',{'class':'mk-hd'},[
        E('h1',{},'mierukop'),
        E('span',{'class':'tag'},_('Selective routing over a mieru tunnel')),
        E('div',{'class':'mk-conn'},[ self._led, self._conn ])
      ]);

      // stat strip
      var cell=function(node,label){ return E('div',{'class':'mk-cell'},[
        E('div',{'class':'v'},[node]), E('div',{'class':'k mk-lbl'},label) ]); };
      self._c={
        service:E('span',{},'—'), tunnel:E('span',{},'—'),
        subnets:E('span',{},'—'), server:E('span',{'class':'mk-mono'},'—')
      };
      var stats=E('div',{'class':'mk-grid'},[
        cell(self._c.service,_('Service')),
        cell(self._c.tunnel,_('Tunnel')),
        cell(self._c.subnets,_('Routed subnets')),
        cell(self._c.server,_('Active server'))
      ]);

      // chart
      self._chartNow=E('div',{'class':'now'},'—');
      self._chartSvg=E('div',{});
      var chart=E('div',{'class':'mk-chart'},[
        E('div',{'class':'top'},[ E('div',{'class':'mk-lbl'},_('Tunnel traffic')), self._chartNow ]),
        self._chartSvg,
        E('div',{'class':'mk-leg'},[
          E('span',{},[ E('i',{style:'background:var(--fg)'}), _('Download') ]),
          E('span',{},[ E('i',{style:'background:var(--fg2)'}), _('Upload') ])
        ])
      ]);

      // metrics (ping / speed) — values fill in on demand
      self._m={ srtt:E('span',{},'—'), trtt:E('span',{},'—'), down:E('span',{},'—'), up:E('span',{},'—') };
      var mcell=function(node,label,sfx){ return E('div',{'class':'mk-cell'},[
        E('div',{'class':'v mono'},[node, sfx?E('span',{style:'font-size:11px;color:var(--fg3);font-weight:400'},' '+sfx):'']),
        E('div',{'class':'k mk-lbl'},label) ]); };
      var metrics=E('div',{'class':'mk-grid'},[
        mcell(self._m.srtt,_('Server ping'),'ms'),
        mcell(self._m.trtt,_('Tunnel ping'),'ms'),
        mcell(self._m.down,_('Download'),'Mbps'),
        mcell(self._m.up,_('Upload'),'Mbps')
      ]);

      var out=E('div',{'class':'mk-out',style:'display:none'});

      var actions=E('div',{'class':'mk-row'},[
        self.mkBtn('start','pri',_('Start'),     function(){ return self.exec(['start']); }, out),
        self.mkBtn('stop','dgr',_('Stop'),       function(){ return self.exec(['stop']); }, out),
        self.mkBtn('restart','',_('Restart'),    function(){ return self.exec(['restart']); }, out),
        self.mkBtn('test','',_('Test'),          function(){
          return self.exec(['test']).then(function(t){
            var mm=(t||'').match(/exit IP:\s*([0-9a-fA-F:.]+)/);
            if(mm){ self._c.server.textContent=mm[1]; }
            return t;
          });
        }, out),
        self.mkBtn('update','',_('Update lists'), function(){ return self.exec(['update']); }, out)
      ]);

      var tools=E('div',{'class':'mk-row'},[
        self.mkBtn('ping','',_('Ping'), function(){
          return self.exec(['ping']).then(function(t){
            var p=self.parse(t);
            self._m.srtt.textContent=p.server_rtt_ms||'—';
            self._m.trtt.textContent=p.tunnel_rtt_ms||'—';
            return null;
          });
        }),
        self.mkBtn('speed','',_('Speed test'), function(){
          self._m.down.textContent='…'; self._m.up.textContent='…';
          return self.exec(['speedtest']).then(function(t){
            var p=self.parse(t);
            self._m.down.textContent=p.down_mbps||'0';
            self._m.up.textContent=p.up_mbps||'0';
            return null;
          });
        })
      ]);

      var page=E('div',{'class':'mk'},[
        E('style',{},CSS),
        header,
        E('div',{'class':'mk-rule'}),
        stats,
        E('div',{'class':'mk-sec mk-lbl'},_('Throughput')),
        chart,
        E('div',{'class':'mk-sec mk-lbl'},_('Quality')),
        metrics, tools,
        E('div',{'class':'mk-sec mk-lbl'},_('Control')),
        actions, out,
        E('div',{'class':'mk-sec mk-lbl'},_('Configuration')),
        formNode
      ]);

      // seed chart history, then go live
      self.drawChart();
      self.exec(['history']).then(function(csv){
        (csv||'').trim().split('\n').forEach(function(l){
          var f=l.split(','); if(f.length>=3) self.buf.push({rx:+f[1]||0, tx:+f[2]||0});
        });
        if(self.buf.length>self.MAXPTS) self.buf=self.buf.slice(-self.MAXPTS);
        self.drawChart();
      });

      self.refreshStatus();
      poll.add(function(){ return self.refreshStatus(); }, 5);
      poll.add(function(){
        return self.exec(['stats']).then(function(t){
          var p=self.parse(t); self.pushSample(p.rx_rate, p.tx_rate);
        });
      }, 3);

      return page;
    });
  }
});
