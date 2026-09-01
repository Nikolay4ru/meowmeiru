#!/bin/sh
# mierukop watchdog — keep tunnels passing traffic.
# Runs from cron (every 5 min). Every tunnel (default + each group) is checked
# twice: its DATA PATH (nft set, mtunN, fwmark rule, routing table) and its
# TRANSPORT (an HTTP probe through that tunnel's local SOCKS5).
#
# Escalation is PER-TUNNEL, not global. A failing GROUP only gets its own mieru
# killed — procd respawns it in ~5 s (init.d: procd_set_param respawn 3600 5 0).
# One flaky group no longer tears down all tunnels, reloads fw4, deletes the
# nft table and SIGTERMs dnsmasq. Only the DEFAULT tunnel, which carries every
# routed list, still escalates to failover + full restart, and only on its own
# second consecutive strike.
#
# uci knobs read here beyond settings.enabled/watchdog/socks_port/failover:
#   mierukop.<group>.probe_url    what to fetch through that group's tunnel
#   mierukop.settings.probe_url   the same for the default tunnel, and the
#                                 fallback for a group that names none
#   mierukop.<server>.failover    '0' keeps that server out of automatic
#                                 rotation (see failover_pool below)

CONF="mierukop"
[ "$(uci -q get $CONF.settings.enabled)" = "1" ] || exit 0
[ "$(uci -q get $CONF.settings.watchdog)" = "1" ] || exit 0

BASE=$(uci -q get $CONF.settings.socks_port || echo 1180)
NFT_TABLE="inet mierukop"
RUN_DIR="/var/run/mierukop"
STATE_DIR="/tmp/mierukop.wd"
mkdir -p "$STATE_DIR"
rm -f /tmp/mierukop.wdfail   # legacy single global strike file

# Per-index derived names. These must stay identical to init.d's t_* helpers,
# ARGUMENT ORDER INCLUDED (update-lists.sh carries the same copies): they address
# the very objects init.d created for that tunnel, so a divergence here reports a
# healthy tunnel as broken (or the reverse) for ever, and a signature that only
# looks the same is the easiest way to introduce one.
t_tun()   { echo "mtun$1"; }
t_mark()  { printf '0x%x' $(( 0x1042 + $1 )); }
t_table() { echo $(( 1042 + $1 )); }
t_set()   { [ "$2" = default ] && echo "mierukop_subnets" || echo "mierukop_$(printf '%s' "$3" | tr -c 'a-zA-Z0-9_' '_')"; }

# Self-heal the domain drop-in: dnsmasq is what puts resolved addresses into the
# sets, so once the drop-in is gone every domain-only list stops being routed.
# An element-count threshold instead of an existence test false-triggers on small
# configs and would flush/reapply every 5 minutes. A missing SET is deliberately
# not handled here — `apply` flushes and refills sets, it never creates them, so
# re-applying could never have repaired that; path_fault() below catches it.
DCONF=$(ls /tmp/dnsmasq.*.d/mierukop-domains.conf /tmp/dnsmasq.d/mierukop-domains.conf 2>/dev/null | head -1)
if [ ! -s "$DCONF" ]; then
	logger -t mierukop-wd "domain drop-in missing — reapplying lists"
	/etc/mierukop/update-lists.sh apply >/dev/null 2>&1
fi

# Probe target, most specific first. A group exists to carry ONE service, and
# gstatic answering through its SOCKS port says nothing about whether that
# service is reachable over it — point the group at something it actually routes:
#   uci set mierukop.gYouTube.probe_url='https://www.youtube.com/generate_204'
probe_url() {  # $1 = group section ("" for the default tunnel)
	local u=""
	[ -n "$1" ] && u=$(uci -q get "$CONF.$1.probe_url")
	[ -n "$u" ] || u=$(uci -q get "$CONF.settings.probe_url")
	[ -n "$u" ] || u="http://www.gstatic.com/generate_204"
	echo "$u"
}

