#!/bin/sh
# mierukop list updater — community lists (podkop-style) over the mieru tunnels.
#
# Supports routing GROUPS: the default tunnel routes settings.community_lists into
# the main set; each `config group` routes its own community_lists into its OWN set
# (mierukop_<group>) so that list goes through that group's dedicated tunnel.
#
# Usage: update-lists.sh [download|apply|available]

CONF="mierukop"
NFT_TABLE="inet mierukop"
NFT_SET="mierukop_subnets"
CACHE="/etc/mierukop/lists"
dnsmasq_confdir() {
	local d; d=$(ls -d /tmp/dnsmasq.*.d 2>/dev/null | head -1)
	[ -n "$d" ] && [ -d "$d" ] && { echo "$d"; return; }; echo "/tmp/dnsmasq.d"
}
DNSMASQ_CONF="$(dnsmasq_confdir)/mierukop-domains.conf"
REPO="https://raw.githubusercontent.com/itdoginfo/allow-domains/main"
SOCKS_PORT="$(uci -q get $CONF.settings.socks_port || echo 1180)"
PROXY="socks5h://127.0.0.1:${SOCKS_PORT}"
ROUTED_DNS="$(uci -q get $CONF.settings.routed_dns || echo 8.8.8.8)"

. /lib/functions.sh
log() { logger -t mierukop-lists "$1"; }

community_entries() {
	case "$1" in
		telegram)   echo "subnet:Subnets/IPv4/telegram.lst"; echo "domain:Services/telegram.lst" ;;
		meta)       echo "subnet:Subnets/IPv4/meta.lst";     echo "domain:Services/meta.lst" ;;
		twitter)    echo "subnet:Subnets/IPv4/twitter.lst";  echo "domain:Services/twitter.lst" ;;
		discord)    echo "subnet:Subnets/IPv4/discord.lst";  echo "domain:Services/discord.lst" ;;
		cloudflare) echo "subnet:Subnets/IPv4/cloudflare.lst" ;;
		hetzner)    echo "subnet:Subnets/IPv4/hetzner.lst" ;;
		digitalocean) echo "subnet:Subnets/IPv4/digitalocean.lst" ;;
		youtube)    echo "domain:Services/youtube.lst" ;;
		tiktok)     echo "domain:Services/tiktok.lst" ;;
		google_ai)  echo "domain:Services/google_ai.lst" ;;
		google_play) echo "domain:Services/google_play.lst" ;;
		hdrezka)    echo "domain:Services/hdrezka.lst" ;;
		roblox)     echo "subnet:Subnets/IPv4/roblox.lst";   echo "domain:Services/roblox.lst" ;;
		russia_inside)  echo "domain:Russia/inside-raw.lst" ;;
		russia_outside) echo "domain:Russia/outside-raw.lst" ;;
		anime)      echo "domain:Categories/anime.lst" ;;
		news)       echo "domain:Categories/news.lst" ;;
		porn)       echo "domain:Categories/porn.lst" ;;
		geoblock)   echo "domain:Categories/geoblock.lst" ;;
		block)      echo "domain:Categories/block.lst" ;;
		*) return 1 ;;
	esac
}
available_lists() {
	echo "telegram meta twitter discord cloudflare hetzner digitalocean roblox \
youtube tiktok google_ai google_play hdrezka russia_inside russia_outside anime news porn geoblock block"
}

dl() { curl -fs --max-time 60 --proxy "$PROXY" -o "$2" "$1" 2>/dev/null; }
is_cidr() { case "$1" in ''|*[!0-9./]*) return 1 ;; *) return 0 ;; esac; }
add_to() { is_cidr "$2" || return 0; nft add element $NFT_TABLE "$1" "{ $2 }" 2>/dev/null; }

