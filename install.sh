#!/bin/sh
# meownetvpn installer — one-liner for OpenWrt
#
#   sh <(wget -qO- https://raw.githubusercontent.com/Nikolay4ru/meowmeiru/main/install.sh)
#   # or, if github is blocked on the box, via your mirror:
#   MEOWNETVPN_MIRROR="https://router.koleso.app/meownetvpn" sh <(wget -qO- .../install.sh)
#
# Installs: xray (VLESS transport) + hev-socks5-tunnel (tun2socks) + meownetvpn files,
# then sets up policy routing of selected traffic through the tunnel.

set -e
REPO="${MEOWNETVPN_REPO:-https://raw.githubusercontent.com/Nikolay4ru/meowmeiru/main}"
MIRROR="${MEOWNETVPN_MIRROR:-}"          # optional fallback base (e.g. https://router.koleso.app/meownetvpn)
XRAY_MIRROR="${XRAY_MIRROR:-https://meownet.app/updates/xray}"
HEV_VER="${HEV_VER:-2.7.5}"

say() { echo "[meownetvpn] $1"; }
err() { echo "[meownetvpn] ERROR: $1" >&2; exit 1; }

[ -f /etc/openwrt_release ] || err "not an OpenWrt system"
command -v uci >/dev/null || err "uci not found"

# ── arch detection (OpenWrt → release asset arch) ──
ARCH="$(uname -m)"
case "$ARCH" in
	aarch64) MARCH=arm64;   HARCH=arm64 ;;
	armv7l|armv7) MARCH=arm32; HARCH=arm32v7 ;;
	x86_64) MARCH=amd64;    HARCH=x86_64 ;;
	mips)   MARCH=mips;     HARCH=mips32 ;;
	mipsel) MARCH=mipsle;   HARCH=mips32el ;;
	*) err "unsupported arch: $ARCH (add it to install.sh)" ;;
esac
say "arch: $ARCH → xray/$MARCH, hev/$HARCH"

