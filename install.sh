#!/bin/sh
# mierukop installer — one-liner for OpenWrt
#
#   sh <(wget -qO- https://raw.githubusercontent.com/Nikolay4ru/meowmeiru/main/install.sh)
#   # or, if github is blocked on the box, via your mirror:
#   MIERUKOP_MIRROR="https://router.koleso.app/mierukop" sh <(wget -qO- .../install.sh)
#
# Installs: mieru (socks5 transport) + hev-socks5-tunnel (tun2socks) + mierukop files,
# then sets up policy routing of selected traffic through the mieru tunnel.

set -e
REPO="${MIERUKOP_REPO:-https://raw.githubusercontent.com/Nikolay4ru/meowmeiru/main}"
MIRROR="${MIERUKOP_MIRROR:-}"          # optional fallback base (e.g. https://router.koleso.app/mierukop)
MIERU_VER="${MIERU_VER:-3.18.0}"
HEV_VER="${HEV_VER:-2.7.5}"

say() { echo "[mierukop] $1"; }
err() { echo "[mierukop] ERROR: $1" >&2; exit 1; }

[ -f /etc/openwrt_release ] || err "not an OpenWrt system"
command -v uci >/dev/null || err "uci not found"

# ── arch detection (OpenWrt → release asset arch) ──
ARCH="$(uname -m)"
case "$ARCH" in
	aarch64) MARCH=arm64;   HARCH=arm64 ;;
	armv7l|armv7) MARCH=armv7; HARCH=arm32v7 ;;
	x86_64) MARCH=amd64;    HARCH=x86_64 ;;
	mips)   MARCH=mips;     HARCH=mips32 ;;
	mipsel) MARCH=mipsle;   HARCH=mips32el ;;
	*) err "unsupported arch: $ARCH (add it to install.sh)" ;;
esac
say "arch: $ARCH → mieru/$MARCH, hev/$HARCH"

dl() { # dl <url> <out>
	if command -v curl >/dev/null; then curl -fsSL --max-time 120 -o "$2" "$1"
	else wget -qO "$2" "$1"; fi
}

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
	cp /etc/config/dhcp /etc/config/dhcp.mierukop.bak 2>/dev/null
	opkg remove dnsmasq >/dev/null 2>&1
	opkg install dnsmasq-full --force-overwrite >/dev/null 2>&1 || \
		opkg install dnsmasq --force-overwrite >/dev/null 2>&1
	[ -s /etc/config/dhcp ] || cp /etc/config/dhcp.mierukop.bak /etc/config/dhcp 2>/dev/null
	/etc/init.d/dnsmasq enable >/dev/null 2>&1
	/etc/init.d/dnsmasq restart >/dev/null 2>&1
fi
# ip-full (iproute2) is REQUIRED — busybox `ip` cannot do `ip rule` / routing tables / tuntap
opkg install kmod-tun nftables curl ca-bundle ip-full >/dev/null 2>&1 || true
command -v ip >/dev/null && ip rule list >/dev/null 2>&1 || \
	say "WARNING: 'ip rule' unavailable — ensure ip-full (iproute2) is installed, busybox ip won't work"

# ── binaries: mieru + hev-socks5-tunnel ──
# Pinned sha256 for the DEFAULT versions (supply-chain check). Only the arches we
# have verified are listed; others fall back to a warning instead of a hard fail.
# Refresh these when bumping MIERU_VER/HEV_VER.
sha_for() { # sha_for <name> <arch>
	[ "$MIERU_VER" = "3.18.0" ] && case "$1:$2" in
		mieru:arm64) echo 5172a716ebf4d8653a04bba6e8f4837f816173841c66d027d073915f08b65705; return;; esac
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
	err "could not fetch $name (set MIERUKOP_MIRROR to a reachable host that serves /bin/$name)"
}

if ! command -v mieru >/dev/null; then
	get_bin mieru \
		"https://github.com/enfein/mieru/releases/download/v${MIERU_VER}/mieru_linux_${MARCH}" \
		/usr/bin/mieru "$MARCH"
fi
get_bin hev-socks5-tunnel \
	"https://github.com/heiher/hev-socks5-tunnel/releases/download/${HEV_VER}/hev-socks5-tunnel-linux-${HARCH}" \
	/usr/bin/hev-socks5-tunnel "$HARCH"

