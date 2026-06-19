#!/bin/sh
# mierukop list updater — downloads subnet lists THROUGH the mieru tunnel
# (raw.githubusercontent.com is often DPI-blocked when fetched directly), then
# loads them into the nftables set so that traffic to those subnets is routed via mieru.
#
# Usage: update-lists.sh [download|apply]
#   download — fetch lists via socks5 into the cache, then apply
#   apply    — load cached lists + user subnets into the nft set (no download)

CONF="mierukop"
NFT_TABLE="inet mierukop"
NFT_SET="mierukop_subnets"
CACHE="/etc/mierukop/lists"
SOCKS_PORT="$(uci -q get $CONF.settings.socks_port || echo 1180)"
PROXY="socks5h://127.0.0.1:${SOCKS_PORT}"

log() { logger -t mierukop-lists "$1"; }
. /lib/functions.sh

add_subnet() { nft add element $NFT_TABLE $NFT_SET "{ $1 }" 2>/dev/null; }

download_one() {
	local section="$1"
	local enabled url type name
	config_get_bool enabled "$section" enabled 1
	config_get url "$section" url
	config_get type "$section" type subnet
	[ "$enabled" = "1" ] || return 0
	[ -n "$url" ] || return 0
	name="$section"
	# fetch via tunnel; keep previous cache on failure
	local tmp="$CACHE/$name.lst.tmp"
	if curl -fs --max-time 40 --proxy "$PROXY" -o "$tmp" "$url" 2>/dev/null; then
		mv "$tmp" "$CACHE/$name.lst"
		log "downloaded $name ($(grep -c . "$CACHE/$name.lst") entries)"
	else
		rm -f "$tmp"
		log "download failed for $name (keeping cache)"
	fi
}

load_cache() {
	mkdir -p "$CACHE"
	local n=0
	for f in "$CACHE"/*.lst; do
		[ -f "$f" ] || continue
		while read -r net; do
			case "$net" in
				""|"#"*) continue ;;
			esac
			add_subnet "$net" && n=$((n+1))
		done < "$f"
	done
	# user-defined static subnets from uci
	config_load "$CONF"
	config_list_foreach user subnet _add_user_subnet
	log "loaded $n subnets into $NFT_SET"
}
_add_user_subnet() { add_subnet "$1"; }

config_load "$CONF"

case "${1:-apply}" in
	download)
		config_foreach download_one list_source
		load_cache
		;;
	apply)
		load_cache
		;;
	*)
		echo "usage: $0 [download|apply]"; exit 1 ;;
esac
