'use strict';
'require view';
'require form';
'require meownetvpn.lib as lib';

return lib.page({
  load: function(){ return this.loadBase(); },

  render: function(){
    var self=this, m, s, o;

    m=new form.Map('meownetvpn','',_('Дополнительные параметры, автоматизация и обновление модуля.'));

    s=m.section(form.NamedSection,'settings','meownetvpn',_('Поведение'));
    s.anonymous=true; s.addremove=false;
    o=s.option(form.Flag,'enabled',_('Обход включён'),
      _('Главный выключатель. Выключено — туннели гасятся, правила маршрутизации снимаются, ВЕСЬ трафик идёт напрямую. Состояние переживает перезагрузку.'));
    o.rmempty=false;

    o=s.option(form.Flag,'watchdog',_('Сторож (watchdog)'),
      _('Автоперезапуск туннеля, если он перестал пропускать трафик (проверка каждые 5 мин).'));
    o=s.option(form.Flag,'killswitch',_('Блокировка утечки (kill-switch)'),
      _('Отбрасывать маршрутизируемый трафик, если туннель недоступен, вместо утечки напрямую.'));
    o=s.option(form.Flag,'dns_hijack',_('Принудительный DNS роутера'),
      _('Перенаправлять DNS клиентов на роутер, чтобы доменная маршрутизация работала для всех устройств.'));

    s=m.section(form.NamedSection,'settings','meownetvpn',_('Автоматизация'));
    s.anonymous=true; s.addremove=false;
    o=s.option(form.Flag,'auto_best',_('Авто-выбор лучшего сервера'),
      _('Каждые 15 минут измерять пинг и переключаться на самый быстрый сервер.'));
    // Without sub_url the nightly `meownetvpn sub-refresh` exits on its very first
    // line — no error, no journal entry. The URL was written only by the
    // «Импортировать» button on the Servers page and there was nowhere at all to
    // see it, so the switch below sat ON doing nothing and no one could tell.
    o=s.option(form.Value,'sub_url',_('Ссылка на подписку'),
      _('Формат clash. Обычно заполняется кнопкой «Импортировать» на вкладке «Серверы»; без неё авто-обновление невозможно.'));
    o.optional=true; o.placeholder='https://…/sub/…?format=clash';
    o=s.option(form.Flag,'sub_auto',_('Авто-обновление подписки'),
      _('Раз в сутки заново скачивать сохранённую подписку — подтягивает новые серверы и сменившиеся IP.'));
    // only offer the switch once there is something to refresh; retain keeps an
    // already-enabled flag when this page is saved with no URL yet — without it
    // the first save would silently drop sub_auto='1' and auto-refresh would
    // stay off even after a later «Импортировать»
    o.depends('sub_url', /.+/); o.retain=true;
    o=s.option(form.Flag,'auto_update',_('Авто-обновление модуля'),
      _('Раз в неделю проверять GitHub и автоматически ставить новую версию meowMieru.'));
    o=s.option(form.Value,'update_interval',_('Обновление списков (часы)'));
    o.datatype='uinteger'; o.placeholder='24';

    s=m.section(form.NamedSection,'settings','meownetvpn',_('Сеть'));
    s.anonymous=true; s.addremove=false;
    o=s.option(form.Value,'socks_port',_('Локальный порт SOCKS5')); o.datatype='port'; o.optional=true;
    o=s.option(form.Value,'tun_name',_('Интерфейс туннеля')); o.optional=true; o.placeholder='mtun0';

    return m.render().then(function(formNode){
      var out=E('div',{'class':'mk-out'});
      self._verEl=E('b',{},'…'); self._upd=E('span',{style:'margin-left:8px'},'');

      var versionSection=E('div',{'class':'cbi-section'},[
        E('h3',{},_('Версия и обновление')),
        E('div',{'class':'mk-act',style:'align-items:center'},[
          E('span',{},[_('meowMieru '), self._verEl]),
          self.mkBtn('updchk','cbi-button-action',_('Проверить обновление'), function(){
            self._upd.innerHTML=' '+_('проверяю…');
            return self.exec(['update-check']).then(function(t){
              var p=self.parse(t);
              // p.latest is whatever the remote VERSION file contained — same
              // innerHTML sink as the tunnel cards, so build the node instead
              var say=function(cls,txt){
                self._upd.innerHTML=''; self._upd.appendChild(document.createTextNode(' '));
                self._upd.appendChild(E('b',{'class':cls},[txt]));
              };
              if(p.status==='update-available') say('mk-warn',_('доступно: ')+(p.latest||''));
              else if(p.status==='up-to-date') say('mk-up',_('актуальная версия'));
              else say('mk-down',_('GitHub недоступен'));
              return null;
            });
          }),
          self.mkBtn('updinst','cbi-button-positive',_('Обновить сейчас'), function(){
            self._upd.innerHTML=' '+_('обновляю через туннель…');
            return self.exec(['self-update']).then(function(t){ setTimeout(function(){ location.reload(); }, 2500); return t; });
          }, out),
          self._upd
        ]),
        out
      ]);

      self.exec(['version']).then(function(v){ self._verEl.textContent='v'+((v||'').trim()||'?'); });
      return E('div',{},[ E('style',{},self.CSS), formNode, versionSection ]);
    });
  }
});