# ── package files ──
say "installing mierukop files…"
fetch_file() { # fetch_file <repo-path> <dest> <mode>
	local p="$1" d="$2" m="$3"
	mkdir -p "$(dirname "$d")"
	if dl "$REPO/files/$p" "$d" 2>/dev/null && [ -s "$d" ]; then :;
	elif [ -n "$MIRROR" ]; then dl "$MIRROR/files/$p" "$d"; fi
	[ -n "$m" ] && chmod "$m" "$d"
}
# keep existing config on upgrade
[ -f /etc/config/mierukop ] || fetch_file etc/config/mierukop /etc/config/mierukop 644
fetch_file etc/init.d/mierukop         /etc/init.d/mierukop          755
fetch_file etc/mierukop/update-lists.sh /etc/mierukop/update-lists.sh 755
fetch_file etc/mierukop/watchdog.sh    /etc/mierukop/watchdog.sh     755
fetch_file usr/bin/mierukop            /usr/bin/mierukop             755
mkdir -p /etc/mierukop/lists

# ── register with opkg so it shows in the LuCI package manager (removable/upgradeable) ──
say "registering package with opkg…"
PKG_VER="${PKG_VER:-1.0.0}"
INFO=/usr/lib/opkg/info; STATUS=/usr/lib/opkg/status; mkdir -p "$INFO"
PKG_FILES="/etc/config/mierukop /etc/init.d/mierukop /etc/mierukop/update-lists.sh \
/etc/mierukop/watchdog.sh /usr/bin/mierukop /www/luci-static/resources/view/mierukop/main.js \
/usr/share/luci/menu.d/luci-app-mierukop.json /usr/share/rpcd/acl.d/luci-app-mierukop.json"
: > "$INFO/mierukop.list"; PKG_SZ=0
for f in $PKG_FILES; do [ -e "$f" ] && { echo "$f" >> "$INFO/mierukop.list"; PKG_SZ=$((PKG_SZ+$(wc -c <"$f"))); }; done
echo "/etc/config/mierukop" > "$INFO/mierukop.conffiles"
# stop + tear down cleanly when removed via the package manager
cat > "$INFO/mierukop.prerm" <<'PRERM'
#!/bin/sh
/etc/init.d/mierukop stop 2>/dev/null
/etc/init.d/mierukop disable 2>/dev/null
exit 0
PRERM
chmod +x "$INFO/mierukop.prerm"
cat > "$INFO/mierukop.control" <<CTL
Package: mierukop
Version: $PKG_VER
Depends: nftables, dnsmasq-full, kmod-tun, ip-full, curl, ca-bundle
Section: net
Architecture: all
Installed-Size: $PKG_SZ
Description: Selective routing over a mieru SOCKS5 tunnel (podkop-style) with LuCI app
CTL
if grep -q "^Package: mierukop\$" "$STATUS" 2>/dev/null; then
	awk 'BEGIN{RS="";ORS="\n\n"} !/^Package: mierukop\n/' "$STATUS" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
fi
cat >> "$STATUS" <<STAT
Package: mierukop
Version: $PKG_VER
Depends: nftables, dnsmasq-full, kmod-tun, ip-full, curl, ca-bundle
Status: install user installed
Architecture: all
Installed-Time: $(date +%s)

STAT

# ── cron: refresh lists daily ──
CRON="/etc/crontabs/root"; touch "$CRON"
grep -q 'mierukop/update-lists.sh download' "$CRON" || \
	echo "30 5 * * * /etc/mierukop/update-lists.sh download" >> "$CRON"
/etc/init.d/cron enable >/dev/null 2>&1; /etc/init.d/cron restart >/dev/null 2>&1

/etc/init.d/mierukop enable >/dev/null 2>&1

cat <<EOF

[mierukop] installed.

Next:
  1) set your mieru server:
       mierukop set-server <ip> <port> <username> <password>
  2) start:
       mierukop restart
  3) verify:
       mierukop status
       mierukop test

Routed by default: Telegram subnets + domains (telegram.org, t.me, telegra.ph).
Add more:  mierukop add-domain <domain>   /   mierukop add-subnet <cidr>
EOF
