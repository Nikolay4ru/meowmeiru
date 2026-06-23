'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require ui';
'require poll';

/*
 * mierukop dashboard — native LuCI look (cbi-section / cbi-button / table).
 * Only minimal custom CSS for the SVG traffic chart; colours follow the theme
 * via currentColor so it works on every LuCI theme (light & dark).
 */

var CSS = `
.mk-chart{display:block;width:100%;height:120px}
.mk-act{margin:10px 0 0;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.mk-now{font-family:monospace;font-size:12px;margin-bottom:6px;color:inherit;opacity:.8}
.mk-out{white-space:pre-wrap;font-family:monospace;font-size:12px;background:rgba(127,127,127,.1);
        padding:10px 12px;border-radius:4px;margin-top:10px;max-height:200px;overflow:auto;display:none}
.mk-up{color:#16a34a;font-weight:bold}.mk-down{color:#dc2626;font-weight:bold}.mk-warn{color:#d97706;font-weight:bold}
.mk-st td{padding:5px 8px}
`;

function fmtRate(bps){
  bps = bps || 0;
  if (bps >= 1048576) return (bps/1048576).toFixed(1)+' MB/s';
  if (bps >= 1024)    return (bps/1024).toFixed(0)+' KB/s';
  return bps+' B/s';
}