probe() {  # $1 = socks port, $2 = url
	curl -fs --socks5-hostname "127.0.0.1:$1" --max-time 12 -o /dev/null \
		-w '%{http_code}' "$2" 2>/dev/null
}
# Any 2xx/3xx means the request came back THROUGH the tunnel, which is all this
# proves. Not a fixed 204/200/30x list any more: a user-supplied probe_url may
# legitimately answer 206 or 307, and a false failure here costs a bounce.
ok() { case "$1" in 2??|3??) return 0 ;; *) return 1 ;; esac; }

# mieru derives its session keys from the wall clock, so a router whose time is
# wrong fails EVERY handshake while TCP still connects: HandshakeErrors climbs
# and ConnErrors stays 0. That is indistinguishable from a dead exit here, and
# the failover below would walk the entire pool, bouncing off each server in
# turn, without once touching the actual fault. It also cannot resolve itself —
# settings.routed_dns is resolved INSIDE the tunnel, so a dead tunnel means no
# DNS, and any NTP server named by hostname becomes unreachable at exactly the
# moment it is needed. Observed live: a power cycle left a router two hours
# behind and it stayed offline for four hours with a perfectly healthy WAN.
# IP literals need no DNS, which is the whole point of them being literals.
# Only ever called after a probe has already failed, so a healthy router pays
# nothing for it. Returns 0 only when the clock was actually MOVED, so the caller
# can restart the tunnels instead of recording a strike against a server that was
# never at fault.
NTP_FALLBACK_IPS="89.109.251.21 194.190.168.1 162.159.200.1"
CLOCK_TOLERANCE=60
clock_resync() {
	local ip pid waited before after drift
	for ip in $NTP_FALLBACK_IPS; do
		before=$(date +%s)
		# busybox ntpd -q keeps retrying a silent server instead of giving up, so it
		# gets an explicit deadline rather than a trusted exit.
		ntpd -q -n -p "$ip" >/dev/null 2>&1 &
		pid=$!
		waited=0
		while [ "$waited" -lt 12 ] && kill -0 "$pid" 2>/dev/null; do
			sleep 1; waited=$((waited+1))
		done
		kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
		after=$(date +%s)
		# Whatever is left after subtracting the seconds this loop itself burned is
		# the step ntpd made.
		drift=$(( after - before - waited ))
		[ "$drift" -lt 0 ] && drift=$(( 0 - drift ))
		if [ "$drift" -gt "$CLOCK_TOLERANCE" ]; then
			logger -t mierukop-wd "clock was ${drift}s out — corrected from $ip, restarting tunnels"
			return 0
		fi
		# A server that answered and still left the clock alone settles the question:
		# the time is right, so the tunnel is down for some other reason. Only a
		# server that never answered (hit the deadline) justifies trying the next.
		[ "$waited" -lt 12 ] && return 1
	done
	return 1
}

# The probe above only ever talks to mieru on 127.0.0.1, so it proves the
# transport and the exit — and nothing else. It never touches the nft set, the
# fwmark rule or mtunN, so a tunnel whose routing plane collapsed probes
# perfectly healthy while every packet it was supposed to carry falls through to
# the main table and leaves over the WAN. Check the plane itself: local, cheap,
# and without putting a single packet on the wire.
path_fault() {  # $1 = idx, $2 = kind, $3 = group -> what is missing ("" = intact)
	local tun table mark sn
	tun=$(t_tun "$1"); table=$(t_table "$1"); mark=$(t_mark "$1"); sn=$(t_set "$1" "$2" "$3")
	nft list set $NFT_TABLE "$sn" >/dev/null 2>&1 || { echo "nft set $sn is gone"; return; }
	[ -d "/sys/class/net/$tun" ] || { echo "$tun does not exist"; return; }
	ip rule show 2>/dev/null | grep -qE "fwmark $mark lookup $table([[:space:]]|\$)" \
		|| { echo "no ip rule fwmark $mark -> table $table"; return; }
	ip route show table "$table" 2>/dev/null | grep -qE "^default dev $tun([[:space:]]|\$)" \
		|| { echo "table $table has no default via $tun"; return; }
}

