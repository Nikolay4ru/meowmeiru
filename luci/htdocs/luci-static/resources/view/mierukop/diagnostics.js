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

    var page=E('div',{},[ E('style',{},self.CSS), self.brandBar(_('диагностика')), selfcheckSection, clientsSection ]);

    self.loadClients(); self.refreshStatus();
    poll.add(function(){ self.refreshStatus(); return self.loadClients(); }, 15);
    return page;
  },

  handleSaveApply:null, handleSave:null, handleReset:null
});
