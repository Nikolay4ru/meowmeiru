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
	local name="$1" kind path out
	community_entries "$name" | while IFS=: read -r kind path; do
		[ -n "$path" ] || continue
		out="$CACHE/${name}.${kind}.lst"
		if dl "$REPO/$path" "$out.tmp" && [ -s "$out.tmp" ]; then
			mv "$out.tmp" "$out"; log "downloaded $name/$kind ($(grep -c . "$out") lines)"
		else rm -f "$out.tmp"; log "download failed: $name/$kind (keeping cache)"; fi
	done
}

# load one tunnel's subnets into its set
load_tunnel_subnets() {  # setname names kind g
	local setname="$1" names="$2" kind="$3" g="$4" name net f
	for name in $names; do
		f="$CACHE/$name.subnet.lst"; [ -f "$f" ] || continue
		while read -r net; do case "$net" in ""|"#"*) continue ;; esac; add_to "$setname" "$net"; done < "$f"
	done
	case " $names " in *" youtube "*|*" google_ai "*|*" google_play "*)
		for net in $GOOGLE_SUBNETS; do add_to "$setname" "$net"; done ;; esac
	for net in $(t_subnets "$kind" "$g"); do add_to "$setname" "$net"; done
}

# append one tunnel's domain rules (resolve via tunneled DNS, add IPs to its set)
emit_tunnel_domains() {  # setname names kind g  (stdout)
	local setname="$1" names="$2" kind="$3" g="$4" name f d
	for name in $names; do
		f="$CACHE/$name.domain.lst"; [ -f "$f" ] || continue
		while read -r d; do case "$d" in ""|"#"*|"."*) continue ;; esac
			echo "server=/$d/$ROUTED_DNS"; echo "nftset=/$d/inet#mierukop#$setname"
		done < "$f"
	done
	for d in $(t_domains "$kind" "$g"); do
		echo "server=/$d/$ROUTED_DNS"; echo "nftset=/$d/inet#mierukop#$setname"
	done
}

apply_all() {
	mkdir -p "$CACHE"
	local line idx kind g setname names total=0
	# subnets per tunnel
	for line in $(tunnels); do
		idx=${line%%|*}; kind=$(echo "$line"|cut -d'|' -f2); g=$(echo "$line"|cut -d'|' -f3)
		setname=$(t_set "$idx" "$kind" "$g"); names=$(t_lists "$kind" "$g")
		load_tunnel_subnets "$setname" "$names" "$kind" "$g"
	done
	# default user exclusions → DIRECT set (bypass), routed DNS → default set
	for net in $(uci -q get $CONF.user.exclude_subnet); do add_to mierukop_direct "$net"; done
	for dns in $ROUTED_DNS; do add_to "$NFT_SET" "$dns/32"; done
	# domain drop-in (all tunnels)
	if dnsmasq_full; then
		mkdir -p "$(dirname "$DNSMASQ_CONF")"; : > "$DNSMASQ_CONF"
		for line in $(tunnels); do
			idx=${line%%|*}; kind=$(echo "$line"|cut -d'|' -f2); g=$(echo "$line"|cut -d'|' -f3)
			setname=$(t_set "$idx" "$kind" "$g"); names=$(t_lists "$kind" "$g")
			emit_tunnel_domains "$setname" "$names" "$kind" "$g" >> "$DNSMASQ_CONF"
		done
		# default user exclusions → direct set
		for d in $(uci -q get $CONF.user.exclude_domain); do
			echo "server=/$d/$ROUTED_DNS"; echo "nftset=/$d/inet#mierukop#mierukop_direct"
		done >> "$DNSMASQ_CONF"
		total=$(grep -c '^nftset=' "$DNSMASQ_CONF" 2>/dev/null)
		/etc/init.d/dnsmasq restart >/dev/null 2>&1
		log "domain drop-in: $total entries across $(tunnels|wc -l) tunnel(s)"
	else
		log "dnsmasq-full required for domain lists — skipping (subnets still work)"; rm -f "$DNSMASQ_CONF"
	fi
	log "apply done: $(nft list set $NFT_TABLE $NFT_SET 2>/dev/null | grep -oE '[0-9.]+/[0-9]+' | wc -l) subnets in default set"
}

download_custom() {
	local section="$1" enabled url type
	config_get_bool enabled "$section" enabled 1
	config_get url "$section" url; config_get type "$section" type subnet
	[ "$enabled" = "1" ] && [ -n "$url" ] && [ "$type" = "subnet" ] || return 0
	dl "$url" "$CACHE/custom_${section}.subnet.lst.tmp" && mv "$CACHE/custom_${section}.subnet.lst.tmp" "$CACHE/custom_${section}.subnet.lst"
}

config_load "$CONF"

case "${1:-apply}" in
	download)
		mkdir -p "$CACHE"
		for name in $(all_names); do download_name "$name"; done
		config_foreach download_custom list_source
		apply_all ;;
	apply)     apply_all ;;
	available) available_lists ;;
	*) echo "usage: $0 [download|apply|available]"; exit 1 ;;
esac