# A reload stops and starts every tunnel, so it must not turn into a 5-minute
# loop when the ruleset simply refuses to load (init.d then aborts the start on
# purpose). Once an hour recovers from a one-off; anything more stubborn needs a
# human, and the log says so.
RELOAD_STAMP="$STATE_DIR/reloaded"
reload_throttled() {
	local last=0 now
	now=$(date +%s)
	[ -r "$RELOAD_STAMP" ] && read -r last < "$RELOAD_STAMP"
	case "$last" in ''|*[!0-9]*) last=0 ;; esac
	[ $(( now - last )) -ge 3600 ] || return 1
	echo "$now" > "$RELOAD_STAMP"
}

mieru_pid() {  # $1 = socks port -> pid of the mieru listening on it
	netstat -lntp 2>/dev/null | awk -v p="127.0.0.1:$1" '
		$4 == p && $NF ~ /mieru/ { n = split($NF, a, "/"); print a[1]; exit }'
}
hev_pid() {  # $1 = hev config file -> pid of the tun2socks instance holding it
	# Matched on the exact "<binary> <config>" tail. `pgrep -f` looked simpler but
	# searches whole command lines, so it also returns the shell that happens to
	# carry the pattern as an argument — and this pid gets a SIGTERM.
	ps w 2>/dev/null | awk -v c="$1" 'NF > 2 && $(NF-1) ~ /hev-socks5-tunnel$/ && $NF == c { print $1; exit }'
}

bounce() {  # $1 = socks port, $2 = label — restart ONE tunnel, nothing else
	local pid; pid=$(mieru_pid "$1")
	if [ -n "$pid" ]; then
		kill "$pid" 2>/dev/null
		logger -t mierukop-wd "$2: bounced mieru pid $pid (procd respawns in ~5s)"
	else
		logger -t mierukop-wd "$2: no mieru on socks $1 — procd already respawning"
	fi
}

# Repair ONE tunnel's routing plane, in the same per-tunnel spirit as bounce().
# init.d hands hev a post-up script that installs the fwmark rule, the default
# route and the LAN carve-outs, so repair means re-running that very file rather
# than reimplementing the routing here and drifting from it. Two faults it cannot
# fix: mtunN itself (only hev creates it — bounce hev and let its post-up finish
# the job) and a missing nft set (only setup_nft_all declares one, i.e. a reload).
repair_path() {  # $1 = idx, $2 = kind, $3 = group, $4 = label
	local tun up hev sn pid
	tun=$(t_tun "$1"); sn=$(t_set "$1" "$2" "$3")
	if [ "$2" = default ]; then
		up="$RUN_DIR/up0.sh"; hev="$RUN_DIR/hev.yml"
	else
		up="$RUN_DIR/up-$3.sh"; hev="$RUN_DIR/hev-$3.yml"
	fi
	if ! nft list set $NFT_TABLE "$sn" >/dev/null 2>&1; then
		# A reload stops and starts EVERY tunnel, so it is the one repair a group is
		# never allowed to reach — that is the whole point of the per-tunnel rule at
		# the top of this file. Sets are all declared by one setup_nft_all pass, so a
		# missing group set means the ruleset as a whole is gone; the default tunnel
		# sees the same thing and escalates on its own. Letting the group do it also
		# burned the hourly reload token before the default tunnel could use it.
		if [ "$2" != default ]; then
			logger -t mierukop-wd "$4: set $sn is gone — so is the ruleset; the default tunnel rebuilds it"
		elif reload_throttled; then
			logger -t mierukop-wd "$4: set $sn is gone — reloading to rebuild the ruleset"
			/etc/init.d/mierukop reload >/dev/null 2>&1
		else
			logger -t mierukop-wd "$4: set $sn is gone and a reload was already tried this hour — not retrying"
		fi
		return
	fi
	if [ ! -d "/sys/class/net/$tun" ]; then
		pid=$(hev_pid "$hev")
		if [ -n "$pid" ]; then
			kill "$pid" 2>/dev/null
			logger -t mierukop-wd "$4: $tun is gone — bounced hev pid $pid (procd respawns in ~5s)"
		else
			logger -t mierukop-wd "$4: $tun is gone and no hev running — procd already respawning"
		fi
		return
	fi
	if [ -s "$up" ]; then
		sh "$up" "$tun" >/dev/null 2>&1
		logger -t mierukop-wd "$4: re-ran $up — fwmark rule and routing table restored"
	else
		logger -t mierukop-wd "$4: routing broken and $up is missing — reload needed"
	fi
}

