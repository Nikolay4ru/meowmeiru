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
`;
var RX_COL='#16a34a', TX_COL='#2563eb';

function fmtRate(bps){
  bps = bps || 0;
  if (bps >= 1048576) return (bps/1048576).toFixed(1)+' МБ/с';
  if (bps >= 1024)    return (bps/1024).toFixed(0)+' КБ/с';
  return bps+' Б/с';
}

return view.extend({
  buf: [],
  MAXPTS: 90,

  pingMap: {},
  load: function(){
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
  // append cached latency to a server label for the dropdowns
  srvLabel: function(sec, base){
    var ms=this.pingMap[sec];
    return base + (ms && ms!=='—' ? ' · '+ms+'ms' : '');
  },

  parse: function(t){ var o={}; (t||'').split('\n').forEach(function(l){
    var i=l.indexOf(':'); if(i>0) o[l.slice(0,i).trim()]=l.slice(i+1).trim(); }); return o; },

  exec: function(args){ return fs.exec('/usr/bin/mierukop', args)
    .then(function(r){ return (r.stdout||'')+(r.stderr||''); }).catch(function(){ return ''; }); },

  // ── traffic chart, LuCI realtime-graph style: grid + two filled series ──
  drawChart: function(){
    var b=this.buf, W=600, H=130, pad=6;
    var max=1; b.forEach(function(p){ if(p.rx>max)max=p.rx; if(p.tx>max)max=p.tx; });
    // round the scale up to a "nice" value for the peak label
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
    // horizontal grid (LuCI graphs draw a few scale lines)
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

  refreshStatus: function(){
    var self=this;
    return this.exec(['status']).then(function(out){
      var s=self.parse(out);
      var svc=(s.service==='running'), mieru=(s.mieru==='up'), tun=(s.tun2socks==='up');
      var connected=svc&&mieru&&tun;
      var set=function(node,cls,txt){ node.className=cls; node.textContent=txt; };
      set(self._v.service, svc?'mk-up':'mk-down', svc?_('работает'):_('остановлен'));
      set(self._v.tunnel, connected?'mk-up':(mieru?'mk-warn':'mk-down'),
          connected?_('подключён'):(mieru?_('только mieru'):_('недоступен')));
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
    s.tab('conn',_('Подключение'));
    s.tab('lists',_('Маршрутизация'));
    s.tab('adv',_('Дополнительно'));

    o=s.taboption('conn',form.Flag,'enabled',_('Включено')); o.rmempty=false;
    o=s.taboption('conn',form.ListValue,'active_server',_('Активный сервер'),
      _('Какой сервер ниже пропускает трафик. Учётные данные задаются в разделе «Серверы».'));
    uci.sections('mierukop','server').forEach(function(sv){
      o.value(sv['.name'], self.srvLabel(sv['.name'], (sv.label||sv['.name'])+' — '+(sv.address||'')));
    });
    o=s.taboption('conn',form.Flag,'failover',_('Авто-переключение'),
      _('Автоматически переключаться на следующий сервер, если активный перестаёт пропускать трафик.'));

    o=s.taboption('lists',form.MultiValue,'community_lists',_('Списки сообщества'),
      _('Сервисы, маршрутизируемые через туннель (itdoginfo/allow-domains). После изменения нажмите «Обновить списки».'));
    o.display_size=16;
    ['telegram','meta','twitter','discord','roblox','cloudflare','hetzner','digitalocean',
     'youtube','tiktok','google_ai','google_play','hdrezka',
     'russia_inside','russia_outside','anime','news','porn','geoblock','block'].forEach(function(n){ o.value(n,n); });
    o.rmempty=true;
    o=s.taboption('lists',form.Value,'routed_dns',_('DNS для маршрутизируемых доменов'),
      _('Реальный DNS для разрешения маршрутизируемых доменов (идёт через туннель, в обход DPI/fake-IP).'));
    o.datatype='ipaddr'; o.placeholder='8.8.8.8'; o.optional=true;

    o=s.taboption('adv',form.Flag,'watchdog',_('Сторож (watchdog)'),
      _('Автоперезапуск туннеля, если он перестал пропускать трафик (проверка каждые 5 мин).'));
    o=s.taboption('adv',form.Flag,'killswitch',_('Блокировка утечки (kill-switch)'),
      _('Отбрасывать маршрутизируемый трафик, если туннель недоступен, вместо утечки напрямую.'));
    o=s.taboption('adv',form.Flag,'dns_hijack',_('Принудительный DNS роутера'),
      _('Перенаправлять DNS клиентов на роутер, чтобы доменная маршрутизация работала для всех устройств.'));
    o=s.taboption('adv',form.Value,'update_interval',_('Обновление списков (часы)'));
    o.datatype='uinteger'; o.placeholder='24';
    o=s.taboption('adv',form.Value,'socks_port',_('Локальный порт SOCKS5')); o.datatype='port'; o.optional=true;
    o=s.taboption('adv',form.Value,'tun_name',_('Интерфейс туннеля')); o.optional=true; o.placeholder='mtun0';

    s=m.section(form.GridSection,'server',_('Серверы'),
      _('Добавьте несколько для авто-переключения. Активный выбирается во вкладке «Подключение». Пинг обновляется кнопкой «Пинг серверов» и раз в 10 мин.'));
    s.addremove=true; s.anonymous=false; s.sortable=false;
    s.option(form.Value,'label',_('Метка'));
    s.option(form.Value,'address',_('Адрес')).datatype='host';
    s.option(form.Value,'port',_('Порт')).datatype='port';
    // live latency column (from the cached pingall)
    o=s.option(form.DummyValue,'_ping',_('Пинг, мс'));
    o.cfgvalue=function(sid){ var ms=self.pingMap[sid]; return (ms&&ms!=='—')?ms:'—'; };
    // credentials: editable in the modal, hidden from the always-visible table
    o=s.option(form.Value,'username',_('Пользователь')); o.modalonly=true;
    o=s.option(form.Value,'password',_('Пароль')); o.password=true; o.modalonly=true;
    o=s.option(form.ListValue,'transport',_('Транспорт')); o.value('TCP'); o.value('UDP');

    // ── routing groups: send specific lists through a specific server ──
    var LISTS=['telegram','meta','twitter','discord','roblox','cloudflare','hetzner','digitalocean',
      'youtube','tiktok','google_ai','google_play','hdrezka','russia_inside','russia_outside',
      'anime','news','porn','geoblock','block'];
    s=m.section(form.GridSection,'group',_('Группы маршрутизации'),
      _('Направить конкретные списки через конкретный сервер (напр. YouTube → один сервер, Meta → другой). Что не в группе — идёт через активный сервер. После изменения: «Обновить списки».'));
    s.addremove=true; s.anonymous=false; s.nodescriptions=true;
    o=s.option(form.Flag,'enabled',_('Вкл')); o.default='1'; o.editable=true;
    s.option(form.Value,'label',_('Название'));
    o=s.option(form.ListValue,'server',_('Сервер'));
    uci.sections('mierukop','server').forEach(function(sv){
      o.value(sv['.name'], self.srvLabel(sv['.name'], (sv.label||sv['.name'])));
    });
    o=s.option(form.MultiValue,'community_lists',_('Списки')); o.display_size=10;
    LISTS.forEach(function(n){ o.value(n,n); });

    s=m.section(form.NamedSection,'user','policy',_('Свои правила'));
    s.anonymous=true; s.addremove=false;
    s.tab('routed',_('Через туннель'));
    s.tab('excluded',_('Исключения (напрямую)'));
    o=s.taboption('routed',form.DynamicList,'domain',_('Домен')); o.placeholder='example.com';
    o=s.taboption('routed',form.DynamicList,'subnet',_('Подсеть (CIDR)')); o.datatype='cidr4'; o.placeholder='203.0.113.0/24';
    o=s.taboption('excluded',form.DynamicList,'exclude_domain',_('Домен (всегда напрямую)')); o.placeholder='sberbank.ru';
    o=s.taboption('excluded',form.DynamicList,'exclude_subnet',_('Подсеть (всегда напрямую)')); o.datatype='cidr4'; o.placeholder='192.168.0.0/16';

    return m.render().then(function(formNode){
      var out=E('div',{'class':'mk-out'});

      // ── status section ──
      self._v={ service:E('span',{},'—'), tunnel:E('span',{},'—'),
                server:E('span',{},'—'), subnets:E('span',{},'—') };
      var statusSection=E('div',{'class':'cbi-section'},[
        E('h3',{},_('Состояние')),
        E('table',{'class':'table mk-st'},[
          self.row(_('Служба'), self._v.service),
          self.row(_('Туннель'), self._v.tunnel),
          self.row(_('Активный сервер'), self._v.server),
          self.row(_('Маршрутизируется подсетей'), self._v.subnets)
        ]),
        E('div',{'class':'mk-act'},[
          self.mkBtn('start','cbi-button-positive',_('Запустить'),   function(){ return self.exec(['start']); }, out),
          self.mkBtn('stop','cbi-button-negative',_('Остановить'),   function(){ return self.exec(['stop']); }, out),
          self.mkBtn('restart','cbi-button-neutral',_('Перезапуск'), function(){ return self.exec(['restart']); }, out),
          self.mkBtn('test','cbi-button-action',_('Проверка'),       function(){
            return self.exec(['test']).then(function(t){
              var mm=(t||'').match(/exit IP:\s*([0-9a-fA-F:.]+)/);
              if(mm){ self._v.server.textContent=self._v.server.textContent+'  ['+mm[1]+']'; }
              return t;
            });
          }, out),
          self.mkBtn('update','cbi-button-action',_('Обновить списки'), function(){ return self.exec(['update']); }, out)
        ]),
        out
      ]);

      // ── traffic chart section ──
      self._svg=E('div',{});
      self._leg=E('div',{'class':'mk-leg'});
      var chartSection=E('div',{'class':'cbi-section'},[
        E('h3',{},_('Трафик туннеля')),
        self._svg, self._leg
      ]);

      // ── quality section (ping / speedtest) ──
      self._q={ srtt:E('span',{},'—'), trtt:E('span',{},'—'), down:E('span',{},'—'), up:E('span',{},'—') };
      var qualSection=E('div',{'class':'cbi-section'},[
        E('h3',{},_('Качество связи')),
        E('table',{'class':'table mk-st'},[
          self.row(_('Пинг до сервера (мс)'), self._q.srtt),
          self.row(_('Пинг через туннель (мс)'), self._q.trtt),
          self.row(_('Загрузка (Мбит/с)'), self._q.down),
          self.row(_('Отдача (Мбит/с)'), self._q.up)
        ]),
        E('div',{'class':'mk-act'},[
          self.mkBtn('ping','cbi-button-action',_('Пинг'), function(){
            return self.exec(['ping']).then(function(t){
              var p=self.parse(t);
              self._q.srtt.textContent=p.server_rtt_ms||'—';
              self._q.trtt.textContent=p.tunnel_rtt_ms||'—';
              return null;
            });
          }),
          self.mkBtn('speed','cbi-button-action',_('Тест скорости'), function(){
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

      // ── refresh latency: re-ping all servers and reload so the Servers table
      //    column + the server dropdowns all show fresh values (single source). ──
      var serverSection=E('div',{'class':'cbi-section'},[
        E('h3',{},_('Задержка серверов')),
        E('div',{style:'font-size:12px;opacity:.75;margin-bottom:8px'},
          _('Пинг (мс) показан в колонке «Пинг» таблицы «Серверы» ниже и в списках выбора сервера. Нажми, чтобы перемерить.')),
        E('div',{'class':'mk-act'},[
          self.mkBtn('pingall','cbi-button-action',_('Обновить пинг серверов'), function(){
            return self.exec(['pingall']).then(function(){
              setTimeout(function(){ location.reload(); }, 700); return null;
            });
          })
        ])
      ]);

      // ── subscription import (paste a clash sub URL → add all mieru servers) ──
      var subInput=E('input',{type:'text','class':'cbi-input-text',
        style:'flex:1;min-width:260px',placeholder:'https://…/sub/…?format=clash'});
      var subSection=E('div',{'class':'cbi-section'},[
        E('h3',{},_('Подписка')),
        E('div',{style:'font-size:12px;opacity:.75;margin-bottom:8px'},
          _('Вставь ссылку на подписку (формат clash) — импортирую все mieru-серверы, применю и обновлю списки.')),
        E('div',{'class':'mk-act'},[
          subInput,
          self.mkBtn('subimport','cbi-button-action',_('Импортировать'), function(){
            var url=(subInput.value||'').trim();
            if(!url) return Promise.resolve(_('Укажи ссылку на подписку.'));
            return self.exec(['sub',url]).then(function(t){
              return self.exec(['restart']).then(function(){
                return self.exec(['update']).then(function(u){
                  setTimeout(function(){ location.reload(); }, 2000);
                  return (t||'')+'\n'+(u||'')+'\n'+_('Готово, обновляю страницу…');
                });
              });
            });
          }, out)
        ])
      ]);

      var brand=E('div',{style:'display:flex;align-items:baseline;gap:10px;margin:2px 2px 10px'},[
        E('h2',{style:'margin:0;font-weight:700;letter-spacing:-.01em'},'meowMieru'),
        E('span',{style:'font-size:12px;opacity:.6'},_('маршрутизация через mieru'))
      ]);

      var page=E('div',{},[
        E('style',{},CSS),
        brand,
        statusSection,
        chartSection,
        qualSection,
        serverSection,
        subSection,
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
