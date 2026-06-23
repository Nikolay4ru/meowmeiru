#!/bin/sh
# mierukop list updater — community lists (podkop-style) over the mieru tunnel.
#
# Two kinds of lists from github.com/itdoginfo/allow-domains, fetched THROUGH the
# tunnel (so it works even when raw.githubusercontent.com is DPI-blocked):
#   • subnet lists  → IP ranges added straight into the nftables set
#   • domain lists  → dnsmasq drop-in that (a) resolves each domain via a real DNS
#                     reached THROUGH the tunnel and (b) adds the resolved IPs to
#                     the same set via `nftset=`. Needs dnsmasq-full.
#
# Usage: update-lists.sh [download|apply]
#   download — fetch all enabled community + custom lists, then apply
#   apply    — (re)load cached subnet lists + user statics into the set

CONF="mierukop"
NFT_TABLE="inet mierukop"
NFT_SET="mierukop_subnets"
CACHE="/etc/mierukop/lists"
# OpenWrt's dnsmasq loads an instance-specific conf-dir (/tmp/dnsmasq.<cfg>.d),
# NOT /tmp/dnsmasq.d — detect the real one so our drop-in is actually read.
dnsmasq_confdir() {
	local d
	d=$(ls -d /tmp/dnsmasq.*.d 2>/dev/null | head -1)
	[ -n "$d" ] && [ -d "$d" ] && { echo "$d"; return; }
	echo "/tmp/dnsmasq.d"
}
DNSMASQ_CONF="$(dnsmasq_confdir)/mierukop-domains.conf"
REPO="https://raw.githubusercontent.com/itdoginfo/allow-domains/main"
SOCKS_PORT="$(uci -q get $CONF.settings.socks_port || echo 1180)"
PROXY="socks5h://127.0.0.1:${SOCKS_PORT}"
# real DNS used to resolve routed domains (reached through the tunnel, see below)
ROUTED_DNS="$(uci -q get $CONF.settings.routed_dns || echo 8.8.8.8)"

. /lib/functions.sh
log() { logger -t mierukop-lists "$1"; }

# ── community registry: name → "kind:repo-relative-path" (one or more) ──
# kind = subnet | domain
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
youtube tiktok google_ai google_play hdrezka russia_outside anime news porn geoblock block"
}

dl() { curl -fs --max-time 60 --proxy "$PROXY" -o "$2" "$1" 2>/dev/null; }

add_subnet() { nft add element $NFT_TABLE $NFT_SET "{ $1 }" 2>/dev/null; }

# True only when dnsmasq is actually COMPILED with nftset (dnsmasq-full).
# --help lists the option even on plain dnsmasq, but using it then crashes the
# daemon ("recompile with HAVE_NFTSET"). The compile-time options in --version
# carry the exact token "nftset" (vs "no-nftset") — match it as a whole word.
dnsmasq_full() { dnsmasq --version 2>&1 | tr ' ' '\n' | grep -qx 'nftset'; }

# Download one community-list name into the cache (subnet files + domain files)
download_name() {
	local name="$1" line kind path out
	community_entries "$name" | while IFS=: read -r kind path; do
		[ -n "$path" ] || continue
		out="$CACHE/${name}.${kind}.lst"
		if dl "$REPO/$path" "$out.tmp" && [ -s "$out.tmp" ]; then
			mv "$out.tmp" "$out"
			log "downloaded $name/$kind ($(grep -c . "$out") lines)"
		else
			rm -f "$out.tmp"
			log "download failed: $name/$kind (keeping cache)"
		fi
	done
}