strike() {  # $1 = key -> new consecutive-failure count
	local f="$STATE_DIR/$1" n
	n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 ))
	echo "$n" > "$f"; echo "$n"
}
clear_strike() { rm -f "$STATE_DIR/$1"; }

# A bounce that works erases the strike, so a default tunnel that fails every
# OTHER run is bounced for ever and never reaches strike 2 — failover never
# fires and the operator ends up switching servers by hand. Observed live:
# "probe failed, strike 1/2" at 10:50 and again at 11:00, with a passing probe
# in between resetting the count both times. Consecutive failures are the wrong
# unit here; repeated repair IS the failure. Count bounces in a window instead.
FLAP_WINDOW=1800   # 30 min
FLAP_MAX=3
flaps() {  # record this bounce, return how many happened inside the window
	local f="$STATE_DIR/flaps" now cutoff
	now=$(date +%s); cutoff=$(( now - FLAP_WINDOW ))
	echo "$now" >> "$f"
	awk -v c="$cutoff" '$1+0 > c' "$f" > "$f.$$" 2>/dev/null && mv "$f.$$" "$f" || rm -f "$f.$$"
	wc -l < "$f" 2>/dev/null | tr -d ' '
}

# init.d refuses to start a group whose every `option server` is gone (a deleted
# section, or a subscription refresh that re-derived the section ids from new
# addresses), so that group has no mieru, no hev and no mtunN BY DESIGN. Probing
# it anyway only produced a failed probe and a pointless bounce of a daemon that
# was never meant to run, five minutes apart, for ever. Address AND port, because
# that is bring_up_tunnel's real bail-out: tunnel_servers() only proves the
# section exists, and the `[ -n "$sj" ] || return 1` guard behind it drops a
# section that kept its address but lost its port — testing address alone would
# leave exactly the same forever-loop for that half of the cases.
group_has_server() {  # $1 = group section
	local s
	for s in $(uci -q get "$CONF.$1.server"); do
		[ "$(uci -q get "$CONF.$s")" = "server" ] || continue
		[ -n "$(uci -q get "$CONF.$s.address")" ] && [ -n "$(uci -q get "$CONF.$s.port")" ] && return 0
	done
	return 1
}

# Servers eligible for AUTOMATIC rotation. `option failover '0'` on a
# `config server` section takes it out of the pool. Rotation is positional over
# uci order and used to know nothing about where a server actually exits: on this
# deployment the first failover away from Finland landed on a server inside
# Russia, so the tunnel went on reporting "работает" while exiting inside the
# very network it exists to get out of. No country is hardcoded — the operator
# marks the servers that are not usable exits. An excluded server can still be
# selected by hand via settings.active_server; this governs only the automatic
# paths, and `mierukop best-server` filters on the same flag.
failover_pool() {
	uci show "$CONF" 2>/dev/null | sed -n "s/^$CONF\.\([^.=]*\)=server\$/\1/p" \
		| while read -r s; do
			[ "$(uci -q get "$CONF.$s.failover")" = "0" ] || echo "$s"
		done
}

# ---- default tunnel -------------------------------------------------------
deffail=0
defpath=$(path_fault 0 default "")
if [ -n "$defpath" ]; then
	deffail=$(strike default)
	logger -t mierukop-wd "default tunnel data path broken: $defpath, strike $deffail/2"