# CDN-мегаблоки (Cloudflare и т.п.), которые community-списки тащат в туннель
# целиком — из-за них ВЕСЬ трафик к этим CDN шёл через VPN. Точные CIDR-строки
# из $CACHE/exclude.lst вычёркиваются из subnet-списков при загрузке.
EXCLUDE_LST="$CACHE/exclude.lst"
filter_excluded() {
	if [ -s "$EXCLUDE_LST" ]; then grep -vxF -f "$EXCLUDE_LST"; else cat; fi
}
# Second line of defence: drop any net broader than /$MIN_PFX regardless of the
# exact CIDR spelling (exclude.lst is literal-match and breaks when upstream
# re-slices its blocks). Nets that SHOULD stay big go into allow-big.lst.
# /16 keeps 157.240.0.0/16 (Meta AS), 66.22.192.0/18 (Discord voice),
# 162.159.128.0/19 (Discord gateway) — cuts CF /12-/15 and GCP /11-/14.
MIN_PFX="$(uci -q get $CONF.settings.subnet_min_prefix || echo 16)"
ALLOW_BIG="$CACHE/allow-big.lst"
filter_megablocks() {
	awk -v min="$MIN_PFX" -v allow="$ALLOW_BIG" '
	BEGIN { while ((getline l < allow) > 0) { sub(/#.*/,"",l); gsub(/[ \t\r]/,"",l); if (l!="") ok[l]=1 } }
	{ sub(/\r$/,""); c=$1
	  if (c=="" || c ~ /^#/) next
	  p=32; if (match(c, /\/[0-9]+$/)) p=substr(c, RSTART+1)+0
	  if (p>=min || (c in ok)) print c; else n++ }
	END { if (n) system("logger -t mierukop-lists \"megablock filter: dropped " n " net(s) broader than /" min "\"") }'
}
dnsmasq_full() { dnsmasq --version 2>&1 | tr ' ' '\n' | grep -qx 'nftset'; }

GOOGLE_SUBNETS="64.233.160.0/19 66.102.0.0/20 66.249.64.0/19 72.14.192.0/18 \
74.125.0.0/16 108.177.0.0/17 142.250.0.0/15 172.217.0.0/16 173.194.0.0/16 \
209.85.128.0/17 216.58.192.0/19 216.239.32.0/19"

# ── tunnel enumeration (mirrors init.d) ──
group_list() { uci show "$CONF" 2>/dev/null | sed -n "s/^$CONF\.\([^.=]*\)=group$/\1/p"; }
tunnels() {
	echo "0|default|"; local i=0 g
	for g in $(group_list); do
		[ "$(uci -q get $CONF.$g.enabled)" = "0" ] && continue
		i=$((i+1)); echo "$i|group|$g"
	done
}
t_set()   { [ "$2" = default ] && echo "$NFT_SET" || echo "mierukop_$3"; }
t_lists() { [ "$1" = default ] && uci -q get $CONF.settings.community_lists || uci -q get $CONF.$2.community_lists; }
t_domains() { [ "$1" = default ] && uci -q get $CONF.user.domain || uci -q get $CONF.$2.domain; }
t_subnets() { [ "$1" = default ] && uci -q get $CONF.user.subnet || uci -q get $CONF.$2.subnet; }

# all community names across default + every group (deduped)
all_names() {
	{ local line kind g; for line in $(tunnels); do
		kind=$(echo "$line"|cut -d'|' -f2); g=$(echo "$line"|cut -d'|' -f3)
		t_lists "$kind" "$g"; echo
	done; } | tr ' ' '\n' | sed '/^$/d' | sort -u
}

download_name() {
	local name="$1" kind path out tmp
	community_entries "$name" | while IFS=: read -r kind path; do
		[ -n "$path" ] || continue
		out="$CACHE/${name}.${kind}.lst"; tmp="/tmp/mierukop/dl.$$"
		if dl "$REPO/$path" "$tmp" && [ -s "$tmp" ]; then
			# $CACHE is overlay flash — rewrite only when content actually changed
			if cmp -s "$tmp" "$out" 2>/dev/null; then rm -f "$tmp"
			else cat "$tmp" > "$out"; rm -f "$tmp"; log "downloaded $name/$kind ($(grep -c . "$out") lines)"; fi
		else rm -f "$tmp"; log "download failed: $name/$kind (keeping cache)"; fi
	done
}

# one tunnel's raw subnet CIDRs on stdout (community lists + custom + user)
collect_tunnel_subnets() {  # names kind g
	local names="$1" kind="$2" g="$3" name net f
	for name in $names; do
		f="$CACHE/$name.subnet.lst"; [ -f "$f" ] || continue
		filter_excluded < "$f" | filter_megablocks
	done
	if [ "$kind" = default ]; then
		for f in "$CACHE"/custom_*.subnet.lst; do
			[ -f "$f" ] || continue
			filter_excluded < "$f" | filter_megablocks
		done
	fi
	# Static Google nets keep the WHOLE Google fleet on one egress. Needed: the
	# watch page and the googlevideo stream must exit through the same IP or
	# YouTube 403s the stream — and googlevideo hostnames are per-session, so
	# domain routing alone leaves gaps. Costs Search/Maps a tunnel trip; set
	# settings.youtube_static_subnets=0 to route strictly by domain instead.
	case " $names " in *" youtube "*|*" google_ai "*|*" google_play "*)
		if [ "$(uci -q get $CONF.settings.youtube_static_subnets)" != "0" ]; then
			for net in $GOOGLE_SUBNETS; do echo "$net"; done
		fi ;;
	esac
	for net in $(t_subnets "$kind" "$g"); do echo "$net"; done
}

# batched "add element" nft commands for a set, CIDRs on stdin (chunks of 400)
emit_add_batch() {  # setname
	grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}(/([0-9]|[12][0-9]|3[0-2]))?$' | sort -u | \
	awk -v t="$NFT_TABLE" -v s="$1" '
		{ a = a (n ? ", " : "") $0
		  if (++n == 400) { printf "add element %s %s { %s }\n", t, s, a; a=""; n=0 } }
		END { if (n) printf "add element %s %s { %s }\n", t, s, a }'
}

# append one tunnel's domain rules (resolve via tunneled DNS, add IPs to its set)
emit_tunnel_domains() {  # setname names kind g  (stdout)
	local setname="$1" names="$2" kind="$3" g="$4" name f d ns
	# v4 set only. Listing a v6 twin as well makes dnsmasq fail on every A record
	# ("Name has no usable address" against the v6 set) — worse than the AAAA
	# noise it was meant to silence. filter-AAAA already keeps IPv6 off clients.
	ns="inet#mierukop#$setname"
	for name in $names; do
		f="$CACHE/$name.domain.lst"; [ -f "$f" ] || continue
		awk -v dns="$ROUTED_DNS" -v ns="$ns" \
			'/^[^#.[:space:]]/ { print "server=/" $1 "/" dns; print "nftset=/" $1 "/" ns }' "$f"
	done
	for d in $(t_domains "$kind" "$g"); do
		echo "server=/$d/$ROUTED_DNS"; echo "nftset=/$d/$ns"
	done
}

apply_all() {
	mkdir -p "$CACHE" /tmp/mierukop
	local line idx kind g setname names total=0 B=/tmp/mierukop/nft.batch net dns
	# rebuild sets from scratch — иначе удалённые/исключённые подсети остаются
	# в наборах навсегда. flush+add идут ОДНОЙ nft-транзакцией: нет ни окна
	# пустых наборов (трафик не утекает мимо туннеля), ни форка на каждый CIDR.
	: > "$B"
	for line in $(tunnels); do
		idx=${line%%|*}; kind=$(echo "$line"|cut -d'|' -f2); g=$(echo "$line"|cut -d'|' -f3)
		setname=$(t_set "$idx" "$kind" "$g"); names=$(t_lists "$kind" "$g")
		echo "flush set $NFT_TABLE $setname" >> "$B"
		collect_tunnel_subnets "$names" "$kind" "$g" | emit_add_batch "$setname" >> "$B"
	done
	echo "flush set $NFT_TABLE mierukop_direct" >> "$B"
	# default user exclusions → DIRECT set (bypass), routed DNS → default set
	for net in $(uci -q get $CONF.user.exclude_subnet); do
		is_cidr "$net" && echo "add element $NFT_TABLE mierukop_direct { $net }" >> "$B"
	done
	for dns in $ROUTED_DNS; do echo "add element $NFT_TABLE $NFT_SET { $dns/32 }" >> "$B"; done
	if ! nft -f "$B" 2>/dev/null; then
		log "atomic set load failed: $(nft -c -f "$B" 2>&1 | head -1) — falling back per-element"
		for line in $(tunnels); do
			idx=${line%%|*}; kind=$(echo "$line"|cut -d'|' -f2); g=$(echo "$line"|cut -d'|' -f3)
			setname=$(t_set "$idx" "$kind" "$g"); names=$(t_lists "$kind" "$g")
			nft flush set $NFT_TABLE "$setname" 2>/dev/null
			collect_tunnel_subnets "$names" "$kind" "$g" | while read -r net; do add_to "$setname" "$net"; done
		done
		nft flush set $NFT_TABLE mierukop_direct 2>/dev/null
		for net in $(uci -q get $CONF.user.exclude_subnet); do add_to mierukop_direct "$net"; done
		for dns in $ROUTED_DNS; do add_to "$NFT_SET" "$dns/32"; done
	fi
	# domain drop-in (all tunnels) — restart dnsmasq ONLY if content changed:
	# a restart drops the whole LAN's DNS cache, and watchdog/self-heal re-applies
	# with identical content most of the time
	if dnsmasq_full; then
		mkdir -p "$(dirname "$DNSMASQ_CONF")"; : > "$DNSMASQ_CONF.new"
		# AAAA is poison for policy routing: the nft sets are ipv4_addr, so an
		# IPv6 answer can never be marked and the client leaves the tunnel (and
		# dnsmasq logs "Could not resolve hostname" per record). Strip AAAA when
		# there is no IPv6 upstream at all — then IPv6 answers are useless anyway
		# and only cost Happy-Eyeballs stalls. settings.filter_aaaa: 1 force on,
		# 0 force off, unset = auto.
		local faaaa; faaaa=$(uci -q get $CONF.settings.filter_aaaa)
		if [ "$faaaa" = "1" ] || { [ -z "$faaaa" ] && [ -z "$(ip -6 route show default 2>/dev/null)" ]; }; then
			echo "filter-AAAA" >> "$DNSMASQ_CONF.new"
		fi
		# groups FIRST: dnsmasq honours the first nftset directive per domain, so
		# a group's domain must not be swallowed by the default tunnel's broader
		# lists (russia_inside contains youtube.com, instagram.com, …)
		for line in $(tunnels | sort -t'|' -k1 -rn); do
			idx=${line%%|*}; kind=$(echo "$line"|cut -d'|' -f2); g=$(echo "$line"|cut -d'|' -f3)
			setname=$(t_set "$idx" "$kind" "$g"); names=$(t_lists "$kind" "$g")
			emit_tunnel_domains "$setname" "$names" "$kind" "$g" >> "$DNSMASQ_CONF.new"
		done
		# default user exclusions → direct set
		for d in $(uci -q get $CONF.user.exclude_domain); do
			echo "server=/$d/$ROUTED_DNS"; echo "nftset=/$d/inet#mierukop#mierukop_direct"
		done >> "$DNSMASQ_CONF.new"
		total=$(grep -c '^nftset=' "$DNSMASQ_CONF.new" 2>/dev/null)
		if cmp -s "$DNSMASQ_CONF.new" "$DNSMASQ_CONF" 2>/dev/null; then
			rm -f "$DNSMASQ_CONF.new"
		else
			mv "$DNSMASQ_CONF.new" "$DNSMASQ_CONF"
			/etc/init.d/dnsmasq restart >/dev/null 2>&1
			log "domain drop-in: $total entries across $(tunnels|wc -l) tunnel(s)"
		fi
	else
		log "dnsmasq-full required for domain lists — skipping (subnets still work)"; rm -f "$DNSMASQ_CONF"
	fi
	# cache the count: the LuCI status poll reads this file instead of dumping
	# the whole set on every tick
	total=$(nft list set $NFT_TABLE $NFT_SET 2>/dev/null | grep -oE '[0-9.]+/[0-9]+' | wc -l)
	echo "$total" > /tmp/mierukop/subnets.count
	log "apply done: $total subnets in default set"
}

download_custom() {
	local section="$1" enabled url type
	config_get_bool enabled "$section" enabled 1
	config_get url "$section" url; config_get type "$section" type subnet
	[ "$enabled" = "1" ] && [ -n "$url" ] && [ "$type" = "subnet" ] || return 0
	local out="$CACHE/custom_${section}.subnet.lst" tmp="/tmp/mierukop/dlc.$$"
	if dl "$url" "$tmp" && [ -s "$tmp" ]; then
		cmp -s "$tmp" "$out" 2>/dev/null || cat "$tmp" > "$out"
	fi
	rm -f "$tmp"
}

config_load "$CONF"

case "${1:-apply}" in
	download)
		mkdir -p "$CACHE" /tmp/mierukop
		for name in $(all_names); do download_name "$name"; done
		config_foreach download_custom list_source
		apply_all ;;
	apply)     apply_all ;;
	available) available_lists ;;
	*) echo "usage: $0 [download|apply|available]"; exit 1 ;;
esac
