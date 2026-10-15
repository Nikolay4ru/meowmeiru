'use strict';
'require view';
'require uci';
'require poll';
'require meownetvpn.lib as lib';

return lib.page({
  load: function(){ return this.loadBase(); },

  render: function(){
    var self=this;
    var out=E('div',{'class':'mk-out'});

    // ---- hero: the four answers people open this page for — is it on, through
    // which server, with which exit IP, how fast — instead of rows spread over
    // five sections. Repainted by the 5 s ui-status tick (lib.paintHero).
    var h=self._hero={
      state:E('div',{'class':'mk-state'}), stateTxt:E('span',{},'…'),
      server:E('b',{},'—'), exit:E('b',{},'…'), lat:E('span',{},'—'),
      subnets:E('b',{},'—'), rx:E('b',{},'—'), tx:E('b',{},'—')
    };
    h.state.appendChild(E('i')); h.state.appendChild(h.stateTxt);
    var act=uci.get('meownetvpn','settings','active_server');
    var lists=uci.get('meownetvpn','settings','community_lists')||[];
    if(!Array.isArray(lists)) lists=String(lists).split(/\s+/).filter(Boolean);
    var setLat=function(ms, note){
      h.lat.innerHTML=''; h.lat.appendChild(self.latPill(ms,'rt'));
      if(note) h.lat.appendChild(E('small',{style:'opacity:.55;margin-left:6px'},[note]));
    };
    if(act && self.utMap[act] && self.utMap[act]!=='—') setLat(self.utMap[act], _('по последней проверке'));

    var kpi=function(label, node){ return E('div',{'class':'mk-kpi'},[E('span',{},label), node]); };
    var heroPanel=self.panel(_('Состояние'), null, [
      E('div',{'class':'mk-hero'},[
        E('div',{'class':'mk-hero-main'},[
          h.state,
          E('div',{'class':'mk-kv'},[
            E('span',{},_('Сервер')),    h.server,
            E('span',{},_('IP выхода')), h.exit,
            E('span',{},_('Задержка')),  h.lat
          ]),
          E('div',{'class':'mk-act'},[
            self.mkBtn('test','cbi-button-action',_('Проверить связь'), function(){
              return self.exec(['test']).then(function(t){
                var mm=(t||'').match(/exit IP:\s*([0-9a-fA-F:.]+)/);
                if(mm) h.exit.textContent=mm[1];
                return self.exec(['ping']).then(function(p){
                  var tv=self.parse(p).tunnel_rtt_ms; if(tv) setLat(tv, _('только что'));
                  return t;
                });
              });
            }, out),
            self.mkBtn('restart','cbi-button-neutral',_('Перезапустить'), function(){
              if(!confirm(_('Перезапуск на несколько секунд оборвёт соединения через VPN у всех устройств. Продолжить?')))
                return Promise.resolve(null);
              return self.exec(['restart']);
            }, out),
            self.mkBtn('update','cbi-button-action',_('Обновить списки'), function(){ return self.exec(['update']); }, out),
            self.mkBtn('start','cbi-button-positive',_('Запустить'), function(){ return self.exec(['start']); }, out),
            self.mkBtn('stop','cbi-button-negative',_('Остановить'), function(){
              if(!confirm(_('Остановить VPN? Весь трафик пойдёт напрямую.'))) return Promise.resolve(null);
              return self.exec(['stop']);
            }, out)
          ])
        ]),
        E('div',{'class':'mk-kpis'},[
          kpi(_('↓ Загрузка сейчас'), h.rx),
          kpi(_('↑ Отдача сейчас'),   h.tx),
          kpi(_('Подсетей в туннеле'), h.subnets),
          kpi(_('Списков включено'),  E('b',{},[String(lists.length)]))
        ])
      ]),
      out
    ]);

    // ---- health checks, one row per check (the worst drives the header badge)
    self._checks=E('div',{'class':'mk-checks'});
    var checksPanel=self.panel(_('Проверки'),
      _('Каждый туннель проверяется отдельно; если что-то не так — рядом появится кнопка «Исправить».'),
      [self._checks]);

    // ---- quick routing changes, applied without restarting the tunnels
    var qaIn=E('input',{type:'text','class':'cbi-input-text',
      placeholder:_('например youtube.com или ссылка целиком')});
    var qaOut=E('div',{'class':'mk-out'});
    var qa=function(cmd){
      var v=(qaIn.value||'').trim();
      if(!v) return Promise.resolve(_('Укажите сайт.'));
      return self.exec([cmd,v]).then(function(t){
        qaIn.value='';
        return Promise.all([self.hlth(), self.refreshStatus()]).then(function(){ return t; });
      });
    };
    var quickPanel=self.panel(_('Сайт не работает?'),
      _('Отправьте его через VPN или, наоборот, мимо. Применяется сразу, соединения других устройств не рвутся.'),
      [ E('div',{'class':'mk-qa'},[
          qaIn,
          self.mkBtn('qain','cbi-button-positive',_('Через VPN'), function(){ return qa('route-add'); }, qaOut),
          self.mkBtn('qaout','cbi-button-neutral',_('Напрямую'),  function(){ return qa('route-direct'); }, qaOut),
          self.mkBtn('qadel','cbi-button-remove',_('Убрать правило'), function(){ return qa('route-del'); }, qaOut)
        ]),
        qaOut ]);

    // ---- traffic chart + latency history of the active server
    self._svg=E('div',{}); self._leg=E('div',{'class':'mk-leg'});
    self._pingsvg=E('div',{style:'margin-top:6px'});
    var trafficPanel=self.panel(_('Трафик через VPN'), null, [
      self._svg, self._leg,
      E('div',{'class':'mk-hint',style:'margin:14px 0 2px'},_('Пинг до входа активного сервера (история, раз в 10 минут)')),
      self._pingsvg
    ]);

    // ---- per-tunnel cards (default + routing groups)
    self._tuns=E('div',{'class':'mk-cards'});
    var tunnelsPanel=self.panel(_('Туннели'), _('Внешний IP каждого туннеля: основного и групп маршрутизации.'), [
      self._tuns,
      E('div',{'class':'mk-act'},[
        self.mkBtn('tunref','cbi-button-action',_('Обновить'), function(){ return self.loadTunnels(true); })
      ])
    ]);

    // ---- quality: ping + speed test
    self._q={ srtt:E('b',{},'—'), trtt:E('b',{},'—'), down:E('b',{},'—'), up:E('b',{},'—') };
    var qualPanel=self.panel(_('Качество связи'),
      _('«До входа» — пинг до первого сервера цепочки; «через VPN» — запрос в интернет по всему пути.'), [
      E('div',{'class':'mk-kpis'},[
        kpi(_('Пинг до входа, мс'),  self._q.srtt),
        kpi(_('Через VPN, мс'),      self._q.trtt),
        kpi(_('Загрузка, Мбит/с'),   self._q.down),
        kpi(_('Отдача, Мбит/с'),     self._q.up)
      ]),
      E('div',{'class':'mk-act'},[
        self.mkBtn('ping','cbi-button-action',_('Пинг'), function(){
          return self.exec(['ping']).then(function(t){
            var p=self.parse(t), sv=p.server_rtt_ms||'—', tv=p.tunnel_rtt_ms||'—';
            self._q.srtt.textContent=sv; self._q.srtt.className=self.pingClass(sv,'net');
            self._q.trtt.textContent=tv; self._q.trtt.className=self.pingClass(tv,'tun');
            if(tv!=='—') setLat(tv, _('только что'));
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

    var page=E('div',{'class':'mk-page'},[
      E('style',{},self.CSS),
      self.brandBar(_('обзор')),
      heroPanel, checksPanel, quickPanel, trafficPanel, tunnelsPanel, qualPanel
    ]);

    // seed the cached ICMP ping of the active server
    var am=act&&self.pingMap[act];
    if(am && am!=='—'){ self._q.srtt.textContent=am; self._q.srtt.className=self.pingClass(am,'net'); }

    self.drawChart();
    self.exec(['history']).then(function(csv){
      (csv||'').trim().split('\n').forEach(function(l){
        var f=l.split(','); if(f.length>=3) self.buf.push({rx:+f[1]||0, tx:+f[2]||0});
      });
      if(self.buf.length>self.MAXPTS) self.buf=self.buf.slice(-self.MAXPTS);
      self.drawChart();
    });

    // see diagnostics.js: a cached lib.js must not blank the page
    self.hlth=function(){
      if(typeof self.loadHealth==='function') return self.loadHealth();
      self._checks.innerHTML='<div class="mk-hint">'+
        _('Обновите страницу с очисткой кэша (Ctrl+F5 / Cmd+Shift+R) — браузер держит старую версию интерфейса.')+'</div>';
      return Promise.resolve();
    };
    self.refreshStatus(); self.hlth(); self.loadTunnels(); self.drawPingChart();
    // no cached measurement for the active server: take one now (≈3 s, in the background)
    if(!(act && self.utMap[act] && self.utMap[act]!=='—'))
      self.exec(['ping']).then(function(p){ var tv=self.parse(p).tunnel_rtt_ms; if(tv) setLat(tv, _('только что')); });
    // one combined 5 s poll (ui-status carries the traffic rates too); the ping
    // history only gains a point per pingall run
    poll.add(function(){
      return self.refreshStatus().then(function(s){
        if(s && s.rx_rate!=null) self.pushSample(s.rx_rate, s.tx_rate);
      });
    }, 5);
    poll.add(function(){ return self.drawPingChart(); }, 60);
    // health probes each tunnel over its SOCKS port — too heavy for the 5 s tick
    poll.add(function(){ return self.hlth(); }, 30);

    return page;
  },

  handleSaveApply:null, handleSave:null, handleReset:null
});