elif ok "$(probe "$BASE" "$(probe_url "")")"; then
	clear_strike default
else
	# Before blaming the exit: a clock that drifted breaks every handshake mieru
	# makes, and no amount of failover repairs that. Check it first, and only fall
	# through to the server-level escalation once the time is known to be right.
	if clock_resync; then
		/etc/init.d/mierukop restart >/dev/null 2>&1
		clear_strike default
		exit 0
	fi
	deffail=$(strike default)
	logger -t mierukop-wd "default tunnel (socks $BASE) probe failed, strike $deffail/2"
fi

# ---- group tunnels: isolated, never restart the service -------------------
i=0
for g in $(uci show "$CONF" 2>/dev/null | sed -n "s/^$CONF\.\([^.=]*\)=group\$/\1/p"); do
	[ "$(uci -q get $CONF.$g.enabled)" = "0" ] && continue
	# init.d gives an enabled group its index even when it then refuses to start
	# it, so the numbering has to advance here too or every later group would be
	# probed on another tunnel's port.
	i=$((i+1))
	# clear, not just skip: a group that fails and only then loses its server keeps
	# a strike file no run can ever remove again, and `mierukop health` reads that
	# directory — it would show «сбои подряд» for a tunnel that is off by design.
	group_has_server "$g" || { clear_strike "$g"; continue; }
	port=$((BASE+i))
	fault=$(path_fault "$i" group "$g")
	if [ -n "$fault" ]; then
		n=$(strike "$g")
		logger -t mierukop-wd "group $g data path broken: $fault, strike $n"
		repair_path "$i" group "$g" "group $g"
	elif ok "$(probe "$port" "$(probe_url "$g")")"; then
		clear_strike "$g"
	else
		n=$(strike "$g")
		logger -t mierukop-wd "group $g (socks $port) probe failed, strike $n"
		bounce "$port" "group $g"
	fi
done

# ---- escalation: default tunnel only --------------------------------------
[ "$deffail" = 0 ] && exit 0
if [ "$deffail" -lt 2 ]; then
	# repair what actually broke: the routing plane, or the transport behind it
	if [ -n "$defpath" ]; then
		repair_path 0 default "" "default tunnel"
		exit 0
	fi
	bounce "$BASE" "default tunnel"
	n=$(flaps)
	if [ "${n:-1}" -lt "$FLAP_MAX" ]; then exit 0; fi
	# bounced too often to keep blaming the local daemon — fall through to the
	# failover below and let it move off this exit
	logger -t mierukop-wd "default tunnel bounced $n times in ${FLAP_WINDOW}s — escalating to failover"
	rm -f "$STATE_DIR/flaps"
fi

servers=$(failover_pool)
cnt=$(echo $servers | wc -w)
# Rotate only when the EXIT is what failed. A broken data path is the router's
# own doing — swapping servers would blame the wrong end and, five minutes at a
# time, walk the tunnel through the whole pool while the restart below is the
# thing that actually rebuilds the routing.
if [ -z "$defpath" ] && [ "$(uci -q get $CONF.settings.failover)" != "0" ] && [ "$cnt" -gt 1 ]; then
	cur=$(uci -q get $CONF.settings.active_server)
	next=$(echo "$servers" | tr ' ' '\n' | awk -v c="$cur" 'f{print;exit} $0==c{f=1}')
	# empty when the active server is last in the pool — or is not in it at all
	# because it is opted out, in which case moving to the first eligible one is
	# exactly what should happen
	[ -n "$next" ] || next=$(echo $servers | awk '{print $1}')
	uci set $CONF.settings.active_server="$next"; uci commit $CONF
	logger -t mierukop-wd "failover: $cur -> $next, restarting"
else
	logger -t mierukop-wd "default tunnel down twice — restarting mierukop"
fi
/etc/init.d/mierukop restart
clear_strike default
rm -f "$STATE_DIR/flaps"