# ── migration: mierukop → meownetvpn ─────────────────────────────────────────
# The project was renamed and eight routers were already running the old name.
# Everything the operator configured lives in the uci file, so the migration is
# really "move that file and delete the old skin" — but the old skin is not
# inert: its init script, its cron lines, its nft table and its dnsmasq drop-in
# keep running until removed, and two services fighting over one fwmark and one
# tun device is worse than either alone. The old service is therefore stopped
# FIRST, before anything else is touched.
#
# The name is meownetvpn, not meownetvpn, and that is not cosmetic. This firmware
# ALREADY ships a LuCI app called meownet — /etc/config/meownet, its menu.d and
# acl.d entries, and /www/luci-static/resources/view/meownetvpn — which is the
# router's own management panel (wizard, dashboard, wifi, mesh). Installing under
# the bare name overwrites the vendor's menu and config: the panel's pages stay on
# disk and become unreachable, and its settings are replaced. Learned by doing it.
mn_purge_old() {  # $1 = old name to remove
	local n="$1"
	[ -x "/etc/init.d/$n" ] && { /etc/init.d/$n stop >/dev/null 2>&1 || true; /etc/init.d/$n disable >/dev/null 2>&1 || true; }
	sed -i "/$n/d" /etc/crontabs/root 2>/dev/null || true
	nft delete table "inet $n" 2>/dev/null || true
	rm -f /tmp/dnsmasq.d/$n*.conf /tmp/dnsmasq.*.d/$n*.conf 2>/dev/null || true
	rm -f "/etc/init.d/$n" "/usr/bin/$n" 2>/dev/null || true
	rm -rf "/etc/$n" "/var/run/$n" "/tmp/$n" "/tmp/$n.wd" 2>/dev/null || true
	rm -f /etc/rc.d/*"$n" 2>/dev/null || true
	rm -f "/usr/lib/opkg/info/$n.control" 2>/dev/null || true
}
# Undo an earlier install that took the vendor's name. Removing OUR overlay copy
# is what brings the firmware's own file back into view; deleting the merged path
# instead would create a whiteout and hide the vendor file for good.
mn_restore_vendor() {  # $1 = path under /
	local up="/overlay/upper$1"
	[ -e "/rom$1" ] || return 0
	[ -e "$up" ] || return 0
	rm -rf "$up" 2>/dev/null || true
	say "restored the firmware's own $1"
}

if [ -f /etc/config/meownet ] && grep -qE "^config[[:space:]]+(mierukop|meownetvpn)[[:space:]]+'settings'" /etc/config/meownet 2>/dev/null; then
	# A previous run of this installer put OUR config where the vendor's lives.
	say "repairing an earlier install that used the vendor's 'meownetvpn' name…"
	[ -f /etc/config/meownetvpn ] || cp /etc/config/meownet /etc/config/meownetvpn
	mn_purge_old meownetvpn
	rm -f /etc/config/meownet
	mn_restore_vendor /etc/config/meownet
	mn_restore_vendor /usr/share/luci/menu.d/luci-app-meownet.json
	mn_restore_vendor /usr/share/rpcd/acl.d/luci-app-meownet.json
	for v in overview servers routing diagnostics settings; do
		rm -f "/www/luci-static/resources/view/meownet/$v.js"
	done
	rm -rf /www/luci-static/resources/meownet 2>/dev/null || true
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* 2>/dev/null || true
fi

if [ -f /etc/config/mierukop ] && [ ! -f /etc/config/meownetvpn ]; then
	say "migrating mierukop → meownetvpn (settings are preserved)…"
	cp /etc/config/mierukop /root/mierukop.config.bak 2>/dev/null || true
	mv /etc/config/mierukop /etc/config/meownetvpn
	# Carry the DOWNLOADED lists across before the old tree is deleted. They are not
	# config, so it is tempting to let update-lists.sh fetch them again — but that
	# fetch goes THROUGH the tunnel, and until it lands the nft sets hold nothing,
	# which means nothing is routed into the tunnel at all. The service comes up
	# looking healthy (the probe talks to SOCKS directly and passes) while every
	# client is quietly on the open WAN. Observed exactly that: "1 subnets in
	# default set" after a migration that otherwise reported success.
	if [ -d /etc/mierukop/lists ]; then
		mkdir -p /etc/meownetvpn/lists
		for l in /etc/mierukop/lists/*.lst; do
			[ -e "$l" ] || continue
			cp "$l" /etc/meownetvpn/lists/ 2>/dev/null || true
		done
		say "carried over $(ls /etc/meownetvpn/lists/*.lst 2>/dev/null | wc -l) list file(s)"
	fi
	mn_purge_old mierukop
	rm -rf /www/luci-static/resources/mierukop /www/luci-static/resources/view/mierukop 2>/dev/null || true
	rm -f /usr/share/luci/menu.d/luci-app-mierukop.json /usr/share/rpcd/acl.d/luci-app-mierukop.json 2>/dev/null || true
	say "migrated; a copy of the old config is at /root/mierukop.config.bak"
	# Every server section that came across is a mieru endpoint, and mieru is not a
	# transport this version can run. They are left in place rather than deleted so
	# the addresses stay recoverable, but nothing will come up until a VLESS
	# subscription replaces them — say so now, loudly, instead of letting the router
	# sit with a tunnel that never starts.
	MN_NEEDS_SUB=1
elif [ -f /etc/config/mierukop ] && [ -f /etc/config/meownetvpn ]; then
	say "WARNING: both /etc/config/mierukop and /etc/config/meownetvpn exist — leaving both alone."
	say "         remove the stale one by hand, then re-run; two services on one fwmark fight."
fi
if [ -f /etc/config/meownetvpn ] && ! grep -q "option type 'vless'" /etc/config/meownetvpn 2>/dev/null \
   && grep -q "^config server" /etc/config/meownetvpn 2>/dev/null; then
	MN_NEEDS_SUB=1
fi
# The section TYPE is part of the rename too. Nothing reads it (every lookup is
# by section NAME), so a stale `config mierukop 'settings'` is harmless — but it
# is also the first thing anyone sees in the file, and a config that still names
# the old project reads as a migration that did not finish.
if [ -f /etc/config/meownetvpn ]; then
	sed -i "s/^config[[:space:]]\+mierukop[[:space:]]\+'settings'/config meownetvpn 'settings'/; s/^config[[:space:]]\+meownetvpn[[:space:]]\+'settings'/config meownetvpn 'settings'/" /etc/config/meownetvpn 2>/dev/null || true
fi

# ── dependencies ──
say "installing deps (nftables, dnsmasq-full, kmod-tun, ca-bundle, curl)…"
opkg update >/dev/null 2>&1 || true
# dnsmasq-full needed for nftset= domain routing; replace plain dnsmasq.
# Removing dnsmasq kills DNS → opkg can't resolve the mirror, so pin a temp
# resolver first and fall back to plain dnsmasq if -full won't install.
if dnsmasq --version 2>&1 | tr ' ' '\n' | grep -qx 'no-nftset'; then
	say "swapping dnsmasq -> dnsmasq-full (needed for domain lists)..."
	echo "nameserver 8.8.8.8" > /tmp/resolv.conf.d/resolv.conf.auto 2>/dev/null || true
	opkg update >/dev/null 2>&1 || true
	opkg install dnsmasq-full --download-only --force-overwrite >/dev/null 2>&1 || true
	cp /etc/config/dhcp /etc/config/dhcp.meownetvpn.bak 2>/dev/null
	opkg remove dnsmasq >/dev/null 2>&1
	opkg install dnsmasq-full --force-overwrite >/dev/null 2>&1 || \
		opkg install dnsmasq --force-overwrite >/dev/null 2>&1
	[ -s /etc/config/dhcp ] || cp /etc/config/dhcp.meownetvpn.bak /etc/config/dhcp 2>/dev/null
	/etc/init.d/dnsmasq enable >/dev/null 2>&1
	/etc/init.d/dnsmasq restart >/dev/null 2>&1
fi
# ip-full (iproute2) is REQUIRED — busybox `ip` cannot do `ip rule` / routing tables / tuntap
opkg install kmod-tun nftables curl ca-bundle ip-full >/dev/null 2>&1 || true
command -v ip >/dev/null && ip rule list >/dev/null 2>&1 || \
	say "WARNING: 'ip rule' unavailable — ensure ip-full (iproute2) is installed, busybox ip won't work"

# ── binaries: xray + hev-socks5-tunnel ──
# Pinned sha256 for the DEFAULT versions (supply-chain check). Only the arches we
# have verified are listed; others fall back to a warning instead of a hard fail.
# Refresh these when bumping HEV_VER. Xray comes from the mirror as a UPX-packed
# build and is verified by RUNNING it instead — see below.
sha_for() { # sha_for <name> <arch>
	[ "$HEV_VER" = "2.7.5" ] && case "$1:$2" in
		hev-socks5-tunnel:arm64) echo 311677bc9ed408fad8a9688d58580d4c125d4a0b8d5dd8d3b1a1e60e7e8733a8; return;; esac
}
verify_sha() { # verify_sha <file> <name> <arch>
	local want got; want=$(sha_for "$2" "$3")
	[ -n "$want" ] || { say "no pinned checksum for $2/$3 — skipping verify"; return 0; }
	command -v sha256sum >/dev/null || { say "sha256sum unavailable — skipping verify"; return 0; }
	got=$(sha256sum "$1" 2>/dev/null | awk '{print $1}')
	[ "$got" = "$want" ] && { say "$2 checksum OK"; return 0; }
	rm -f "$1"; err "checksum MISMATCH for $2 (got ${got:-none}) — refusing to install a tampered binary"
}
get_bin() { # get_bin <name> <primary-url> <dest> <arch>
	local name="$1" url="$2" dest="$3" arch="$4"
	if [ -x "$dest" ]; then say "$name already present"; return 0; fi
	say "fetching $name…"
	if dl "$url" "$dest" 2>/dev/null && [ -s "$dest" ]; then
		verify_sha "$dest" "$name" "$arch"; chmod +x "$dest"; return 0
	fi
	# mirror fallback
	if [ -n "$MIRROR" ] && dl "$MIRROR/bin/$name" "$dest" 2>/dev/null && [ -s "$dest" ]; then
		verify_sha "$dest" "$name" "$arch"; chmod +x "$dest"; return 0
	fi
	err "could not fetch $name (set MEOWNETVPN_MIRROR to a reachable host that serves /bin/$name)"
}

# Xray, not the upstream release. Upstream ships a 32.6 MB binary and overlay on
# these routers is ~30 MB in total, so the official zip cannot be installed at all
# — the mirror carries a UPX-packed build (7.6 MB, measured) that fits and starts
# in the same second. A packed binary can unpack on one kernel and fault on
# another, so it is checked by being RUN before it is allowed near /usr/bin: an
# xray that faults is a tunnel that never comes up on a router nobody is next to.
if ! command -v xray >/dev/null; then
	say "fetching xray ($XRAY_MIRROR/xray-$MARCH)…"
	if dl "$XRAY_MIRROR/xray-$MARCH" /tmp/xray.dl 2>/dev/null && [ -s /tmp/xray.dl ]; then
		chmod +x /tmp/xray.dl
		case "$(/tmp/xray.dl version 2>&1 | head -1)" in
			Xray*) mv /tmp/xray.dl /usr/bin/xray; chmod +x /usr/bin/xray; say "xray installed" ;;
			*) rm -f /tmp/xray.dl; err "the downloaded xray does not run on this box" ;;
		esac
	else
		rm -f /tmp/xray.dl
		err "could not fetch xray from $XRAY_MIRROR (set XRAY_MIRROR to a host serving xray-$MARCH)"
	fi
fi
get_bin hev-socks5-tunnel \
	"https://github.com/heiher/hev-socks5-tunnel/releases/download/${HEV_VER}/hev-socks5-tunnel-linux-${HARCH}" \
	/usr/bin/hev-socks5-tunnel "$HARCH"

# ── package files ──
say "installing meownetvpn files…"
fetch_file() { # fetch_file <repo-path> <dest> <mode>
	local p="$1" d="$2" m="$3"
	mkdir -p "$(dirname "$d")"
	if dl "$REPO/files/$p" "$d" 2>/dev/null && [ -s "$d" ]; then :;
	elif [ -n "$MIRROR" ]; then dl "$MIRROR/files/$p" "$d"; fi
	[ -n "$m" ] && chmod "$m" "$d"
}
# keep existing config on upgrade
[ -f /etc/config/meownetvpn ] || fetch_file etc/config/meownetvpn /etc/config/meownetvpn 644
fetch_file etc/init.d/meownetvpn         /etc/init.d/meownetvpn          755
fetch_file etc/meownetvpn/update-lists.sh /etc/meownetvpn/update-lists.sh 755
fetch_file etc/meownetvpn/watchdog.sh    /etc/meownetvpn/watchdog.sh     755
fetch_file usr/bin/meownetvpn            /usr/bin/meownetvpn             755

# LuCI app (multi-page): shared lib + per-tab views + menu + acl
fetch_repo() { # fetch_repo <repo-path> <dest> <mode>
	local p="$1" d="$2" m="$3"; mkdir -p "$(dirname "$d")"
	if dl "$REPO/$p" "$d" 2>/dev/null && [ -s "$d" ]; then :;
	elif [ -n "$MIRROR" ]; then dl "$MIRROR/$p" "$d"; fi
	[ -n "$m" ] && chmod "$m" "$d"
}
LV=/www/luci-static/resources
fetch_repo luci/htdocs/luci-static/resources/meownetvpn/lib.js  "$LV/meownetvpn/lib.js"  644
for v in overview servers routing diagnostics settings; do
	fetch_repo "luci/htdocs/luci-static/resources/view/meownetvpn/$v.js" "$LV/view/meownetvpn/$v.js" 644
done
rm -f "$LV/view/meownetvpn/main.js"   # legacy single-page view (replaced by tabs)
fetch_repo luci/root/usr/share/luci/menu.d/luci-app-meownetvpn.json   /usr/share/luci/menu.d/luci-app-meownetvpn.json   644
fetch_repo luci/root/usr/share/rpcd/acl.d/luci-app-meownetvpn.json    /usr/share/rpcd/acl.d/luci-app-meownetvpn.json    644
# module version file (used by update-check / self-update)
dl "$REPO/VERSION" /etc/meownetvpn/VERSION 2>/dev/null || echo "1.1.0" > /etc/meownetvpn/VERSION
mkdir -p /etc/meownetvpn/lists

# ── register with opkg so it shows in the LuCI package manager (removable/upgradeable) ──
say "registering package with opkg…"
PKG_VER="$(cat /etc/meownetvpn/VERSION 2>/dev/null || echo 1.1.0)"
INFO=/usr/lib/opkg/info; STATUS=/usr/lib/opkg/status; mkdir -p "$INFO"
PKG_FILES="/etc/config/meownetvpn /etc/init.d/meownetvpn /etc/meownetvpn/update-lists.sh \
/etc/meownetvpn/watchdog.sh /usr/bin/meownetvpn \
/www/luci-static/resources/meownetvpn/lib.js \
/www/luci-static/resources/view/meownetvpn/overview.js \
/www/luci-static/resources/view/meownetvpn/servers.js \
/www/luci-static/resources/view/meownetvpn/routing.js \
/www/luci-static/resources/view/meownetvpn/diagnostics.js \
/www/luci-static/resources/view/meownetvpn/settings.js \
/usr/share/luci/menu.d/luci-app-meownetvpn.json /usr/share/rpcd/acl.d/luci-app-meownetvpn.json"
: > "$INFO/meownetvpn.list"; PKG_SZ=0
for f in $PKG_FILES; do [ -e "$f" ] && { echo "$f" >> "$INFO/meownetvpn.list"; PKG_SZ=$((PKG_SZ+$(wc -c <"$f"))); }; done
echo "/etc/config/meownetvpn" > "$INFO/meownetvpn.conffiles"
# stop + tear down cleanly when removed via the package manager
cat > "$INFO/meownetvpn.prerm" <<'PRERM'
#!/bin/sh
/etc/init.d/meownetvpn stop 2>/dev/null
/etc/init.d/meownetvpn disable 2>/dev/null
exit 0
PRERM
chmod +x "$INFO/meownetvpn.prerm"
cat > "$INFO/meownetvpn.control" <<CTL
Package: meownetvpn
Version: $PKG_VER
Depends: nftables, dnsmasq-full, kmod-tun, ip-full, curl, ca-bundle
Section: net
Architecture: all
Installed-Size: $PKG_SZ
Description: Selective routing over a xray SOCKS5 tunnel (podkop-style) with LuCI app
CTL
if grep -q "^Package: meownetvpn\$" "$STATUS" 2>/dev/null; then
	awk 'BEGIN{RS="";ORS="\n\n"} !/^Package: meownetvpn\n/' "$STATUS" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
fi
cat >> "$STATUS" <<STAT
Package: meownetvpn
Version: $PKG_VER
Depends: nftables, dnsmasq-full, kmod-tun, ip-full, curl, ca-bundle
Status: install user installed
Architecture: all
Installed-Time: $(date +%s)

STAT

# ── clock: NTP by IP, or the tunnel can never come back ──
# xray derives its session keys from the wall clock, so a router whose time is
# wrong fails EVERY handshake while TCP still connects — HandshakeErrors climbs
# and ConnErrors stays 0, which reads like a dead server and is not one.
# Nothing recovers from that by itself here, because the recovery path runs
# through the very tunnel that is down: settings.routed_dns is resolved INSIDE
# the tunnel, so no tunnel means no DNS, and an NTP server written as a hostname
# can then never be reached to correct the clock that broke the tunnel. A router
# that reboots with a skewed clock stays dead until a human sets the date by
# hand. Observed live: a power cycle left one router two hours behind and it was
# offline for four hours with a perfectly healthy WAN.
# IP literals break the loop — they need no DNS. The first two are outside the
# routed sets on every deployment seen so far, so they stay reachable even while
# the tunnel is down; the Google/Cloudflare addresses are kept as later
# fallbacks precisely because they MAY be inside a routed set.
if [ -z "$(uci -q get system.ntp.server | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$')" ]; then
	uci -q delete system.ntp.server
	uci add_list system.ntp.server='89.109.251.21'   # ntp1.vniiftri.ru
	uci add_list system.ntp.server='194.190.168.1'   # ntp.ix.ru
	uci add_list system.ntp.server='216.239.35.0'    # time.google.com
	uci add_list system.ntp.server='162.159.200.1'   # time.cloudflare.com
	uci add_list system.ntp.server='0.ru.pool.ntp.org'
	uci set system.ntp.enabled='1'
	uci commit system
	/etc/init.d/sysntpd enable >/dev/null 2>&1
	/etc/init.d/sysntpd restart >/dev/null 2>&1
	say "NTP set to IP literals so a skewed clock can always resync"
fi

# ── cron: refresh lists daily ──
CRON="/etc/crontabs/root"; touch "$CRON"
grep -q 'meownetvpn/update-lists.sh download' "$CRON" || \
	echo "30 5 * * * /etc/meownetvpn/update-lists.sh download" >> "$CRON"
/etc/init.d/cron enable >/dev/null 2>&1; /etc/init.d/cron restart >/dev/null 2>&1

/etc/init.d/meownetvpn enable >/dev/null 2>&1

cat <<EOF

[meownetvpn] installed.

Next:
  1) set your xray server:
       meownetvpn set-server <ip> <port> <username> <password>
  2) start:
       meownetvpn restart
  3) verify:
       meownetvpn status
       meownetvpn test

Routed by default: Telegram subnets + domains (telegram.org, t.me, telegra.ph).
Add more:  meownetvpn add-domain <domain>   /   meownetvpn add-subnet <cidr>
EOF

if [ "${MN_NEEDS_SUB:-0}" = 1 ]; then
	echo
	say "ACTION REQUIRED: the servers in this config are mieru endpoints and this"
	say "version speaks VLESS only. Nothing will come up until you import a"
	say "subscription:"
	say "    meownetvpn sub <subscription-url>"
	say "    meownetvpn restart"
fi
