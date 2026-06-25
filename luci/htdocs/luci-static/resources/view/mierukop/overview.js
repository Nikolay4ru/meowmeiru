'use strict';
'require view';
'require uci';
'require poll';
'require mierukop.lib as lib';

return lib.page({
  load: function(){ return this.loadBase(); },

  render: function(){
    var self=this;

    self._v={ service:E('span',{},'—'), tunnel:E('span',{},'—'),
              server:E('span',{},'—'), subnets:E('span',{},'—') };
    var out=E('div',{'class':'mk-out'});

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

    // per-tunnel status cards
    self._tuns=E('div',{'class':'mk-cards'});
    var tunnelsSection=E('div',{'class':'cbi-section'},[
      E('h3',{},_('Туннели')),
      E('div',{'class':'mk-hint'},_('Внешний IP каждого туннеля (по умолчанию + группы).')),
      self._tuns,
      E('div',{'class':'mk-act'},[
        self.mkBtn('tunref','cbi-button-action',_('Обновить'), function(){ return self.loadTunnels(); })
      ])
    ]);

    // traffic chart + latency sparkline
    self._svg=E('div',{}); self._leg=E('div',{'class':'mk-leg'});
    self._pingsvg=E('div',{style:'margin-top:14px'});
    var chartSection=E('div',{'class':'cbi-section'},[
      E('h3',{},_('Трафик туннеля')),
      self._svg, self._leg,
      E('div',{style:'font-size:12px;opacity:.6;margin:14px 0 2px'},_('Задержка активного сервера (история)')),
      self._pingsvg
    ]);

    // quality (ping / speedtest)
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
            var p=self.parse(t), sv=p.server_rtt_ms||'—', tv=p.tunnel_rtt_ms||'—';
            self._q.srtt.textContent=sv; self._q.srtt.className=self.pingClass(sv,'net');
            self._q.trtt.textContent=tv; self._q.trtt.className=self.pingClass(tv,'tun');
            return null;
          });
        }),
        self.mkBtn('speed','cbi-button-action',_('Тест скорости'), function(){
          self._q.down.textContent='…'; self._q.up.textContent='…';
          return self.exec(['speedtest']).then(function(t){
            var p=self.parse(t), sc=function(v){ v=parseFloat(v); return v>=20?'mk-up':(v>=5?'mk-warn':'mk-down'); };
            self._q.down.textContent=p.down_mbps||'0'; self._q.down.className=sc(p.down_mbps);
            self._q.up.textContent=p.up_mbps||'n/a'; self._q.up.className=sc(p.up_mbps);
            return null;
          });
        })
      ])
    ]);

    var page=E('div',{},[
      E('style',{},self.CSS),
      self.brandBar(),
      statusSection,
      tunnelsSection,
      chartSection,
      qualSection
    ]);

    // seed the active server's cached ping
    var _act=uci.get('mierukop','settings','active_server'), _am=_act&&self.pingMap[_act];
    if(_am && _am!=='—'){ self._q.srtt.textContent=_am; self._q.srtt.className=self.pingClass(_am,'net'); }

    self.drawChart();
    self.exec(['history']).then(function(csv){
      (csv||'').trim().split('\n').forEach(function(l){
        var f=l.split(','); if(f.length>=3) self.buf.push({rx:+f[1]||0, tx:+f[2]||0});
      });
      if(self.buf.length>self.MAXPTS) self.buf=self.buf.slice(-self.MAXPTS);
      self.drawChart();
    });

    self.refreshStatus(); self.loadTunnels(); self.drawPingChart();
    poll.add(function(){ return self.refreshStatus(); }, 5);
    poll.add(function(){ self.drawPingChart();
      return self.exec(['stats']).then(function(t){
        var p=self.parse(t); self.pushSample(p.rx_rate, p.tx_rate);
      });
    }, 3);

    return page;
  },

  handleSaveApply:null, handleSave:null, handleReset:null
});