# Build the dnsmasq domain drop-in from all cached *.domain.lst files
build_domain_dnsmasq() {
	dnsmasq_full || { log "dnsmasq-full required for domain lists — skipping (subnets still work)"; rm -f "$DNSMASQ_CONF"; return 0; }
	mkdir -p "$(dirname "$DNSMASQ_CONF")"
	: > "$DNSMASQ_CONF"
	local nset="4#${NFT_TABLE##* }#${NFT_TABLE%% *}#${NFT_SET}"   # 4#mierukop#inet#mierukop_subnets → reorder below
	# correct nftset target: 4#<family>#<table>#<set>  (family=inet, table=mierukop)
	nset="inet#mierukop#${NFT_SET}"
	local n=0
	for f in "$CACHE"/*.domain.lst; do
		[ -f "$f" ] || continue
		while read -r d; do
			case "$d" in ""|"#"*|"."*) continue ;; esac
			# resolve routed domain via real DNS (reached through the tunnel) + add IPs to set
			echo "server=/$d/$ROUTED_DNS"
			echo "nftset=/$d/$nset"
			n=$((n+1))
		done < "$f"
	done >> "$DNSMASQ_CONF"
	# user domains from uci (routed) + exclusions (direct)
	config_load "$CONF"
	config_list_foreach user domain _emit_user_domain
	config_list_foreach user exclude_domain _emit_direct_domain
	log "domain dnsmasq: $n community domains"
	[ -s "$DNSMASQ_CONF" ] && /etc/init.d/dnsmasq restart >/dev/null 2>&1
}
_emit_user_domain() {
	echo "server=/$1/$ROUTED_DNS" >> "$DNSMASQ_CONF"
	echo "nftset=/$1/inet#mierukop#${NFT_SET}" >> "$DNSMASQ_CONF"
}
_emit_direct_domain() {
	# resolved IPs go to the DIRECT set → bypass tunnel via the `return` rule
	echo "server=/$1/$ROUTED_DNS" >> "$DNSMASQ_CONF"
	echo "nftset=/$1/inet#mierukop#mierukop_direct" >> "$DNSMASQ_CONF"
}

# Load cached subnet lists + user statics into the nft set
load_subnets() {
	mkdir -p "$CACHE"
	local n=0 net
	for f in "$CACHE"/*.subnet.lst; do
		[ -f "$f" ] || continue
		while read -r net; do
			case "$net" in ""|"#"*) continue ;; esac
			add_subnet "$net" && n=$((n+1))
		done < "$f"
	done
	config_load "$CONF"
	config_list_foreach user subnet _add_user_subnet
	# exclusions → DIRECT set (a `return` rule bypasses the tunnel for these)
	config_list_foreach user exclude_subnet _add_direct_subnet
	# DNS servers used for routed domains must themselves go through the tunnel
	for dns in $ROUTED_DNS; do add_subnet "$dns/32"; done
	log "loaded $n subnets into set (+routed DNS $ROUTED_DNS)"
}
_add_user_subnet() { add_subnet "$1"; }
_add_direct_subnet() { nft add element $NFT_TABLE mierukop_direct "{ $1 }" 2>/dev/null; }

# legacy custom list_source sections (arbitrary subnet URLs)
download_custom() {
	local section="$1" enabled url type
	config_get_bool enabled "$section" enabled 1
	config_get url "$section" url
	config_get type "$section" type subnet
	[ "$enabled" = "1" ] && [ -n "$url" ] || return 0
	[ "$type" = "subnet" ] || return 0
	dl "$url" "$CACHE/custom_${section}.subnet.lst.tmp" && \
		mv "$CACHE/custom_${section}.subnet.lst.tmp" "$CACHE/custom_${section}.subnet.lst"
}

config_load "$CONF"
COMMUNITY="$(uci -q get $CONF.settings.community_lists)"

case "${1:-apply}" in
	download)
		mkdir -p "$CACHE"
		for name in $COMMUNITY; do download_name "$name"; done
		config_foreach download_custom list_source
		load_subnets
		build_domain_dnsmasq
		;;
	apply)
		load_subnets
		build_domain_dnsmasq
		;;
	available)
		available_lists ;;
	*)
		echo "usage: $0 [download|apply|available]"; exit 1 ;;
esac
