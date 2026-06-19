'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require ui';

return view.extend({
	load: function () {
		return Promise.all([ uci.load('mierukop') ]);
	},

	render: function () {
		var m, s, o;

		m = new form.Map('mierukop', _('mierukop — routing over mieru'),
			_('Route selected traffic (Telegram, your domains/subnets) through a DPI-resistant mieru tunnel.'));

		// ── Settings ──
		s = m.section(form.NamedSection, 'settings', 'mierukop', _('Settings'));
		s.anonymous = false;

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.rmempty = false;

		o = s.option(form.Value, 'server', _('Server IP'));
		o.datatype = 'host';
		o = s.option(form.Value, 'port', _('Server port'));
		o.datatype = 'port';
		o = s.option(form.ListValue, 'protocol', _('Protocol'));
		o.value('TCP'); o.value('UDP');
		o = s.option(form.Value, 'username', _('Username'));
		o = s.option(form.Value, 'password', _('Password'));
		o.password = true;
		o = s.option(form.Value, 'socks_port', _('Local SOCKS5 port'));
		o.datatype = 'port';
		o.optional = true;

		// ── Routed domains ──
		s = m.section(form.NamedSection, 'user', 'domains', _('Routed domains'),
			_('Domains whose resolved IPs are routed through the tunnel.'));
		o = s.option(form.DynamicList, 'domain', _('Domain'));

		// ── Routed subnets ──
		o = s.option(form.DynamicList, 'subnet', _('Static subnet (CIDR)'));
		o.datatype = 'cidr4';

		// ── Status (read-only) ──
		s = m.section(form.NamedSection, 'settings', 'mierukop', _('Status'));
		o = s.option(form.Button, '_status', _('Health'));
		o.inputtitle = _('Refresh status');
		o.inputstyle = 'apply';
		o.onclick = function () {
			return fs.exec('/usr/bin/mierukop', ['status']).then(function (res) {
				ui.addNotification(null, E('pre', {}, (res.stdout || '') + (res.stderr || '')), 'info');
			});
		};
		o = s.option(form.Button, '_test', _('Test tunnel'));
		o.inputtitle = _('Run test');
		o.inputstyle = 'reload';
		o.onclick = function () {
			return fs.exec('/usr/bin/mierukop', ['test']).then(function (res) {
				ui.addNotification(null, E('pre', {}, (res.stdout || '') + (res.stderr || '')), 'info');
			});
		};

		return m.render();
	}
});
