import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { APIError } from './errors';

const unavailable = () => new APIError(422, '无法读取这个网站，请检查官网地址，或手动上传 Logo。');

/** Conservative public-address allowlist. IPv4-mapped IPv6 and transition ranges are rejected. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99) || (b === 0 && c === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6) return false;
  const lowered = address.toLowerCase();
  const first = parseInt(lowered.split(':')[0], 16);
  if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return false;
  // Exclude IETF protocol-assignment space, documentation and 6to4 relays.
  if (first === 0x2002 || first === 0x3fff) return false;
  if (first === 0x2001) {
    const second = parseInt(lowered.split(':')[1] || '0', 16);
    if (second < 0x200 || second === 0xdb8) return false;
  }
  return true;
}

export function publicURL(input: string, base?: string): URL {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    throw unavailable();
  }
  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (
    url.href.length > 2048 ||
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port)) ||
    !hostname ||
    (!hostname.includes('.') && !isIP(hostname)) ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(hostname) ||
    (isIP(hostname) && !isPublicAddress(hostname))
  )
    throw unavailable();
  url.hash = '';
  return url;
}

export interface PublicResponse {
  url: string;
  body: Buffer;
  contentType: string;
}

export async function publicFetch(
  input: string,
  options: { maxBytes?: number; deadline?: number; accept?: string; headOnly?: boolean } = {},
): Promise<PublicResponse> {
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const deadline = Math.min(options.deadline ?? Date.now() + 12000, Date.now() + 12000);
  let url = publicURL(input);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const remaining = Math.min(6000, deadline - Date.now());
    if (remaining <= 0) throw unavailable();
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      isIP(hostname)
        ? Promise.resolve([{ address: hostname, family: isIP(hostname) }])
        : lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(() => reject(unavailable()), remaining);
      }),
    ])
      .catch(() => {
        throw unavailable();
      })
      .finally(() => clearTimeout(dnsTimer));
    if (
      !addresses.length ||
      addresses.length > 32 ||
      addresses.some(({ address }) => !isPublicAddress(address))
    )
      throw unavailable();
    const pinned = addresses.find(({ family }) => family === 4) || addresses[0];
    const response = await new Promise<{
      status: number;
      location?: string;
      body: Buffer;
      contentType: string;
    }>((resolve, reject) => {
      const requestOptions: RequestOptions = {
        method: 'GET',
        agent: false,
        family: pinned.family,
        maxHeaderSize: 16384,
        // The socket must use the checked address. Never perform a second DNS lookup.
        lookup: (_name, lookupOptions, callback) => {
          if (lookupOptions.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
        headers: {
          Accept: options.accept || '*/*',
          'Accept-Encoding': 'identity',
          'User-Agent': 'oxygen/1.0 (subscription logo lookup)',
        },
      };
      const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = transport(url, requestOptions, (res) => {
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.destroy();
          resolve({
            status,
            location: res.headers.location,
            body: Buffer.alloc(0),
            contentType: '',
          });
          return;
        }
        if (
          status < 200 ||
          status >= 300 ||
          (!options.headOnly && Number(res.headers['content-length'] || 0) > maxBytes) ||
          (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')
        ) {
          res.destroy();
          reject(unavailable());
          return;
        }
        const parts: Buffer[] = [];
        let size = 0;
        let tail = '';
        res.on('data', (part: Buffer) => {
          size += part.length;
          if (size > maxBytes) {
            res.destroy();
            reject(unavailable());
          } else {
            parts.push(part);
            if (options.headOnly) {
              const text = tail + part.toString('utf8');
              if (/<\/head\s*>/i.test(text)) {
                resolve({
                  status,
                  body: Buffer.concat(parts),
                  contentType: String(res.headers['content-type'] || '')
                    .split(';')[0]
                    .toLowerCase(),
                });
                res.destroy();
              }
              tail = text.slice(-32);
            }
          }
        });
        res.on('end', () =>
          resolve({
            status,
            body: Buffer.concat(parts),
            contentType: String(res.headers['content-type'] || '')
              .split(';')[0]
              .toLowerCase(),
          }),
        );
        res.on('error', () => reject(unavailable()));
        res.on('aborted', () => reject(unavailable()));
      });
      const timer = setTimeout(
        () => req.destroy(unavailable()),
        Math.max(1, Math.min(6000, deadline - Date.now())),
      );
      req.on('error', () => reject(unavailable()));
      req.on('close', () => clearTimeout(timer));
      req.end();
    });
    if (response.location) {
      if (redirect === 3) throw unavailable();
      url = publicURL(response.location, url.href);
      continue;
    }
    if (response.status >= 300) throw unavailable();
    return { url: url.href, body: response.body, contentType: response.contentType };
  }
  throw unavailable();
}
