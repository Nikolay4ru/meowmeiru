#!/bin/sh
# mierukop watchdog — restart the service if a tunnel stops passing traffic.
# Runs from cron (every 5 min). Probes EVERY tunnel (default + each group)
# through its local SOCKS5; on repeated failure, restarts the service.

CONF="mierukop"
[ "$(uci -q get $CONF.settings.enabled)" = "1" ] || exit 0
[ "$(uci -q get $CONF.settings.watchdog)" = "1" ] || exit 0

BASE=$(uci -q get $CONF.settings.socks_port || echo 1180)
STATE="/tmp/mierukop.wdfail"

# Self-heal only when routing state actually went missing (set or dnsmasq
# drop-in gone) — an element-count threshold false-triggers on small configs
# and would flush/reapply every 5 minutes.
DCONF=$(ls /tmp/dnsmasq.*.d/mierukop-domains.conf /tmp/dnsmasq.d/mierukop-domains.conf 2>/dev/null | head -1)
if ! nft list set inet mierukop mierukop_subnets >/dev/null 2>&1 || [ ! -s "$DCONF" ]; then
	logger -t mierukop-wd "routing state missing — reapplying lists"
	/etc/mierukop/update-lists.sh apply >/dev/null 2>&1
fi

probe() {  # $1 = socks port; 204/200/30x from a tunneled check = healthy
	curl -fs --socks5-hostname "127.0.0.1:$1" --max-time 12 -o /dev/null \
		-w '%{http_code}' http://www.gstatic.com/generate_204 2>/dev/null
}
ok() { case "$1" in 204|200|301|302) return 0 ;; *) return 1 ;; esac; }

fail=0; deffail=0
ok "$(probe "$BASE")" || { fail=1; deffail=1; logger -t mierukop-wd "default tunnel (socks $BASE) probe failed"; }
i=0
for g in $(uci show "$CONF" 2>/dev/null | sed -n "s/^$CONF\.\([^.=]*\)=group\$/\1/p"); do
	[ "$(uci -q get $CONF.$g.enabled)" = "0" ] && continue
	i=$((i+1))
	ok "$(probe $((BASE+i)))" || { fail=1; logger -t mierukop-wd "group $g (socks $((BASE+i))) probe failed"; }
done

if [ "$fail" = 0 ]; then rm -f "$STATE"; exit 0; fi
n=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$STATE"
logger -t mierukop-wd "tunnel probe failed, strike $n/2"
[ "$n" -ge 2 ] || exit 0

# auto-failover only makes sense when the DEFAULT tunnel is down — it rotates
# the default server; a dead group tunnel just needs the restart below
servers=$(uci show "$CONF" 2>/dev/null | sed -n "s/^$CONF\.\([^.=]*\)=server\$/\1/p")
cnt=$(echo $servers | wc -w)
if [ "$deffail" = 1 ] && [ "$(uci -q get $CONF.settings.failover)" != "0" ] && [ "$cnt" -gt 1 ]; then
	cur=$(uci -q get $CONF.settings.active_server)
	next=$(echo "$servers" | tr ' ' '\n' | awk -v c="$cur" 'f{print;exit} $0==c{f=1}')
	[ -n "$next" ] || next=$(echo $servers | awk '{print $1}')
	uci set $CONF.settings.active_server="$next"; uci commit $CONF
	logger -t mierukop-wd "failover: $cur -> $next, restarting"
else
	logger -t mierukop-wd "restarting mierukop"
fi
/etc/init.d/mierukop restart
rm -f "$STATE"
