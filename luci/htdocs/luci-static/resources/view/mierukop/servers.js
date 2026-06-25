'use strict';
'require view';
'require form';
'require uci';
'require mierukop.lib as lib';

return lib.page({
  load: function(){ return this.loadBase(); },

  render: function(){
    var self=this, m, s, o;

    m=new form.Map('mierukop','',_('Активный сервер пропускает весь трафик, не попавший в группу. Добавьте несколько серверов для авто-переключения.'));

    s=m.section(form.NamedSection,'settings','mierukop',_('Подключение'));
    s.anonymous=true; s.addremove=false;
    o=s.option(form.Flag,'enabled',_('Включено')); o.rmempty=false;
    o=s.option(form.ListValue,'active_server',_('Активный сервер'),
      _('Какой сервер пропускает трафик. Учётные данные задаются в таблице «Серверы» ниже.'));
    uci.sections('mierukop','server').forEach(function(sv){
      o.value(sv['.name'], self.srvLabel(sv['.name'], (sv.label||sv['.name'])));
    });
    o=s.option(form.Flag,'failover',_('Авто-переключение'),
      _('Переключаться на следующий сервер, если активный перестаёт пропускать трафик.'));

    s=m.section(form.GridSection,'server',_('Серверы'),
      _('Активный выбирается выше. Пинг обновляется кнопкой ниже и раз в 10 минут.'));
    s.addremove=true; s.anonymous=true; s.sortable=false;
    s.option(form.Value,'label',_('Метка'));
    s.option(form.Value,'address',_('Адрес')).datatype='host';
    s.option(form.Value,'port',_('Порт')).datatype='port';
    o=s.option(form.DummyValue,'_ping',_('Пинг, мс'));
    o.cfgvalue=function(sid){ var ms=self.pingMap[sid]; return (ms&&ms!=='—')?ms:'—'; };
    o=s.option(form.Value,'username',_('Пользователь')); o.modalonly=true;
    o=s.option(form.Value,'password',_('Пароль')); o.password=true; o.modalonly=true;
    o=s.option(form.ListValue,'transport',_('Транспорт')); o.value('TCP'); o.value('UDP');

    return m.render().then(function(formNode){
      var out=E('div',{'class':'mk-out'});

      // refresh latency + pick best
      var serverSection=E('div',{'class':'cbi-section'},[
        E('h3',{},_('Задержка серверов')),
        E('div',{'class':'mk-hint'},_('Пинг (мс) показан в колонке «Пинг» выше и в выпадающем списке активного сервера.')),
        E('div',{'class':'mk-act'},[
          self.mkBtn('pingall','cbi-button-action',_('Обновить пинг серверов'), function(){
            return self.exec(['pingall']).then(function(){ setTimeout(function(){ location.reload(); }, 700); return null; });
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
            return self.exec(['sub',url]).then(function(t){
              return self.exec(['restart']).then(function(){
                return self.exec(['update']).then(function(u){
                  setTimeout(function(){ location.reload(); }, 2000);
                  return (t||'')+'\n'+(u||'')+'\n'+_('Готово, обновляю страницу…');
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
