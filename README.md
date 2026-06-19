# mierukop

**Policy routing over a [mieru](https://github.com/enfein/mieru) SOCKS5 transport for OpenWrt** — a podkop-style module, but built around mieru instead of sing-box.

Route only the traffic you choose (e.g. Telegram, Meta, your own domains/subnets) through a DPI‑resistant mieru tunnel, while everything else goes out directly. Designed for OpenWrt routers where ISP DPI resets Telegram/blocked services.

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
                                                  mieru client
                                                     │  obfuscated TCP/UDP
                                                     ▼
                                              mieru server → internet
```

- **mieru** — the transport. Exposes a local SOCKS5 proxy; obfuscated, DPI‑resistant.
- **hev-socks5-tunnel** — tun2socks. Turns a `tun` device into traffic for the SOCKS5 (TCP + UDP).
- **nftables + fwmark + ip rule** — marks only selected destinations and policy‑routes them into the tun.
- **dnsmasq `nftset=`** — domain‑based routing: resolved IPs of configured domains are auto‑added to the set.
- **list updater** — downloads subnet lists (Telegram, etc.) **through the tunnel**, so it works even when `raw.githubusercontent.com` is DPI‑blocked directly.

## Install (one‑liner)

```sh
sh <(wget -qO- https://raw.githubusercontent.com/Nikolay4ru/mierukop/main/install.sh)
```

If GitHub is blocked on the router, serve the files from your own host and:

```sh
MIERUKOP_MIRROR="https://router.koleso.app/mierukop" \
  sh <(wget -qO- https://raw.githubusercontent.com/Nikolay4ru/mierukop/main/install.sh)
```

## Configure & start

```sh
mierukop set-server <server_ip> <port> <username> <password>
mierukop restart
mierukop status      # service + tunnel health
mierukop test        # exit IP + Telegram reachability through the tunnel
```

## Route more traffic

```sh
mierukop add-domain instagram.com
mierukop add-subnet 31.13.24.0/21
mierukop update          # refresh community subnet lists (via the tunnel)
```

Or edit `/etc/config/mierukop` (uci) and `mierukop restart`.

## Requirements

OpenWrt 22.03+ (nftables/fw4), `dnsmasq-full`, `kmod-tun`. The installer pulls these plus the
`mieru` and `hev-socks5-tunnel` binaries for your architecture (aarch64 / armv7 / x86_64 / mips / mipsel).

## Files

| Path | Purpose |
|---|---|
| `/etc/config/mierukop` | uci configuration |
| `/etc/init.d/mierukop` | service (procd): runs mieru + tun2socks, sets up routing |
| `/etc/mierukop/update-lists.sh` | downloads + loads subnet lists |
| `/usr/bin/mierukop` | CLI |
| LuCI app | basic web UI (enable, server, lists, status) |

## License

MIT — see `LICENSE`.

> Not affiliated with podkop or mieru; inspired by podkop's UX, built on mieru's transport.
