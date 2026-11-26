#!/usr/bin/env python3
"""netwatch - find where an internet connection freezes.

  netwatch.py discover [--dest 8.8.8.8]        trace the route, show IPs/MACs, write targets.txt
  netwatch.py monitor  [--interval 1]          ping every hop each second, log outages
  netwatch.py report                           summarise the outages and slow episodes found so far
  netwatch.py scan                             replay the samples CSVs to find slow episodes in old data

Everything goes in --logdir (default ~/netwatch-logs):
  targets.txt          hops to watch, one "label ip kind" per line (edit freely)
  events.log           human-readable: DOWN/UP per hop, OUTAGE START/END, SLOW START/END,
                       Wi-Fi changes, traces
  samples-DATE.csv     one row per second: RTT in ms for every hop (blank = no reply)

Python 3 standard library only. Needs `ping` and preferably `traceroute`
(sudo apt install traceroute); falls back to `tracepath`.
"""
import argparse
import collections
import csv
import datetime as dt
import glob
import ipaddress
import os
import random
import re
import shutil
import socket
import statistics
import struct
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

DOWN_AFTER = 3          # consecutive lost pings before a hop is declared down
HOME_NETS = [ipaddress.ip_network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')]
CGNAT = ipaddress.ip_network('100.64.0.0/10')


# ---------------------------------------------------------------- helpers

def now():
    return dt.datetime.now().astimezone()


def stamp(t=None):
    return (t or now()).strftime('%Y-%m-%d %H:%M:%S')


def run(cmd, timeout=60):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ''


def is_home(ip):
    a = ipaddress.ip_address(ip)
    return any(a in n for n in HOME_NETS)


def default_route():
    """(gateway, interface) of the IPv4 default route."""
    m = re.search(r'default via (\S+) dev (\S+)', run(['ip', '-4', 'route', 'show', 'default']))
    return (m.group(1), m.group(2)) if m else (None, None)


def mac_of(ip):
    m = re.search(r'lladdr (\S+)', run(['ip', 'neigh', 'show', ip]))
    return m.group(1) if m else None


def own_addr(iface):
    out = run(['ip', '-br', 'link', 'show', iface]).split()
    mac = out[2] if len(out) > 2 else None
    m = re.search(r'inet (\S+)', run(['ip', '-4', 'addr', 'show', iface]))
    return (m.group(1) if m else None), mac


def rdns(ip):
    try:
        return socket.gethostbyaddr(ip)[0]
    except OSError:
        return ''


def trace(dest, max_hops=15, wait=2):
    """List of (hop number, ip or None, rtt ms or None)."""
    hops = []
    if shutil.which('traceroute'):
        out = run(['traceroute', '-n', '-q', '1', '-w', str(wait), '-m', str(max_hops), dest], 120)
        for line in out.splitlines()[1:]:
            m = re.match(r'\s*(\d+)\s+(.*)', line)
            if not m:
                continue
            ip = re.search(r'(\d+\.\d+\.\d+\.\d+)', m.group(2))
            rtt = re.search(r'([\d.]+) ms', m.group(2))
            hops.append((int(m.group(1)), ip and ip.group(1), rtt and float(rtt.group(1))))
    elif shutil.which('tracepath'):
        out = run(['tracepath', '-n', '-m', str(max_hops), dest], 180)
        seen = {}
        for line in out.splitlines():
            m = re.match(r'\s*(\d+)\??:\s+(\d+\.\d+\.\d+\.\d+)\s+([\d.]+)ms', line)
            if m and int(m.group(1)) not in seen:
                seen[int(m.group(1))] = (m.group(2), float(m.group(3)))
            elif re.match(r'\s*(\d+):\s+no reply', line):
                seen.setdefault(int(line.split(':')[0]), (None, None))
        hops = [(n, ip, rtt) for n, (ip, rtt) in sorted(seen.items())]
    else:
        sys.exit('Neither traceroute nor tracepath is installed: sudo apt install traceroute')
    return hops


def wifi_link(iface):
    """Dict with bssid/ssid/freq/signal/bitrate, {} if not Wi-Fi, {'bssid': None} if disconnected."""
    if not os.path.isdir(f'/sys/class/net/{iface}/wireless') or not shutil.which('iw'):
        return {}
    out = run(['iw', 'dev', iface, 'link'], 5)
    if 'Not connected' in out or not out:
        return {'bssid': None}
    info = {}
    for key, pat in (('bssid', r'Connected to (\S+)'), ('ssid', r'SSID: (.*)'), ('freq', r'freq: ([\d.]+)'),
                     ('signal', r'signal: (-?\d+) dBm'), ('bitrate', r'tx bitrate: ([\d.]+ \S+)')):
        m = re.search(pat, out)
        info[key] = m.group(1).strip() if m else None
    return info


def link_counters(iface):
    """(wifi tx retries, rx bytes, tx bytes) for iface; any field may be None."""
    retry = rx = tx = None
    try:
        with open('/proc/net/wireless') as f:
            for line in f:
                if line.strip().startswith(iface + ':'):
                    retry = int(line.split()[8])
    except (OSError, ValueError, IndexError):
        pass
    try:
        with open(f'/sys/class/net/{iface}/statistics/rx_bytes') as f:
            rx = int(f.read())
        with open(f'/sys/class/net/{iface}/statistics/tx_bytes') as f:
            tx = int(f.read())
    except (OSError, ValueError):
        pass
    return retry, rx, tx


def wifi_signal(iface):
    """Fast signal read (dBm) from /proc/net/wireless."""
    try:
        with open('/proc/net/wireless') as f:
            for line in f:
                if line.strip().startswith(iface + ':'):
                    return float(line.split()[3].rstrip('.'))
    except (OSError, ValueError, IndexError):
        pass
    return None


def ping(ip, timeout=1):
    out = run(['ping', '-n', '-c', '1', '-W', str(timeout), ip], timeout + 2)
    m = re.search(r'time[=<]([\d.]+)', out)
    return float(m.group(1)) if m else None


def ping_all(ips, timeout=1):
    procs = [(ip, subprocess.Popen(['ping', '-n', '-c', '1', '-W', str(timeout), ip],
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True))
             for ip in ips]
    res = {}
    for ip, p in procs:
        try:
            out, _ = p.communicate(timeout=timeout + 2)
        except subprocess.TimeoutExpired:
            p.kill()
            out = ''
        m = re.search(r'time[=<]([\d.]+)', out)
        res[ip] = float(m.group(1)) if m else None
    return res


def dns_query(server, name='www.google.com', timeout=1.0):
    """Send one A query over UDP; return response time in ms or None."""
    qid = random.randint(0, 0xFFFF)
    q = struct.pack('>HHHHHH', qid, 0x0100, 1, 0, 0, 0)
    q += b''.join(bytes([len(p)]) + p.encode() for p in name.split('.')) + b'\0' + struct.pack('>HH', 1, 1)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    t0 = time.monotonic()
    try:
        s.sendto(q, (server, 53))
        while True:
            data, _ = s.recvfrom(1500)
            if data[:2] == q[:2]:
                return round((time.monotonic() - t0) * 1000, 1)
    except OSError:
        return None
    finally:
        s.close()


# ---------------------------------------------------------------- discover

def suggest_targets(hops, dest, alt):
    ips = list(dict.fromkeys(ip for _, ip, _ in hops if ip))     # drop repeated hops
    home = [ip for ip in ips if is_home(ip)]
    names = {3: ['nest', 'opnsense', 'deco'], 2: ['nest', 'opnsense']}.get(len(home)) or \
        [f'home{i + 1}' for i in range(len(home))]
    targets = [(n, ip, 'hop') for n, ip in zip(names, home)]
    isp = [ip for ip in ips if not is_home(ip) and ip != dest]
    targets += [(f'isp{i + 1}', ip, 'hop') for i, ip in enumerate(isp[:3])]
    targets += [('dest', dest, 'internet'), ('alt', alt, 'internet')]
    return targets


def cmd_discover(args):
    gw, iface = default_route()
    ip, mac = own_addr(iface) if iface else (None, None)
    print(f'This host : {socket.gethostname()}  {ip}  MAC {mac}  via {iface}')
    w = wifi_link(iface) if iface else {}
    if w.get('bssid'):
        print(f'Wi-Fi     : SSID "{w["ssid"]}"  AP radio MAC (BSSID) {w["bssid"]}  '
              f'{w["freq"]} MHz  signal {w["signal"]} dBm  {w["bitrate"]}')
    print(f'Gateway   : {gw}\n')

    for dest in (args.dest, args.alt):
        print(f'Route to {dest}:')
        hops = trace(dest)
        print(f'  {"hop":>3}  {"ip":<16} {"rtt":>8}  {"MAC (only on-link hops)":<19}  where  /  reverse DNS')
        for n, hip, rtt in hops:
            if not hip:
                print(f'  {n:>3}  {"*":<16}')
                continue
            ping(hip)                       # refresh the neighbour table
            hmac = mac_of(hip) or '-'
            kind = 'home' if is_home(hip) else ('ISP CGNAT' if ipaddress.ip_address(hip) in CGNAT else 'internet')
            print(f'  {n:>3}  {hip:<16} {(f"{rtt:.1f}ms" if rtt else ""):>8}  {hmac:<19}  {kind}  {rdns(hip)}')
        print()
        if dest == args.dest:
            first = hops

    targets = suggest_targets(first, args.dest, args.alt)
    os.makedirs(args.logdir, exist_ok=True)
    path = os.path.join(args.logdir, 'targets.txt')
    with open(path, 'w') as f:
        f.write('# label ip kind   (kind "hop" = a router on the path, in order; '
                '"internet" = end destinations)\n')
        for t in targets:
            f.write(' '.join(t) + '\n')
    print(f'Wrote {path}:')
    for t in targets:
        print('  ', *t)
    print('\nOnly the first hop shares a LAN segment with this host, so only its MAC is visible here.\n'
          'The other MACs live in the ARP table of the router in front of them\n'
          '(OPNsense: Interfaces > Diagnostics > ARP Table; Deco: app > Clients).')


# ---------------------------------------------------------------- slow-episode detector

SLOW_WINDOW = 20        # seconds in the sliding window
SLOW_MS = 100           # window median internet RTT above this starts an episode
CLEAR_MS = 60           # ... and below this ends it
LOST_MS = 1000          # a lost ping counts as this many ms
BASELINE = 600          # normal-time samples kept for the per-hop baseline


class SlowDetector:
    """Finds stretches where the internet is slow but not down (the outage logic needs total loss).

    feed() takes one sample per second, keyed by target label, and returns event lines.
    At the end of an episode it reports each hop's added latency against its normal baseline;
    the first hop carrying at least half of the internet's added latency is the 'origin'
    (origin = first hop means the problem is on this machine's own link to it).
    """

    def __init__(self, targets):
        self.labels = [l for l, _, _ in targets]
        self.hops = [l for l, _, k in targets if k == 'hop']
        self.inet = [l for l, _, k in targets if k == 'internet'] or self.labels[-1:]
        self.win = collections.deque(maxlen=SLOW_WINDOW)
        self.base = collections.deque(maxlen=BASELINE)
        self.ep = None

    def inet_rtt(self, rtts):
        vals = [rtts[l] for l in self.inet if rtts.get(l) is not None]
        return min(vals) if vals else LOST_MS

    def feed(self, t, rtts, dns_ok, sig, counters=None):
        s = (t, rtts, dns_ok, sig, counters)
        if self.ep is None and len(self.win) == SLOW_WINDOW:
            # baseline only takes samples that have aged out of the window, so the
            # leading edge of an episode (before it is detected) never counts as normal
            self.base.append(self.win[0])
        self.win.append(s)
        med = statistics.median(self.inet_rtt(x[1]) for x in self.win)
        if self.ep is None:
            if len(self.win) == SLOW_WINDOW and med > SLOW_MS:
                self.ep = list(self.win)
                return [f'SLOW START  internet median {med:.0f}ms over the last {SLOW_WINDOW}s']
            return []
        self.ep.append(s)
        if med < CLEAR_MS:
            out = self.summary(self.ep)
            self.ep = None
            self.win.clear()
            return [out] if out else []
        return []

    def flush(self):
        """End an episode still open when the data runs out."""
        out = self.summary(self.ep, ongoing=True) if self.ep else None
        self.ep = None
        return [out] if out else []

    def summary(self, ep, ongoing=False):
        # trim the normal samples the sliding window dragged in at either end
        slow = [i for i, x in enumerate(ep) if self.inet_rtt(x[1]) > SLOW_MS]
        if not slow:
            return None
        ep = ep[slow[0]:slow[-1] + 1]
        secs = (ep[-1][0] - ep[0][0]).total_seconds() + 1

        def med(samples, l):
            return statistics.median(LOST_MS if x[1].get(l) is None else x[1][l] for x in samples)

        base = list(self.base) or ep
        added = {l: med(ep, l) - med(base, l) for l in self.labels}
        inet_added = statistics.median(self.inet_rtt(x[1]) for x in ep) - \
            statistics.median(self.inet_rtt(x[1]) for x in base)
        origin = next((l for l in self.hops if added[l] >= inet_added / 2), 'beyond-hops')
        worst = max(self.inet_rtt(x[1]) for x in ep)
        lost = sum(1 for x in ep if self.inet_rtt(x[1]) >= LOST_MS)
        dns_fail = sum(1 for x in ep if not x[2])
        sigs = [x[3] for x in ep if x[3] is not None]

        parts = [f'SLOW END  start={stamp(ep[0][0])}  duration={secs:.0f}s{" (still going)" if ongoing else ""}',
                 f'origin={origin}', f'worst={worst:.0f}ms', f'lost={lost}s', f'dns_fail={dns_fail}',
                 'added: ' + ' '.join(f'{l}=+{added[l]:.0f}' for l in self.labels)]
        if sigs:
            parts.append(f'wifi_dbm={min(sigs):.0f}..{max(sigs):.0f}')
        rate = self.counter_rates(ep)
        if rate:
            b = self.counter_rates(base)
            r, rx, tx = rate
            parts.append(f'wifi_retries/min={r:.0f}' + (f' (normal {b[0]:.0f})' if b else ''))
            parts.append(f'this_host_kbit/s rx={rx:.0f} tx={tx:.0f}' +
                         (f' (normal {b[1]:.0f}/{b[2]:.0f})' if b else ''))
        return '  '.join(parts)

    @staticmethod
    def counter_rates(samples):
        c = [(x[0], x[4]) for x in samples if x[4] and None not in x[4]]
        if len(c) < 2:
            return None
        dt_s = (c[-1][0] - c[0][0]).total_seconds()
        if dt_s <= 0:
            return None
        (r0, rx0, tx0), (r1, rx1, tx1) = c[0][1], c[-1][1]
        return (r1 - r0) * 60 / dt_s, (rx1 - rx0) * 8 / 1000 / dt_s, (tx1 - tx0) * 8 / 1000 / dt_s


# ---------------------------------------------------------------- monitor

class Monitor:
    def __init__(self, args):
        self.args = args
        self.logdir = args.logdir
        self.targets = self.load_targets()
        self.hops = [t for t in self.targets if t[2] == 'hop']
        self.inet = [t for t in self.targets if t[2] == 'internet']
        _, self.iface = default_route()
        self.lock = threading.Lock()
        self.fails = {ip: 0 for _, ip, _ in self.targets}
        self.first_fail = {}
        self.down = set()
        self.outage = None              # dict while the internet is unreachable
        self.inet_fails = 0
        self.hour = None
        self.stats = {}
        self.wifi = {}
        self.last_path = None
        self.csv_day = None
        self.csv = None
        self.slow = SlowDetector(self.targets)

    def load_targets(self):
        path = os.path.join(self.logdir, 'targets.txt')
        if not os.path.exists(path):
            sys.exit(f'{path} not found - run "netwatch.py discover" first')
        out = []
        with open(path) as f:
            for line in f:
                p = line.split('#')[0].split()
                if len(p) >= 2:
                    out.append((p[0], p[1], p[2] if len(p) > 2 else 'hop'))
        return out

    def event(self, msg):
        line = f'{stamp()}  {msg}'
        with self.lock:
            print(line, flush=True)
            with open(os.path.join(self.logdir, 'events.log'), 'a') as f:
                f.write(line + '\n')

    def write_sample(self, t, rtts, dns, sig):
        day = t.strftime('%Y-%m-%d')
        if day != self.csv_day:
            if self.csv:
                self.csv.close()
            path = os.path.join(self.logdir, f'samples-{day}.csv')
            new = not os.path.exists(path)
            self.csv = open(path, 'a', buffering=1)
            if new:
                self.csv.write('time,wifi_dbm,' + ','.join(l for l, _, _ in self.targets) + ',dns_ms\n')
            self.csv_day = day
        cells = [t.strftime('%H:%M:%S'), '' if sig is None else f'{sig:.0f}']
        cells += ['' if rtts[ip] is None else f'{rtts[ip]:.1f}' for _, ip, _ in self.targets]
        cells.append('' if dns is None else f'{dns:.0f}')
        self.csv.write(','.join(cells) + '\n')

    def status_line(self, rtts):
        return '  '.join(f'{l}={"ok" if rtts[ip] is not None else "LOST"}' for l, ip, _ in self.targets)

    def bg_trace(self, why):
        def work():
            hops = trace(self.args.dest, max_hops=12, wait=1)
            path = ' '.join(f'{n}:{ip or "*"}' for n, ip, _ in hops)
            if why != 'periodic':
                self.event(f'TRACE ({why})  {path}')
                return
            ips = [ip for _, ip, _ in hops if ip]
            if ips == self.last_path:
                return
            self.event(f'PATH {"(changed) " if self.last_path else ""} {path}')
            self.last_path = ips
        threading.Thread(target=work, daemon=True).start()

    def check_wifi(self):
        if not self.iface:
            return
        w = wifi_link(self.iface)
        if not w:
            return
        old = self.wifi
        if old and w.get('bssid') != old.get('bssid'):
            if w.get('bssid') is None:
                self.event(f'WIFI  disconnected from {old.get("bssid")}')
            else:
                self.event(f'WIFI  now on AP {w["bssid"]} ({w["freq"]} MHz, {w["signal"]} dBm, {w["bitrate"]})'
                           f'  was {old.get("bssid")}')
        elif not old:
            self.event(f'WIFI  on AP {w.get("bssid")} ({w.get("freq")} MHz, {w.get("signal")} dBm, '
                       f'{w.get("bitrate")})')
        self.wifi = w

    def hourly(self, t):
        h = t.strftime('%Y-%m-%d %H')
        if self.hour and h != self.hour and self.stats:
            parts = []
            for l, ip, _ in self.targets:
                sent, lost, tot, mx = self.stats.get(ip, (0, 0, 0.0, 0.0))
                got = sent - lost
                parts.append(f'{l}={100 * lost / sent:.1f}%loss/{(tot / got if got else 0):.0f}ms'
                             f'/max{mx:.0f}' if sent else f'{l}=-')
            self.event('HOURLY ' + '  '.join(parts))
            self.stats = {}
        self.hour = h

    def step(self, t, rtts, dns):
        for l, ip, _ in self.targets:
            r = rtts[ip]
            sent, lost, tot, mx = self.stats.get(ip, (0, 0, 0.0, 0.0))
            self.stats[ip] = (sent + 1, lost + (r is None), tot + (r or 0), max(mx, r or 0))
            if r is None:
                self.fails[ip] += 1
                if self.fails[ip] == 1:
                    self.first_fail[ip] = t
                if self.fails[ip] == DOWN_AFTER:
                    self.down.add(ip)
                    self.event(f'DOWN  {l} {ip}')
            else:
                if ip in self.down:
                    secs = (t - self.first_fail[ip]).total_seconds()
                    self.event(f'UP    {l} {ip}  after {secs:.0f}s ({self.fails[ip]} lost)')
                    self.down.discard(ip)
                self.fails[ip] = 0

        inet_ok = dns is not None or any(rtts[ip] is not None for _, ip, _ in self.inet)
        if self.outage:
            self.outage['n'] += 1
            for _, ip, _ in self.targets:
                self.outage['lost'][ip] += rtts[ip] is None
            if inet_ok:
                o = self.outage
                secs = (t - o['start']).total_seconds()
                lossp = {ip: 100 * o['lost'][ip] / o['n'] for _, ip, _ in self.targets}
                brk = next((f'{l}({ip})' for l, ip, _ in self.targets if lossp[ip] >= 50), 'unclear')
                last_ok = [l for l, ip, _ in self.hops if lossp[ip] < 50]
                self.event(f'OUTAGE END  duration={secs:.0f}s  break={brk}  last_good='
                           f'{last_ok[-1] if last_ok else "none"}  loss: ' +
                           '  '.join(f'{l}={lossp[ip]:.0f}%' for l, ip, _ in self.targets) +
                           f'  wifi_dbm={o["sig"]}')
                self.outage = None
                self.inet_fails = 0
        else:
            self.inet_fails = 0 if inet_ok else self.inet_fails + 1
            if self.inet_fails == DOWN_AFTER:
                start = min(self.first_fail.get(ip, t) for _, ip, _ in self.inet)
                self.outage = {'start': start, 'n': 0, 'lost': {ip: 0 for _, ip, _ in self.targets},
                               'sig': wifi_signal(self.iface) if self.iface else None}
                self.event(f'OUTAGE START  {self.status_line(rtts)}  dns={"ok" if dns else "LOST"}')
                self.bg_trace('during outage')
                threading.Thread(target=self.check_wifi, daemon=True).start()

    def run(self):
        a = self.args
        self.event(f'START monitoring every {a.interval}s, iface {self.iface}: ' +
                   '  '.join(f'{l}={ip}' for l, ip, _ in self.targets))
        pool = ThreadPoolExecutor(max_workers=1)
        next_t = time.monotonic()
        last_wifi = last_trace = 0.0
        while True:
            next_t += a.interval
            t = now()
            mono = time.monotonic()
            dns_f = pool.submit(dns_query, a.dns)
            rtts = ping_all([ip for _, ip, _ in self.targets])
            dns = dns_f.result()
            if not self.iface:
                # started before the network was up (e.g. at boot): keep looking
                _, self.iface = default_route()
                if self.iface:
                    self.event(f'IFACE detected {self.iface}')
            sig = wifi_signal(self.iface) if self.iface else None
            self.hourly(t)
            self.write_sample(t, rtts, dns, sig)
            self.step(t, rtts, dns)
            counters = link_counters(self.iface) if self.iface else None
            for line in self.slow.feed(t, {l: rtts[ip] for l, ip, _ in self.targets},
                                       dns is not None, sig, counters):
                self.event(line)
            if mono - last_wifi >= 10:
                last_wifi = mono
                self.check_wifi()
            if mono - last_trace >= 1800:
                last_trace = mono
                self.bg_trace('periodic')
            delay = next_t - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            else:
                next_t = time.monotonic()


def cmd_monitor(args):
    try:
        Monitor(args).run()
    except KeyboardInterrupt:
        pass


# ---------------------------------------------------------------- report

def cmd_report(args):
    path = os.path.join(args.logdir, 'events.log')
    if not os.path.exists(path):
        sys.exit(f'{path} not found')
    outages, by_break, wifi, slow = [], {}, [], []
    with open(path) as f:
        for line in f:
            if 'SLOW END' in line:
                slow.append(line.rstrip())
            elif 'OUTAGE END' in line:
                m = re.search(r'duration=(\d+)s\s+break=(\S+)', line)
                outages.append(line.rstrip())
                if m:
                    n, tot = by_break.get(m.group(2), (0, 0))
                    by_break[m.group(2)] = (n + 1, tot + int(m.group(1)))
            elif 'WIFI' in line:
                wifi.append(line.rstrip())
    print(f'{len(outages)} outage(s):')
    for o in outages:
        print(' ', o)
    if by_break:
        print('\nFirst hop that stopped answering:')
        for b, (n, tot) in sorted(by_break.items(), key=lambda x: -x[1][0]):
            print(f'  {b:<28} {n:>3} outage(s), {tot}s total')
    print(f'\n{len(slow)} slow episode(s) (internet median > {SLOW_MS}ms for {SLOW_WINDOW}s+):')
    print_slow(slow)
    if wifi:
        print(f'\nWi-Fi events ({len(wifi)}):')
        for w in wifi[-20:]:
            print(' ', w)


def print_slow(lines):
    by_origin, by_hour = collections.Counter(), collections.Counter()
    for line in lines:
        print(' ', line)
        m = re.search(r'origin=(\S+)', line)
        by_origin[m.group(1) if m else '?'] += 1
        m = re.search(r'start=\S+ (\d\d):', line)
        if m:
            by_hour[m.group(1)] += 1
    if by_origin:
        print('\nWhere slow episodes start (first hop = this machine\'s own link to it):')
        for o, n in by_origin.most_common():
            print(f'  {o:<20} {n}')
        print('By hour of day:  ' + '  '.join(f'{h}h:{n}' for h, n in sorted(by_hour.items())))


def cmd_scan(args):
    """Replay the samples CSVs through the slow-episode detector (works on old data too)."""
    det = SlowDetector(Monitor.load_targets(args))
    lines = []
    for path in sorted(glob.glob(os.path.join(args.logdir, 'samples-*.csv'))):
        day = os.path.basename(path)[8:18]
        with open(path) as f:
            for r in csv.DictReader(f):
                if r.get('time') in (None, 'time'):
                    continue
                t = dt.datetime.strptime(f'{day} {r["time"]}', '%Y-%m-%d %H:%M:%S')
                rtts = {l: float(r[l]) if r.get(l) else None for l in det.labels}
                sig = float(r['wifi_dbm']) if r.get('wifi_dbm') else None
                lines += [x for x in det.feed(t, rtts, bool(r.get('dns_ms')), sig) if 'SLOW END' in x]
    lines += det.flush()
    print(f'{len(lines)} slow episode(s) in the samples:')
    print_slow(lines)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--logdir', default=os.path.expanduser('~/netwatch-logs'))
    p.add_argument('--dest', default='8.8.8.8', help='main destination (default 8.8.8.8)')
    p.add_argument('--alt', default='1.1.1.1', help='second destination (default 1.1.1.1)')
    p.add_argument('--dns', default='8.8.8.8', help='DNS server to query each tick')
    p.add_argument('--interval', type=float, default=1.0, help='seconds between probes')
    p.add_argument('command', choices=['discover', 'monitor', 'report', 'scan'])
    args = p.parse_args()
    {'discover': cmd_discover, 'monitor': cmd_monitor, 'report': cmd_report,
     'scan': cmd_scan}[args.command](args)


if __name__ == '__main__':
    main()
