'use strict';
'require view';
'require poll';
'require mierukop.lib as lib';

return lib.page({
  load: function(){ return this.loadBase(); },

  render: function(){
    var self=this;

    self._scout=E('div',{style:'margin-top:6px'});
    var selfcheckSection=E('div',{'class':'cbi-section'},[
      E('h3',{},_('Проверка обхода')),
      E('div',{'class':'mk-hint'},_('Внешний IP и страна каждого туннеля + реально ли отвечают YouTube / Telegram / Discord через него.')),
      E('div',{'class':'mk-act'},[
        self.mkBtn('selfchk','cbi-button-action',_('Проверить сейчас'), function(){ return self.runSelfcheck(); })
      ]),
      self._scout
    ]);

    self._clients=E('div',{style:'margin-top:6px'});
    var clientsSection=E('div',{'class':'cbi-section'},[
      E('h3',{},_('Клиенты')),
      E('div',{'class':'mk-hint'},_('Устройства локальной сети, их активные соединения и сколько из них идёт через туннель.')),
      self._clients,
      E('div',{'class':'mk-act'},[
        self.mkBtn('cliref','cbi-button-action',_('Обновить'), function(){ return self.loadClients(); })
      ])
    ]);

    // event journal — logread is the only history the router keeps, and it is
    // wiped on reboot, so "it dropped for ten minutes this morning" was unprovable
    self._events=E('div',{style:'margin-top:6px;max-height:340px;overflow:auto'});
    var repOut=E('div',{'class':'mk-out'});
    var eventsSection=E('div',{'class':'cbi-section'},[
      E('h3',{},_('Журнал событий')),
      E('div',{'class':'mk-hint'},_('Последние события модуля: перезапуски, срабатывания сторожа, обновления списков, ошибки.')),
      self._events,
      E('div',{'class':'mk-act'},[
        self.mkBtn('evref','cbi-button-action',_('Обновить'), function(){ return self.evts(); }),
        self.mkBtn('report','cbi-button-neutral',_('Отчёт для поддержки'), function(){
          return self.exec(['report']).then(function(t){
            try{ navigator.clipboard.writeText(t||''); }catch(e){}
            return (t||'')+'\n\n'+_('(скопировано в буфер обмена)');
          });
        }, repOut)
      ]),
      repOut
    ]);

    var page=E('div',{},[ E('style',{},self.CSS), self.brandBar(_('диагностика')),
                          selfcheckSection, clientsSection, eventsSection ]);

    // LuCI keys static resources on ITS version, not ours, so right after an
    // update a browser can still hold the previous lib.js. Never let a missing
    // helper take the whole page down — degrade to a hint instead.
    self.evts=function(){
      if(typeof self.loadEvents==='function') return self.loadEvents();
      self._events.innerHTML='<div class="mk-hint">'+
        _('Обновите страницу с очисткой кэша (Ctrl+F5 / Cmd+Shift+R) — браузер держит старую версию интерфейса.')+'</div>';
      return Promise.resolve();
    };
    self.loadClients(); self.refreshStatus(); self.evts();
    // clients does a full nf_conntrack pass — 30s is plenty for a dashboard
    poll.add(function(){ self.refreshStatus(); return self.loadClients(); }, 30);
    poll.add(function(){ return self.evts(); }, 60);
    return page;
  },

  handleSaveApply:null, handleSave:null, handleReset:null
});
