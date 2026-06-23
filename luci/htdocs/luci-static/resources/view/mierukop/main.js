'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require ui';
'require poll';

var CSS = `
.mk { --mk-accent:#0a84ff; --mk-good:#30d158; --mk-bad:#ff453a; --mk-warn:#ff9f0a;
      --mk-bg:#fff; --mk-fg:#1d1d1f; --mk-muted:#86868b; --mk-line:#e5e5e7; --mk-card:#fff; }
@media (prefers-color-scheme: dark){ .mk{ --mk-bg:#1c1c1e; --mk-fg:#f5f5f7; --mk-muted:#98989d; --mk-line:#38383a; --mk-card:#2c2c2e; } }
.mk { color:var(--mk-fg); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif; }
.mk-hero { background:linear-gradient(135deg,#0a84ff 0%,#0040c1 100%); color:#fff; border-radius:18px;
           padding:22px 24px; display:flex; align-items:center; gap:18px; flex-wrap:wrap; box-shadow:0 8px 30px rgba(10,132,255,.18); }
.mk-hero .ic { width:52px; height:52px; border-radius:14px; background:rgba(255,255,255,.18); display:flex;
               align-items:center; justify-content:center; font-size:26px; flex-shrink:0; }
.mk-hero h2 { margin:0; font-size:22px; font-weight:700; letter-spacing:-.02em; color:#fff; }
.mk-hero .sub { opacity:.9; font-size:13px; margin-top:2px; }
.mk-state { margin-left:auto; display:flex; align-items:center; gap:8px; background:rgba(255,255,255,.16);
            padding:8px 14px; border-radius:999px; font-weight:600; font-size:14px; }
.mk-dot { width:10px; height:10px; border-radius:50%; background:#fff; box-shadow:0 0 0 0 rgba(255,255,255,.6); }
.mk-dot.on { background:var(--mk-good); animation:mkpulse 2s infinite; }
.mk-dot.off { background:var(--mk-bad); }
@keyframes mkpulse{0%{box-shadow:0 0 0 0 rgba(48,209,88,.5)}70%{box-shadow:0 0 0 8px rgba(48,209,88,0)}100%{box-shadow:0 0 0 0 rgba(48,209,88,0)}}

.mk-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:16px 0; }
.mk-stat { background:var(--mk-card); border:1px solid var(--mk-line); border-radius:14px; padding:14px 16px; }
.mk-stat .v { font-size:24px; font-weight:700; letter-spacing:-.02em; line-height:1.1; display:flex; align-items:center; gap:7px; }
.mk-stat .v .s { width:9px; height:9px; border-radius:50%; }
.mk-stat .v .s.up{background:var(--mk-good)} .mk-stat .v .s.down{background:var(--mk-bad)} .mk-stat .v .s.wait{background:var(--mk-warn)}
.mk-stat .l { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.5px; color:var(--mk-muted); margin-top:4px; }
.mk-stat .m { font-size:12px; color:var(--mk-muted); margin-top:2px; font-family:ui-monospace,Menlo,monospace; }

.mk-actions { display:flex; gap:10px; flex-wrap:wrap; margin:6px 0 20px; }
.mk-btn { display:inline-flex; align-items:center; gap:7px; padding:9px 18px; border-radius:999px; border:0;
          font-size:13.5px; font-weight:600; cursor:pointer; transition:transform .12s,opacity .15s; font-family:inherit; }
.mk-btn:active{ transform:scale(.96); } .mk-btn[disabled]{ opacity:.5; cursor:default; }
.mk-btn.primary{ background:var(--mk-accent); color:#fff; } .mk-btn.good{ background:var(--mk-good); color:#fff; }
.mk-btn.ghost{ background:transparent; color:var(--mk-fg); border:1px solid var(--mk-line); }
.mk-btn.danger{ background:transparent; color:var(--mk-bad); border:1px solid var(--mk-bad); }
.mk-spin{ display:inline-block; width:13px; height:13px; border:2px solid rgba(255,255,255,.4); border-top-color:#fff;
          border-radius:50%; animation:mkrot .7s linear infinite; }
@keyframes mkrot{to{transform:rotate(360deg)}}

.mk-sectitle { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; color:var(--mk-muted);
               margin:24px 0 6px 2px; }
/* polish the embedded LuCI form */
.mk-form .cbi-section { background:var(--mk-card); border:1px solid var(--mk-line); border-radius:14px;
                        padding:6px 18px 14px; margin-bottom:14px; box-shadow:none; }
.mk-form .cbi-section h3{ font-size:14px; font-weight:700; letter-spacing:-.01em; }
.mk-form legend{ font-weight:700; }
.mk-out{ background:#0a0a0a; color:#e5e5e7; border-radius:12px; padding:12px 14px; font-family:ui-monospace,Menlo,monospace;
         font-size:12.5px; white-space:pre-wrap; line-height:1.5; margin-top:10px; max-height:220px; overflow:auto; }
`;

