'use strict';
'require view';
'require form';
'require uci';
'require mierukop.lib as lib';

var LISTS=['telegram','meta','twitter','discord','roblox','cloudflare','hetzner','digitalocean',
  'youtube','tiktok','google_ai','google_play','hdrezka','russia_inside','russia_outside',
  'anime','news','porn','geoblock','block'];

return lib.page({
  load: function(){ return this.loadBase(); },

  render: function(){
    var self=this, m, s, o;

    m=new form.Map('mierukop','',_('Что попадает в туннель. Группы отправляют конкретные списки через конкретный сервер; остальное идёт через активный сервер.'));

    s=m.section(form.NamedSection,'settings','mierukop',_('Списки сообщества'));
    s.anonymous=true; s.addremove=false;
    o=s.option(form.MultiValue,'community_lists',_('Сервисы через туннель'),
      _('Списки itdoginfo/allow-domains. После изменения нажмите «Сохранить и применить», затем обновите списки на вкладке «Обзор».'));
    o.display_size=16; LISTS.forEach(function(n){ o.value(n,n); }); o.rmempty=true;
    o=s.option(form.Value,'routed_dns',_('DNS для маршрутизируемых доменов'),
      _('Реальный DNS для разрешения доменов (идёт через туннель, в обход DPI/fake-IP).'));
    o.datatype='ipaddr'; o.placeholder='8.8.8.8'; o.optional=true;

    s=m.section(form.GridSection,'group',_('Группы маршрутизации'),
      _('Напр. YouTube → один сервер, Meta → другой. Каждая группа = свой туннель.'));
    s.addremove=true; s.anonymous=true; s.nodescriptions=true;
    o=s.option(form.Flag,'enabled',_('Вкл')); o.default='1'; o.editable=true;
    s.option(form.Value,'label',_('Название'));
    o=s.option(form.DummyValue,'_srv',_('Сервер'));
    o.cfgvalue=function(sid){
      var v=uci.get('mierukop',sid,'server'); if(!v) return '—';
      if(!Array.isArray(v)) v=String(v).split(/\s+/);
      return v.filter(Boolean).map(function(n){ var sv=uci.get('mierukop',n); return (sv&&sv.label)?sv.label:n; }).join(', ');
    };
    o=s.option(form.MultiValue,'server',_('Серверы группы (failover)')); o.modalonly=true;
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

    return m.render();
  }
});
