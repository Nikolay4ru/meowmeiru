# meownetvpn

**Policy routing over a [xray](https://github.com/enfein/xray) SOCKS5 transport for OpenWrt** — a podkop-style module, but built around xray instead of sing-box.

Route only the traffic you choose (e.g. Telegram, Meta, your own domains/subnets) through a DPI‑resistant xray tunnel, while everything else goes out directly. Designed for OpenWrt routers where ISP DPI resets Telegram/blocked services.

## How it works

```
LAN client
   │  (dst ∈ routed subnets/domains)
   ▼
nftables set  ──fwmark──►  ip rule ──►  table ──►  tun (mtun0)
                                                     │
                                          hev-socks5-tunnel (tun2socks)
                                                     │  SOCKS5 127.0.0.1:1180
                                                     ▼
                                                  xray client
                                                     │  obfuscated TCP/UDP
                                                     ▼
                                              xray server → internet
```

- **xray** — the transport. Exposes a local SOCKS5 proxy; obfuscated, DPI‑resistant.
- **hev-socks5-tunnel** — tun2socks. Turns a `tun` device into traffic for the SOCKS5 (TCP + UDP).
- **nftables + fwmark + ip rule** — marks only selected destinations and policy‑routes them into the tun.
- **dnsmasq `nftset=`** — domain‑based routing: resolved IPs of configured domains are auto‑added to the set.
- **list updater** — downloads subnet lists (Telegram, etc.) **through the tunnel**, so it works even when `raw.githubusercontent.com` is DPI‑blocked directly.

## Install (one‑liner)

```sh
sh <(wget -qO- https://raw.githubusercontent.com/Nikolay4ru/meowmeiru/main/install.sh)
```

If GitHub is blocked on the router, serve the files from your own host and:

```sh
MEOWNETVPN_MIRROR="https://router.koleso.app/meownetvpn" \
  sh <(wget -qO- https://raw.githubusercontent.com/Nikolay4ru/meowmeiru/main/install.sh)
```

## Configure & start

```sh
meownetvpn set-server <host> <port> <uuid>
meownetvpn restart
meownetvpn status      # service + tunnel health
meownetvpn test        # exit IP + Telegram reachability through the tunnel
```

## Route more traffic

```sh
meownetvpn add-domain instagram.com
meownetvpn add-subnet 31.13.24.0/21
meownetvpn update          # refresh community subnet lists (via the tunnel)
```

Or edit `/etc/config/meownetvpn` (uci) and `meownetvpn restart`.

## Requirements

OpenWrt 22.03+ (nftables/fw4), `dnsmasq-full`, `kmod-tun`. The installer pulls these plus the
`xray` and `hev-socks5-tunnel` binaries for your architecture (aarch64 / armv7 / x86_64 / mips / mipsel).

## Files

| Path | Purpose |
|---|---|
| `/etc/config/meownetvpn` | uci configuration |
| `/etc/init.d/meownetvpn` | service (procd): runs xray + tun2socks, sets up routing |
| `/etc/meownetvpn/update-lists.sh` | downloads + loads subnet lists |
| `/usr/bin/meownetvpn` | CLI |
| LuCI app | basic web UI (enable, server, lists, status) |

## License

MIT — see `LICENSE`.

> Not affiliated with podkop or xray; inspired by podkop's UX, built on xray's transport.