return view.extend({
	load: function () { return Promise.all([ uci.load('mierukop') ]); },

	parseStatus: function (txt) {
		var o = {};
		(txt || '').split('\n').forEach(function (l) {
			var m = l.split(':');
			if (m.length >= 2) o[m[0].trim()] = m.slice(1).join(':').trim();
		});
		return o;
	},

	dot: function (up) { return E('span', { 'class': 'mk-dot ' + (up ? 'on' : 'off') }); },
	sdot: function (st) { return E('span', { 'class': 's ' + st }); },

	renderHero: function () {
		var self = this;
		var stateEl = E('div', { 'class': 'mk-state' }, [ self.dot(false), E('span', {}, _('checking…')) ]);
		var hero = E('div', { 'class': 'mk-hero' }, [
			E('div', { 'class': 'ic' }, '🐾'),
			E('div', {}, [
				E('h2', {}, 'mierukop'),
				E('div', { 'class': 'sub' }, _('Selective routing over a mieru tunnel'))
			]),
			stateEl
		]);
		this._stateEl = stateEl;
		return hero;
	},

	renderStats: function () {
		this._st = {
			service: E('div', { 'class': 'v' }, [ this.sdot('wait'), E('span', {}, '—') ]),
			tunnel:  E('div', { 'class': 'v' }, [ this.sdot('wait'), E('span', {}, '—') ]),
			subnets: E('div', { 'class': 'v' }, '—'),
			exit:    E('div', { 'class': 'v' }, [ E('span', { style: 'font-size:16px' }, _('tap Test')) ])
		};
		var card = function (valNode, label, meta) {
			return E('div', { 'class': 'mk-stat' }, [ valNode, E('div', { 'class': 'l' }, label),
				meta ? E('div', { 'class': 'm', 'data-meta': label }, meta) : '' ]);
		};
		return E('div', { 'class': 'mk-stats' }, [
			card(this._st.service, _('Service')),
			card(this._st.tunnel,  _('Tunnel')),
			card(this._st.subnets, _('Routed subnets')),
			card(this._st.exit,    _('Exit IP'))
		]);
	},

	refreshStatus: function () {
		var self = this;
		return fs.exec('/usr/bin/mierukop', ['status']).then(function (res) {
			var s = self.parseStatus(res.stdout || '');
			var svc = (s['service'] === 'running');
			var mieru = (s['mieru'] === 'up'), tun = (s['tun2socks'] === 'up');
			// hero state
			self._stateEl.innerHTML = '';
			self._stateEl.appendChild(self.dot(svc && mieru && tun));
			self._stateEl.appendChild(E('span', {}, svc && mieru && tun ? _('Connected') : (svc ? _('Degraded') : _('Stopped'))));
			// service stat
			self._st.service.innerHTML = '';
			self._st.service.appendChild(self.sdot(svc ? 'up' : 'down'));
			self._st.service.appendChild(E('span', {}, svc ? _('running') : _('stopped')));
			// tunnel stat (mieru + tun2socks)
			self._st.tunnel.innerHTML = '';
			self._st.tunnel.appendChild(self.sdot((mieru && tun) ? 'up' : 'down'));
			self._st.tunnel.appendChild(E('span', {}, (mieru && tun) ? _('up') : (mieru ? 'mieru only' : _('down'))));
			// subnets
			self._st.subnets.textContent = (s['subnets'] || '—');
		}).catch(function () {});
	},

	render: function () {
		var self = this, m, s, o;

		// ── settings form (tabbed; handles save/apply) ──
		m = new form.Map('mierukop', '', '');

		s = m.section(form.NamedSection, 'settings', 'mierukop');
		s.anonymous = true; s.addremove = false;
		s.tab('conn',  _('Connection'));
		s.tab('lists', _('Routing'));
		s.tab('adv',   _('Advanced'));

		// — Connection —
		o = s.taboption('conn', form.Flag, 'enabled', _('Enabled')); o.rmempty = false;
		o = s.taboption('conn', form.Value, 'server', _('Server IP')); o.datatype = 'host';
		o = s.taboption('conn', form.Value, 'port', _('Port')); o.datatype = 'port';
		o = s.taboption('conn', form.ListValue, 'protocol', _('Protocol')); o.value('TCP'); o.value('UDP');
		o = s.taboption('conn', form.Value, 'username', _('Username'));
		o = s.taboption('conn', form.Value, 'password', _('Password')); o.password = true;

		// — Routing (community lists + resolver) —
		o = s.taboption('lists', form.MultiValue, 'community_lists', _('Community lists'),
			_('Services routed through the tunnel (itdoginfo/allow-domains). Press “Update lists” after changing.'));
		o.display_size = 14;
		['telegram','meta','twitter','discord','roblox','cloudflare','hetzner','digitalocean',
		 'youtube','tiktok','google_ai','google_play','hdrezka',
		 'russia_outside','anime','news','porn','geoblock','block'].forEach(function (n) { o.value(n, n); });
		o.rmempty = true;
		o = s.taboption('lists', form.Value, 'routed_dns', _('Resolver for routed domains'),
			_('Real DNS used to resolve routed domains (tunneled, bypasses DPI/fake-IP).'));
		o.datatype = 'ipaddr'; o.placeholder = '8.8.8.8'; o.optional = true;

		// — Advanced —
		o = s.taboption('adv', form.Flag, 'watchdog', _('Watchdog'),
			_('Auto-restart the tunnel if it stops passing traffic (checked every 5 min).'));
		o = s.taboption('adv', form.Flag, 'killswitch', _('Kill-switch'),
			_('Drop routed traffic if the tunnel is down, instead of leaking it directly.'));
		o = s.taboption('adv', form.Value, 'update_interval', _('List refresh (hours)'),
			_('How often to re-download community lists. 0 = never.'));
		o.datatype = 'uinteger'; o.placeholder = '24';
		o = s.taboption('adv', form.Value, 'socks_port', _('Local SOCKS5 port')); o.datatype = 'port'; o.optional = true;
		o = s.taboption('adv', form.Value, 'tun_name', _('Tunnel interface')); o.optional = true; o.placeholder = 'mtun0';

		// ── custom rules (tabbed: routed / excluded) ──
		s = m.section(form.NamedSection, 'user', 'policy', _('Custom rules'));
		s.anonymous = true; s.addremove = false;
		s.tab('routed',   _('Routed (via tunnel)'));
		s.tab('excluded', _('Excluded (direct)'));
		o = s.taboption('routed', form.DynamicList, 'domain', _('Domain')); o.placeholder = 'example.com';
		o = s.taboption('routed', form.DynamicList, 'subnet', _('Subnet (CIDR)')); o.datatype = 'cidr4'; o.placeholder = '203.0.113.0/24';
		o = s.taboption('excluded', form.DynamicList, 'exclude_domain', _('Domain (always direct)')); o.placeholder = 'sberbank.ru';
		o = s.taboption('excluded', form.DynamicList, 'exclude_subnet', _('Subnet (always direct)')); o.datatype = 'cidr4'; o.placeholder = '192.168.0.0/16';

		return m.render().then(function (formNode) {
			var out = E('div', { 'class': 'mk-out', style: 'display:none' });

			var btn = function (cls, icon, label, fn) {
				var b = E('button', { 'class': 'mk-btn ' + cls, click: ui.createHandlerFn(self, function () {
					var orig = b.innerHTML; b.setAttribute('disabled', '');
					b.innerHTML = ''; b.appendChild(E('span', { 'class': 'mk-spin' })); b.appendChild(E('span', {}, ' ' + label));
					return fn().then(function (txt) {
						if (txt != null) { out.style.display = 'block'; out.textContent = txt; }
					}).finally(function () { b.removeAttribute('disabled'); b.innerHTML = orig; self.refreshStatus(); });
				}) }, [ E('span', {}, icon + ' '), E('span', {}, label) ]);
				return b;
			};

			var exec = function (args) {
				return fs.exec('/usr/bin/mierukop', args).then(function (r) { return (r.stdout || '') + (r.stderr || ''); });
			};

			var actions = E('div', { 'class': 'mk-actions' }, [
				btn('good',   '▶', _('Start'),       function () { return exec(['start']); }),
				btn('danger', '■', _('Stop'),        function () { return exec(['stop']); }),
				btn('ghost',  '↻', _('Restart'),     function () { return exec(['restart']); }),
				btn('primary','🔍', _('Test'),       function () {
					return exec(['test']).then(function (t) {
						var m = (t || '').match(/exit IP:\s*([0-9a-fA-F:.]+)/);
						if (m) { self._st.exit.innerHTML = ''; self._st.exit.appendChild(E('span', { style:'font-size:18px;font-family:ui-monospace,Menlo,monospace' }, m[1])); }
						return t;
					});
				}),
				btn('ghost',  '⬇', _('Update lists'), function () { return exec(['update']); })
			]);

			formNode.classList.add('mk-form');

			var page = E('div', { 'class': 'mk' }, [
				E('style', {}, CSS),
				self.renderHero(),
				self.renderStats(),
				E('div', { 'class': 'mk-sectitle' }, _('Quick actions')),
				actions, out,
				E('div', { 'class': 'mk-sectitle' }, _('Configuration')),
				formNode
			]);

			self.refreshStatus();
			poll.add(function () { return self.refreshStatus(); }, 5);
			return page;
		});
	}
});