return view.extend({
  buf: [],
  MAXPTS: 90,

  load: function(){ return Promise.all([ uci.load('mierukop') ]); },

  parse: function(t){ var o={}; (t||'').split('\n').forEach(function(l){
    var i=l.indexOf(':'); if(i>0) o[l.slice(0,i).trim()]=l.slice(i+1).trim(); }); return o; },

  exec: function(args){ return fs.exec('/usr/bin/mierukop', args)
    .then(function(r){ return (r.stdout||'')+(r.stderr||''); }).catch(function(){ return ''; }); },

  // ── traffic chart (monochrome SVG, follows theme via currentColor) ──
  drawChart: function(){
    var b=this.buf, W=600, H=120, pad=4;
    var max=1; b.forEach(function(p){ if(p.rx>max)max=p.rx; if(p.tx>max)max=p.tx; });
    var n=b.length, step = n>1 ? W/(n-1) : W;
    var path=function(key,close){
      if(!n) return '';
      var d=''; b.forEach(function(p,i){
        var x=(i*step).toFixed(1), y=(H-pad-(p[key]/max)*(H-pad*2)).toFixed(1);
        d += (i?'L':'M')+x+' '+y+' ';
      });
      if(close) d += 'L'+((n-1)*step).toFixed(1)+' '+H+' L0 '+H+' Z';
      return d;
    };
    var last=b[n-1]||{rx:0,tx:0};
    this._now.innerHTML='DOWN <b>'+fmtRate(last.rx)+'</b> &nbsp; UP <b>'+fmtRate(last.tx)+'</b>';
    this._svg.innerHTML=''
      + '<svg class="mk-chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" style="color:inherit">'
      + '<line x1="0" y1="'+(H/2)+'" x2="'+W+'" y2="'+(H/2)+'" stroke="currentColor" stroke-opacity=".15" stroke-dasharray="3 4"/>'
      + '<path d="'+path('rx',true)+'" fill="currentColor" fill-opacity=".12"/>'
      + '<path d="'+path('rx',false)+'" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
      + '<path d="'+path('tx',false)+'" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="2 3"/>'
      + '</svg>';
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
      var set=function(node,cls,txt){ node.className=cls; node.textContent=txt; };
      set(self._v.service, svc?'mk-up':'mk-down', svc?_('running'):_('stopped'));
      set(self._v.tunnel, connected?'mk-up':(mieru?'mk-warn':'mk-down'),
          connected?_('connected'):(mieru?'mieru only':_('down')));
      self._v.server.textContent=s.server||'—';
      self._v.subnets.textContent=s.subnets||'—';
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

  mkBtn: function(key, cls, label, fn, out){
    var self=this;
    var b=E('button',{'class':'cbi-button '+cls, click: ui.createHandlerFn(self,function(){
      b._busy=true; b.setAttribute('disabled',''); var orig=b.textContent; b.textContent=label+'…';
      return fn().then(function(txt){ if(txt!=null && out){ out.style.display='block'; out.textContent=txt; } })
        .finally(function(){ b._busy=false; b.textContent=orig; self.refreshStatus(); });
    })}, label);
    (this._btns=this._btns||{})[key]=b; return b;
  },

  row: function(label, valNode){
    return E('tr',{'class':'tr'},[
      E('td',{'class':'td left','width':'34%'},label),
      E('td',{'class':'td left'},[valNode])
    ]);
  },

  render: function(){
    var self=this, m, s, o;

    m=new form.Map('mierukop','','');

    s=m.section(form.NamedSection,'settings','mierukop');
    s.anonymous=true; s.addremove=false;
    s.tab('conn',_('Connection'));
    s.tab('lists',_('Routing'));
    s.tab('adv',_('Advanced'));

    o=s.taboption('conn',form.Flag,'enabled',_('Enabled')); o.rmempty=false;
    o=s.taboption('conn',form.ListValue,'active_server',_('Active server'),
      _('Which server below carries traffic. Edit credentials in the Servers section.'));
    uci.sections('mierukop','server').forEach(function(sv){
      o.value(sv['.name'], (sv.label||sv['.name'])+' — '+(sv.address||'')+':'+(sv.port||''));
    });
    o=s.taboption('conn',form.Flag,'failover',_('Auto-failover'),
      _('Switch to the next server automatically if the active one stops passing traffic.'));

    o=s.taboption('lists',form.MultiValue,'community_lists',_('Community lists'),
      _('Services routed through the tunnel (itdoginfo/allow-domains). Press “Update lists” after changing.'));
    o.display_size=16;
    ['telegram','meta','twitter','discord','roblox','cloudflare','hetzner','digitalocean',
     'youtube','tiktok','google_ai','google_play','hdrezka',
     'russia_inside','russia_outside','anime','news','porn','geoblock','block'].forEach(function(n){ o.value(n,n); });
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

    s=m.section(form.GridSection,'server',_('Servers'),
      _('Add more for auto-failover. The active one is selected in Connection.'));
    s.addremove=true; s.anonymous=false; s.sortable=false;
    s.option(form.Value,'label',_('Label'));
    s.option(form.Value,'address',_('Address')).datatype='host';
    s.option(form.Value,'port',_('Port')).datatype='port';
    s.option(form.Value,'username',_('User'));
    o=s.option(form.Value,'password',_('Password')); o.password=true;
    o=s.option(form.ListValue,'transport',_('Transport')); o.value('TCP'); o.value('UDP');

    s=m.section(form.NamedSection,'user','policy',_('Custom rules'));
    s.anonymous=true; s.addremove=false;
    s.tab('routed',_('Routed (via tunnel)'));
    s.tab('excluded',_('Excluded (direct)'));
    o=s.taboption('routed',form.DynamicList,'domain',_('Domain')); o.placeholder='example.com';
    o=s.taboption('routed',form.DynamicList,'subnet',_('Subnet (CIDR)')); o.datatype='cidr4'; o.placeholder='203.0.113.0/24';
    o=s.taboption('excluded',form.DynamicList,'exclude_domain',_('Domain (always direct)')); o.placeholder='sberbank.ru';
    o=s.taboption('excluded',form.DynamicList,'exclude_subnet',_('Subnet (always direct)')); o.datatype='cidr4'; o.placeholder='192.168.0.0/16';

    return m.render().then(function(formNode){
      var out=E('div',{'class':'mk-out'});

      // ── status section ──
      self._v={ service:E('span',{},'—'), tunnel:E('span',{},'—'),
                server:E('span',{},'—'), subnets:E('span',{},'—') };
      var statusSection=E('div',{'class':'cbi-section'},[
        E('h3',{},_('Status')),
        E('table',{'class':'table mk-st'},[
          self.row(_('Service'), self._v.service),
          self.row(_('Tunnel'), self._v.tunnel),
          self.row(_('Active server'), self._v.server),
          self.row(_('Routed subnets'), self._v.subnets)
        ]),
        E('div',{'class':'mk-act'},[
          self.mkBtn('start','cbi-button-positive',_('Start'),   function(){ return self.exec(['start']); }, out),
          self.mkBtn('stop','cbi-button-negative',_('Stop'),     function(){ return self.exec(['stop']); }, out),
          self.mkBtn('restart','cbi-button-neutral',_('Restart'),function(){ return self.exec(['restart']); }, out),
          self.mkBtn('test','cbi-button-action',_('Test'),       function(){
            return self.exec(['test']).then(function(t){
              var mm=(t||'').match(/exit IP:\s*([0-9a-fA-F:.]+)/);
              if(mm){ self._v.server.textContent=self._v.server.textContent+'  ['+mm[1]+']'; }
              return t;
            });
          }, out),
          self.mkBtn('update','cbi-button-action',_('Update lists'), function(){ return self.exec(['update']); }, out)
        ]),
        out
      ]);

      // ── traffic chart section ──
      self._now=E('div',{'class':'mk-now'},'—');
      self._svg=E('div',{});
      var chartSection=E('div',{'class':'cbi-section'},[
        E('h3',{},_('Tunnel traffic')),
        self._now, self._svg,
        E('div',{style:'font-size:11px;opacity:.7;margin-top:4px'},
          _('Solid line = download, dashed = upload'))
      ]);

      // ── quality section (ping / speedtest) ──
      self._q={ srtt:E('span',{},'—'), trtt:E('span',{},'—'), down:E('span',{},'—'), up:E('span',{},'—') };
      var qualSection=E('div',{'class':'cbi-section'},[
        E('h3',{},_('Quality')),
        E('table',{'class':'table mk-st'},[
          self.row(_('Server ping (ms)'), self._q.srtt),
          self.row(_('Tunnel ping (ms)'), self._q.trtt),
          self.row(_('Download (Mbps)'), self._q.down),
          self.row(_('Upload (Mbps)'), self._q.up)
        ]),
        E('div',{'class':'mk-act'},[
          self.mkBtn('ping','cbi-button-action',_('Ping'), function(){
            return self.exec(['ping']).then(function(t){
              var p=self.parse(t);
              self._q.srtt.textContent=p.server_rtt_ms||'—';
              self._q.trtt.textContent=p.tunnel_rtt_ms||'—';
              return null;
            });
          }),
          self.mkBtn('speed','cbi-button-action',_('Speed test'), function(){
            self._q.down.textContent='…'; self._q.up.textContent='…';
            return self.exec(['speedtest']).then(function(t){
              var p=self.parse(t);
              self._q.down.textContent=p.down_mbps||'0';
              self._q.up.textContent=p.up_mbps||'0';
              return null;
            });
          })
        ])
      ]);

      var page=E('div',{},[
        E('style',{},CSS),
        statusSection,
        chartSection,
        qualSection,
        formNode
      ]);

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
