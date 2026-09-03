'use strict';
'require view';
'require form';
'require uci';
'require meownetvpn.lib as lib';

return lib.page({
  load: function(){ return this.loadBase(); },

  render: function(){
    var self=this, m, s, o;

    m=new form.Map('meownetvpn','',_('Активный сервер пропускает весь трафик, не попавший в группу. Добавьте несколько серверов для авто-переключения.'));

    s=m.section(form.NamedSection,'settings','meownetvpn',_('Подключение'));
    s.anonymous=true; s.addremove=false;
    o=s.option(form.Flag,'enabled',_('Включено')); o.rmempty=false;
    o=s.option(form.ListValue,'active_server',_('Активный сервер'),
      _('Какой сервер пропускает трафик. Учётные данные задаются в таблице «Серверы» ниже.'));
    uci.sections('meownetvpn','server').forEach(function(sv){
      o.value(sv['.name'], self.srvLabel(sv['.name'], (sv.label||sv['.name'])));
    });
    o=s.option(form.Flag,'failover',_('Авто-переключение'),
      _('Переключаться на следующий сервер, если активный перестаёт пропускать трафик.'));

    s=m.section(form.GridSection,'server',_('Серверы'),
      _('Активный выбирается выше. Пинг обновляется кнопкой ниже и раз в 10 минут.'));
    s.addremove=true; s.anonymous=true; s.sortable=false;
    s.option(form.Value,'label',_('Метка'));
    o=s.option(form.ListValue,'type',_('Протокол'));
    o.value('mieru','mieru'); o.value('vless','VLESS (Xray)');
    // Absent means mieru: sections written before VLESS existed carry no `type`,
    // and defaulting the other way would relabel a live fleet's servers.
    o.default='mieru';
    s.option(form.Value,'address',_('Адрес')).datatype='host';
    s.option(form.Value,'port',_('Порт')).datatype='port';
    o=s.option(form.DummyValue,'_ping',_('Пинг, мс'));
    o.cfgvalue=function(sid){ var ms=self.pingMap[sid]; return (ms&&ms!=='—')?ms:'—'; };

    // ── mieru ──
    o=s.option(form.Value,'username',_('Пользователь')); o.modalonly=true; o.depends('type','mieru');
    o=s.option(form.Value,'password',_('Пароль')); o.password=true; o.modalonly=true; o.depends('type','mieru');
    o=s.option(form.ListValue,'transport',_('Транспорт')); o.value('TCP'); o.value('UDP');
    o.modalonly=true; o.depends('type','mieru');

    // ── vless ──
    // depends() on an absent `type` never fires, so these stay hidden for every
    // pre-existing mieru section without needing a migration of the config itself.
    o=s.option(form.Value,'uuid',_('UUID')); o.modalonly=true; o.depends('type','vless');
    o=s.option(form.ListValue,'network',_('Транспорт'));
    o.value('xhttp','XHTTP'); o.value('ws','WebSocket'); o.value('grpc','gRPC');
    o.value('httpupgrade','HTTPUpgrade'); o.value('tcp','TCP');
    o.default='xhttp'; o.modalonly=true; o.depends('type','vless');
    o=s.option(form.ListValue,'security',_('Шифрование'));
    o.value('tls','TLS'); o.value('none',_('нет'));
    o.default='tls'; o.modalonly=true; o.depends('type','vless');
    o=s.option(form.Value,'sni',_('SNI'));
    o.placeholder=_('по умолчанию — адрес сервера'); o.modalonly=true; o.depends('type','vless');
    o=s.option(form.Value,'path',_('Путь'));
    o.placeholder='/'; o.modalonly=true; o.depends('type','vless');
    o=s.option(form.Value,'host',_('Заголовок Host'));
    o.placeholder=_('по умолчанию — SNI'); o.modalonly=true; o.depends('type','vless');
    o=s.option(form.ListValue,'xmode',_('Режим XHTTP'));
    o.value('auto','auto'); o.value('packet-up','packet-up');
    o.value('stream-up','stream-up'); o.value('stream-one','stream-one');
    o.default='auto'; o.modalonly=true; o.depends({'type':'vless','network':'xhttp'});
    o=s.option(form.ListValue,'fingerprint',_('Отпечаток TLS'));
    ['chrome','firefox','safari','ios','android','edge','random'].forEach(function(f){ o.value(f,f); });
    o.default='chrome'; o.modalonly=true; o.depends({'type':'vless','security':'tls'});
    o=s.option(form.Value,'flow',_('Flow'));
    o.placeholder=_('пусто для XHTTP'); o.modalonly=true; o.depends('type','vless');

    return m.render().then(function(formNode){
      var out=E('div',{'class':'mk-out'});

      // refresh latency + pick best
      var serverSection=E('div',{'class':'cbi-section'},[
        E('h3',{},_('Задержка серверов')),
        E('div',{'class':'mk-hint'},_('Пинг (мс) показан в колонке «Пинг» выше и в выпадающем списке активного сервера.')),
        E('div',{'class':'mk-act'},[
          self.mkBtn('pingall','cbi-button-action',_('Обновить пинг серверов'), function(){
            // repaint in place: location.reload() cost seconds of white screen on A53
            return self.exec(['pingall']).then(function(){
              return self.loadBase().then(function(){ self.colorPings(); return null; });
            });
          }),
          self.mkBtn('bestsrv','cbi-button-positive',_('Выбрать лучший сейчас'), function(){
            return self.exec(['best-server']).then(function(t){ setTimeout(function(){ location.reload(); }, 1500); return t; });
          }, out)
        ]),
        out
      ]);

      // subscription import
      var subInput=E('input',{type:'text','class':'cbi-input-text',
        style:'flex:1;min-width:260px',placeholder:'https://…/sub/…?format=clash'});
      var subOut=E('div',{'class':'mk-out'});
      var subSection=E('div',{'class':'cbi-section'},[
        E('h3',{},_('Подписка')),
        E('div',{'class':'mk-hint'},_('Вставь ссылку (формат clash) — импортирую все mieru-серверы, применю и обновлю списки. URL запоминается; авто-обновление включается в «Настройках».')),
        E('div',{'class':'mk-act'},[
          subInput,
          self.mkBtn('subimport','cbi-button-action',_('Импортировать'), function(){
            var url=(subInput.value||'').trim();
            if(!url) return Promise.resolve(_('Укажи ссылку на подписку.'));
            // Import rewrites the server list: whatever the subscription no
            // longer offers is deleted together with its username/password.
            // /etc/config/meownetvpn is 0600 and is backed up nowhere, and this
            // used to happen on one click with no question asked.
            var n=(uci.sections('meownetvpn','server')||[]).length;
            if(!confirm(_('Импорт заменит список серверов содержимым подписки (сейчас серверов: %d). Серверы, которых нет в подписке, будут удалены. Продолжить?').format(n)))
              return Promise.resolve(_('Отменено.'));
            return self.run(['sub',url]).then(function(r){
              // `sub` validates the download AND the parse before it touches
              // uci, so a non-zero code means the config was not modified. The
              // code used to be discarded and the page reloaded 2 s later
              // regardless, wiping the only error text — a failed import was
              // indistinguishable from a successful one.
              if(r.code) return r.out+'\n'+_('Импорт не выполнен — серверы не изменены.');
              return self.run(['restart']).then(function(rr){
                return self.run(['update']).then(function(ru){
                  // keep the failing restart's own output: the message below
                  // sends the user to "вывод выше", which has to actually be there
                  var txt=r.out+'\n'+(rr.code?rr.out+'\n':'')+ru.out;
                  if(rr.code||ru.code)
                    return txt+'\n'+_('Серверы импортированы, но применить не удалось — страницу не перезагружаю, разберитесь по выводу выше.');
                  setTimeout(function(){ location.reload(); }, 2000);
                  return txt+'\n'+_('Готово, обновляю страницу…');
                });
              });
            });
          }, subOut)
        ]),
        subOut
      ]);

      var page=E('div',{},[ E('style',{},self.CSS), formNode, serverSection, subSection ]);
      setTimeout(function(){ self.colorPings(); }, 400);
      setTimeout(function(){ self.colorPings(); }, 1500);
      return page;
    });
  }
});
