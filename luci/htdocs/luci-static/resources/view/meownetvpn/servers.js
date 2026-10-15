'use strict';
'require view';
'require form';
'require uci';
'require ui';
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
      _('Активный выбирается выше. «Через сервер» — реальная задержка, проверяется кнопкой «Проверить серверы» ниже.'));
    s.addremove=true; s.anonymous=true; s.sortable=false;
    s.option(form.Value,'label',_('Метка'));
    s.option(form.Value,'address',_('Адрес')).datatype='host';
    s.option(form.Value,'port',_('Порт')).datatype='port';
    o=s.option(form.DummyValue,'_rt',_('Через сервер, мс'));
    o.cfgvalue=function(sid){ return self.utCell(sid); };
    o=s.option(form.DummyValue,'_ping',_('До входа, мс'));
    o.cfgvalue=function(sid){ var ms=self.pingMap[sid]; return (ms&&ms!=='—')?ms:'—'; };
    o=s.option(form.Value,'uuid',_('UUID')); o.modalonly=true;
    o=s.option(form.ListValue,'network',_('Транспорт'));
    o.value('xhttp','XHTTP'); o.value('ws','WebSocket'); o.value('grpc','gRPC');
    o.value('httpupgrade','HTTPUpgrade'); o.value('tcp','TCP');
    o.default='xhttp'; o.modalonly=true;
    o=s.option(form.ListValue,'security',_('Шифрование'));
    o.value('tls','TLS'); o.value('none',_('нет'));
    o.default='tls'; o.modalonly=true;
    o=s.option(form.Value,'sni',_('SNI'));
    o.placeholder=_('по умолчанию — адрес сервера'); o.modalonly=true;
    o=s.option(form.Value,'path',_('Путь')); o.placeholder='/'; o.modalonly=true;
    o=s.option(form.Value,'host',_('Заголовок Host'));
    o.placeholder=_('по умолчанию — SNI'); o.modalonly=true;
    o=s.option(form.ListValue,'xmode',_('Режим XHTTP'));
    o.value('auto','auto'); o.value('packet-up','packet-up');
    o.value('stream-up','stream-up'); o.value('stream-one','stream-one');
    o.default='auto'; o.modalonly=true; o.depends('network','xhttp');
    o=s.option(form.ListValue,'fingerprint',_('Отпечаток TLS'));
    ['chrome','firefox','safari','ios','android','edge','random'].forEach(function(f){ o.value(f,f); });
    o.default='chrome'; o.modalonly=true; o.depends('security','tls');
    o=s.option(form.Value,'alpn',_('ALPN'));
    o.placeholder='h2,http/1.1'; o.modalonly=true; o.depends('security','tls');
    o=s.option(form.Value,'flow',_('Flow'));
    o.placeholder=_('пусто для XHTTP'); o.modalonly=true;
    // Handed out by the panel as a JSON blob (xPaddingBytes and the like) and
    // passed to Xray verbatim. Read-only here on purpose: it is not a field to
    // compose by hand, and a malformed object is silently dropped by the config
    // writer rather than breaking the tunnel.
    o=s.option(form.Value,'extra',_('Доп. параметры транспорта'));
    o.placeholder='{"xPaddingBytes":"100-1000"}'; o.modalonly=true;

    return m.render().then(function(formNode){
      var out=E('div',{'class':'mk-out'});

      // ---- server cards: what each server is, how fast it really is, one click to
      // make it active — instead of a dropdown + «Сохранить и применить» far below
      var act=uci.get('meownetvpn','settings','active_server');
      var cards=E('div',{'class':'mk-srvs'});
      self.paintCards=function(){
        cards.innerHTML='';
        var list=uci.sections('meownetvpn','server').slice();
        list.sort(function(a,b){ return (b['.name']===act)-(a['.name']===act); });
        list.forEach(function(sv){
          var sid=sv['.name'], on=(sid===act);
          var a=E('div',{'class':'mk-srv-a'});
          if(on) a.appendChild(E('span',{'class':'mk-badge ok'},_('● активный')));
          else a.appendChild(E('button',{'class':'cbi-button cbi-button-action',
            click: ui.createHandlerFn(self,function(){
              if(!confirm(_('Переключиться на «%s»? Соединения через VPN оборвутся на несколько секунд.').format(sv.label||sid)))
                return Promise.resolve();
              return self.run(['server','use',sid]).then(function(){ return self.run(['restart']); })
                .then(function(){ location.reload(); });
            })}, _('Сделать активным')));
          cards.appendChild(E('div',{'class':'mk-srv'+(on?' active':'')},[
            E('div',{'class':'mk-srv-h'},[ E('b',{},[sv.label||sid]) ]),
            E('div',{'class':'mk-srv-m'},[ (self.utMeta.state==='running' && self.utMap[sid]==null)
              ? E('span',{'class':'mk-pill'},_('через сервер: проверяю…'))
              : self.latPill(self.utMap[sid],'rt',_('через сервер '),self.utFailed(sid)) ]),
            E('div',{'class':'mk-srv-m'},[ self.latPill(self.pingMap[sid],'net',_('до входа ')),
              E('small',{},[(sv.address||'')]) ]),
            a
          ]));
        });
        if(!cards.children.length) cards.appendChild(E('div',{'class':'mk-hint'},_('Серверов нет — импортируйте подписку ниже.')));
      };
      self.paintCards();

      var utState=E('div',{'class':'mk-hint'},self.utText());
      var serverSection=self.panel(_('Серверы'), null, [
        utState,
        cards,
        E('div',{'class':'mk-act'},[
          // the real path, one server at a time, with progress: the old ICMP button
          // finished silently after ~15 s and measured the shared entry, so nobody
          // could tell whether — or what — it had updated
          self.mkBtn('urltest','cbi-button-action',_('Проверить серверы'), function(){
            return self.run(['urltest','start']).then(function(){ return self.pollUrltest(utState); });
          }),
          self.mkBtn('pingall','cbi-button',_('Пинг до входа'), function(){
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
        style:'flex:1;min-width:260px',placeholder:'https://…/sub/…',
        value: uci.get('meownetvpn','settings','sub_url')||''});
      var subOut=E('div',{'class':'mk-out'});
      var subSection=self.panel(_('Подписка'),
        _('Ссылка на подписку: Clash YAML или список vless:// (в том числе base64). «Импортировать» обновит список серверов; ссылка запоминается, авто-обновление — в «Настройках».'), [
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

      var page=E('div',{'class':'mk-page'},[ E('style',{},self.CSS), self.brandBar(_('серверы')),
        serverSection, subSection,
        E('h3',{style:'margin:18px 2px 6px'},_('Ручная настройка')),
        E('div',{'class':'mk-hint',style:'margin:0 2px 8px'},_('Выбор активного сервера списком, авто-переключение и правка параметров серверов.')),
        formNode ]);
      setTimeout(function(){ self.colorPings(); }, 400);
      setTimeout(function(){ self.colorPings(); }, 1500);
      // a run started elsewhere (another tab, the CLI) is still in progress: follow it
      if(self.utMeta.state==='running') self.pollUrltest(utState);
      return page;
    });
  }
});
