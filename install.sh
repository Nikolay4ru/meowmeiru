#!/bin/sh
# mierukop installer — one-liner for OpenWrt
#
#   sh <(wget -qO- https://raw.githubusercontent.com/Nikolay4ru/mierukop/main/install.sh)
#   # or, if github is blocked on the box, via your mirror:
#   MIERUKOP_MIRROR="https://router.koleso.app/mierukop" sh <(wget -qO- .../install.sh)
#
# Installs: mieru (socks5 transport) + hev-socks5-tunnel (tun2socks) + mierukop files,
# then sets up policy routing of selected traffic through the mieru tunnel.

set -e
REPO="${MIERUKOP_REPO:-https://raw.githubusercontent.com/Nikolay4ru/mierukop/main}"
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
# dnsmasq-full needed for nftset= domain routing; replace dnsmasq if present
if opkg list-installed 2>/dev/null | grep -q '^dnsmasq '; then
	opkg install dnsmasq-full --download-only >/dev/null 2>&1 && {
		opkg remove dnsmasq >/dev/null 2>&1
		opkg install dnsmasq-full >/dev/null 2>&1 || true
	}
fi
opkg install kmod-tun nftables curl ca-bundle >/dev/null 2>&1 || true

# ── binaries: mieru + hev-socks5-tunnel ──
get_bin() { # get_bin <name> <primary-url> <dest>
	local name="$1" url="$2" dest="$3"
	if [ -x "$dest" ]; then say "$name already present"; return 0; fi
	say "fetching $name…"
	if dl "$url" "$dest" 2>/dev/null && [ -s "$dest" ]; then
		chmod +x "$dest"; return 0
	fi
	# mirror fallback
	if [ -n "$MIRROR" ] && dl "$MIRROR/bin/$name" "$dest" 2>/dev/null && [ -s "$dest" ]; then
		chmod +x "$dest"; return 0
	fi
	err "could not fetch $name (set MIERUKOP_MIRROR to a reachable host that serves /bin/$name)"
}

if ! command -v mieru >/dev/null; then
	get_bin mieru \
		"https://github.com/enfein/mieru/releases/download/v${MIERU_VER}/mieru_linux_${MARCH}" \
		/usr/bin/mieru
fi
get_bin hev-socks5-tunnel \
	"https://github.com/heiher/hev-socks5-tunnel/releases/download/${HEV_VER}/hev-socks5-tunnel-linux-${HARCH}" \
	/usr/bin/hev-socks5-tunnel

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
fetch_file usr/bin/mierukop            /usr/bin/mierukop             755
mkdir -p /etc/mierukop/lists

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
