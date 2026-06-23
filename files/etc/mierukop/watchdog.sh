#!/bin/sh
# mierukop watchdog — restart the tunnel if it stops passing traffic.
# Runs from cron (every 5 min). Probes a lightweight endpoint through the
# local SOCKS5; on repeated failure, restarts the service.

CONF="mierukop"
[ "$(uci -q get $CONF.settings.enabled)" = "1" ] || exit 0
[ "$(uci -q get $CONF.settings.watchdog)" = "1" ] || exit 0

SOCKS="127.0.0.1:$(uci -q get $CONF.settings.socks_port || echo 1180)"
STATE="/tmp/mierukop.wdfail"

# Self-heal: if the routing set got emptied (e.g. by a restart race), reload it.
SETCNT=$(nft list set inet mierukop mierukop_subnets 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | wc -l)
if [ "${SETCNT:-0}" -lt 10 ]; then
	logger -t mierukop-wd "routing set near-empty ($SETCNT) — reapplying lists"
	/etc/mierukop/update-lists.sh apply >/dev/null 2>&1
fi

probe() {
	# 204/200/302 from a tunneled connectivity check = healthy
	curl -fs --socks5-hostname "$SOCKS" --max-time 12 -o /dev/null \
		-w '%{http_code}' http://www.gstatic.com/generate_204 2>/dev/null
}

code="$(probe)"
case "$code" in
	204|200|301|302)
		rm -f "$STATE" ;;
	*)
		n=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
		echo "$n" > "$STATE"
		logger -t mierukop-wd "tunnel probe failed ($code), strike $n/2"
		if [ "$n" -ge 2 ]; then
			logger -t mierukop-wd "restarting mierukop"
			/etc/init.d/mierukop restart
			rm -f "$STATE"
		fi
		;;
esac
