import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

// SSRF-safe GET for user-supplied URLs. Every IP the hostname resolves to is
// checked at connect time (so DNS rebinding and "public name -> private IP"
// tricks don't work), redirects are re-validated hop by hop, and the body size
// is capped.

const blocked = new net.BlockList();
// IPv4
blocked.addSubnet('0.0.0.0', 8, 'ipv4');
blocked.addSubnet('10.0.0.0', 8, 'ipv4');
blocked.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT
blocked.addSubnet('127.0.0.0', 8, 'ipv4');
blocked.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local / cloud metadata
blocked.addSubnet('172.16.0.0', 12, 'ipv4');
blocked.addSubnet('192.0.0.0', 24, 'ipv4');
blocked.addSubnet('192.168.0.0', 16, 'ipv4');
blocked.addSubnet('198.18.0.0', 15, 'ipv4');
blocked.addSubnet('224.0.0.0', 3, 'ipv4'); // multicast + reserved
// IPv6
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6'); // unique local
blocked.addSubnet('fe80::', 10, 'ipv6'); // link-local
blocked.addSubnet('ff00::', 8, 'ipv6'); // multicast
blocked.addSubnet('64:ff9b::', 96, 'ipv6'); // NAT64

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d or ::ffff:abcd:ef01) -> check the IPv4 part
    const mapped = lower.match(/^::ffff:(?:0:)?(.+)$/);
    if (mapped) {
      const tail = mapped[1];
      if (net.isIPv4(tail)) return blocked.check(tail, 'ipv4');
      const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
        const v4 = [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
        return blocked.check(v4, 'ipv4');
      }
      return true;
    }
    return blocked.check(lower, 'ipv6');
  }
  return true;
}

const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (!list.length || bad) {
      return callback(new Error('That URL is not allowed'), '', 4);
    }
    if ((options as dns.LookupOptions).all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

function parseAllowedUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('That URL is not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  // IP literals skip DNS lookup entirely, so check them here.
  if (net.isIP(host) && isBlockedIp(host)) throw new Error('That URL is not allowed');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('That URL is not allowed');
  return u;
}

function getOnce(u: URL, maxBytes: number, timeoutMs: number): Promise<{ status: number; location?: string; body: string }> {
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(
      u,
      {
        lookup: safeLookup,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobFinder/1.0)', Accept: 'text/html,text/plain,*/*' },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location, body: '' });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new Error('Page is too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf-8') }));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

export async function safeFetchText(
  raw: string,
  { maxBytes = 2_000_000, timeoutMs = 15000, maxRedirects = 3 } = {}
): Promise<string> {
  let u = parseAllowedUrl(raw);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await getOnce(u, maxBytes, timeoutMs);
    if (res.location) {
      u = parseAllowedUrl(new URL(res.location, u).toString());
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`Failed to fetch (${res.status})`);
    return res.body;
  }
  throw new Error('Too many redirects');
}
