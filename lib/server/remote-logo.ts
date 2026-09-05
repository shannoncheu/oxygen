import sharp from 'sharp';
import { services, type ServiceDefinition } from '../catalog';
import { APIError } from './errors';
import { normalizeImage, saveUpload, MAX_IMAGE_BYTES } from './uploads';
import { publicFetch, publicURL } from './safe-public-fetch';

export interface ServiceDiscovery {
  service: ServiceDefinition;
  source: 'catalog' | 'website' | 'search';
  sourceLabel: string;
}
const normalized = (value: string) => value.toLocaleLowerCase().replace(/[\s+._-]/g, '');
const failure = () =>
  new APIError(422, '没有找到可用的 Logo。可以粘贴 App 官网地址重试，或手动上传图片。');
const slots = new Map<string, { since: number; count: number }>();
let active = 0;

export function matchCatalog(query: string): ServiceDefinition | undefined {
  const term = normalized(query);
  const exact = services.find((service) =>
    [service.id, service.name, ...service.aliases].some((name) => normalized(name) === term),
  );
  if (exact) return exact;
  try {
    const url = publicURL(/^https?:\/\//i.test(query) ? query : 'https://' + query);
    return [...services]
      .sort((a, b) => new URL(b.website).pathname.length - new URL(a.website).pathname.length)
      .find((service) => {
        const known = new URL(service.website);
        return (
          url.hostname.replace(/^www\./, '') === known.hostname.replace(/^www\./, '') &&
          (known.pathname === '/' ||
            url.pathname === known.pathname ||
            url.pathname.startsWith(known.pathname.replace(/\/$/, '') + '/'))
        );
      });
  } catch {
    return undefined;
  }
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d{1,7}|#x[\da-f]{1,6});/gi, (entity) => {
    const named: Record<string, string> = {
      '&amp;': '&',
      '&quot;': '"',
      '&apos;': "'",
      '&lt;': '<',
      '&gt;': '>',
    };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const number =
      entity[2].toLowerCase() === 'x'
        ? parseInt(entity.slice(3, -1), 16)
        : Number(entity.slice(2, -1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  });
}
function attributes(tag: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const entry of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
    values[entry[1].toLowerCase()] = decodeEntities(entry[2] ?? entry[3] ?? entry[4] ?? '');
  return values;
}

export function websiteMetadata(html: string, base: string) {
  const icons: { url: string; priority: number }[] = [];
  let name = '';
  for (const tag of html.match(/<(?:link|meta)\b[^>]{0,4096}>/gi) || []) {
    const attr = attributes(tag);
    if (attr.content && ['og:site_name', 'application-name'].includes(attr.property || attr.name))
      name ||= attr.content;
    if (
      !attr.href ||
      !/(?:^|\s)(?:icon|apple-touch-icon|apple-touch-icon-precomposed)(?:\s|$)/i.test(
        attr.rel || '',
      )
    )
      continue;
    try {
      const url = publicURL(attr.href, base).href;
      const size = Math.min(512, parseInt(attr.sizes || '0') || 0);
      const priority = /apple-touch-icon/.test(attr.rel)
        ? 1000 + size
        : /svg/.test(attr.type || '')
          ? 800
          : size;
      icons.push({ url, priority });
    } catch {
      /* An invalid icon must not hide other usable icons. */
    }
  }
  if (!name)
    name = decodeEntities(html.match(/<title\b[^>]*>([^<]{1,300})<\/title>/i)?.[1] || '')
      .split(/[|–—]/)[0]
      .trim();
  const fallback = publicURL('/favicon.ico', base).href;
  return {
    name:
      name
        .replace(/[\u0000-\u001f<>]/g, '')
        .trim()
        .slice(0, 80) || new URL(base).hostname.replace(/^www\./, ''),
    icons: [
      ...new Set([
        ...icons.sort((a, b) => b.priority - a.priority).map((icon) => icon.url),
        fallback,
      ]),
    ].slice(0, 4),
  };
}

/** Allow only self-contained geometric SVGs; never hand external references to librsvg. */
export function safeSVG(input: string): Buffer {
  const value = input.replace(/^\s*<\?xml[^?]*\?>/i, '').trim();
  if (
    value.length > 256000 ||
    !/^<svg(?:\s|>)/i.test(value) ||
    /<!|<\?|&|[\u0000-\u0008]/.test(value)
  )
    throw failure();
  const tags = new Set([
    'svg',
    'g',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'defs',
    'lineargradient',
    'radialgradient',
    'stop',
    'clippath',
    'mask',
    'title',
    'desc',
  ]);
  const allowed = new Set([
    'xmlns',
    'viewbox',
    'width',
    'height',
    'x',
    'y',
    'x1',
    'x2',
    'y1',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'd',
    'points',
    'fill',
    'fill-rule',
    'fill-opacity',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-opacity',
    'opacity',
    'transform',
    'id',
    'clip-path',
    'clip-rule',
    'offset',
    'stop-color',
    'stop-opacity',
    'gradientunits',
    'gradienttransform',
    'spreadmethod',
    'maskunits',
    'maskcontentunits',
    'preserveaspectratio',
  ]);
  for (const tag of value.match(/<[^>]*>/g) || []) {
    const match = tag.match(/^<\/?([\w-]+)\b([^>]*?)\/?\s*>$/);
    if (!match || !tags.has(match[1].toLowerCase())) throw failure();
    const rest = match[2].replace(
      /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
      (_all, key: string, double: string, single: string) => {
        const content = double ?? single;
        if (
          !allowed.has(key.toLowerCase()) ||
          /[<>\\]/.test(content) ||
          (key.toLowerCase() === 'xmlns' && content !== 'http://www.w3.org/2000/svg') ||
          (/url\s*\(/i.test(content) && !/^url\(#[a-z\d_-]+\)$/i.test(content))
        )
          throw failure();
        return '';
      },
    );
    if (rest.trim()) throw failure();
  }
  return Buffer.from(value);
}

export async function normalizeRemoteIcon(input: Buffer): Promise<Buffer> {
  if (!input.length || input.length > MAX_IMAGE_BYTES) throw failure();
  let data = input;
  if (/^\s*(?:<\?xml[^?]*\?>\s*)?<svg[\s>]/i.test(data.toString('utf8', 0, 300))) {
    const svg = safeSVG(data.toString('utf8'));
    try {
      const png = await sharp(svg, { limitInputPixels: 16000000, density: 144 })
        .resize({ width: 512, height: 512, fit: 'inside' })
        .timeout({ seconds: 5 })
        .png()
        .toBuffer();
      return normalizeImage(png);
    } catch {
      throw failure();
    }
  }
  // ICO files can wrap PNG images. Prefer the largest embedded PNG and ignore unsupported DIB entries.
  if (data.length >= 6 && data.readUInt32LE(0) === 0x00010000) {
    const count = data.readUInt16LE(4);
    if (count > 256 || data.length < 6 + 16 * count) throw failure();
    const candidates: { size: number; bytes: Buffer }[] = [];
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16,
        length = data.readUInt32LE(entry + 8),
        offset = data.readUInt32LE(entry + 12);
      if (length < 8 || offset < 6 + 16 * count || offset + length > data.length) continue;
      const bytes = data.subarray(offset, offset + length);
      if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        candidates.push({ size: data[entry] || 256, bytes });
    }
    data = candidates.sort((a, b) => b.size - a.size)[0]?.bytes || Buffer.alloc(0);
    if (!data.length) throw failure();
  }
  const png =
    data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const webp =
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP';
  // Do not let sharp sniff SVGZ, UTF-16 SVG, PDF or other formats before the SVG gate.
  if (!png && !jpeg && !webp) throw failure();
  return normalizeImage(data);
}

function remoteDefinition(name: string, website: string, logo: string): ServiceDefinition {
  return {
    id: 'custom',
    name,
    aliases: [],
    color: '#8B7CF8',
    category: '其他',
    website,
    logo,
    logoType: 'brand',
  };
}

async function fromWebsite(
  query: string,
  ownerId: string,
  deadline: number,
): Promise<ServiceDiscovery> {
  const requested = publicURL(/^https?:\/\//i.test(query) ? query : 'https://' + query);
  let website = requested.href;
  let metadata = websiteMetadata('', website);
  try {
    const page = await publicFetch(requested.href, {
      maxBytes: 1024 * 1024,
      deadline,
      accept: 'text/html,application/xhtml+xml',
      headOnly: true,
    });
    if (['text/html', 'application/xhtml+xml', ''].includes(page.contentType)) {
      website = page.url;
      metadata = websiteMetadata(page.body.toString('utf8'), page.url);
    }
  } catch (error) {
    if (!(error instanceof APIError)) throw error;
  }
  for (const icon of metadata.icons) {
    if (Date.now() >= deadline) break;
    try {
      const response = await publicFetch(icon, {
        maxBytes: MAX_IMAGE_BYTES,
        deadline,
        accept: 'image/*',
      });
      const png = await normalizeRemoteIcon(response.body);
      const saved = await saveUpload(ownerId, png);
      return {
        service: remoteDefinition(metadata.name, website, saved.url),
        source: 'website',
        sourceLabel: new URL(website).hostname,
      };
    } catch (error) {
      if (!(error instanceof APIError)) throw error;
    }
  }
  throw failure();
}

interface StoreApp {
  trackName?: string;
  sellerName?: string;
  sellerUrl?: string;
  artworkUrl512?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
}
export function appMatchesQuery(name: string, query: string): boolean {
  return (
    normalized(name) === normalized(query) ||
    normalized(name.split(/[:：–—]|\s-\s/)[0]) === normalized(query)
  );
}
async function fromSearch(
  query: string,
  ownerId: string,
  deadline: number,
): Promise<ServiceDiscovery> {
  const search = new URL('https://itunes.apple.com/search');
  search.search = new URLSearchParams({
    term: query,
    media: 'software',
    entity: 'software',
    limit: '8',
    country: /[\u3400-\u9fff]/.test(query) ? 'cn' : 'us',
  }).toString();
  const response = await publicFetch(search.href, {
    maxBytes: 512 * 1024,
    deadline,
    accept: 'application/json',
  });
  let apps: StoreApp[];
  try {
    apps = JSON.parse(response.body.toString('utf8')).results;
  } catch {
    throw failure();
  }
  if (!Array.isArray(apps)) throw failure();
  const matches = apps
    .slice(0, 8)
    .filter((app) => typeof app?.trackName === 'string' && appMatchesQuery(app.trackName, query));
  if (matches.length !== 1) throw new APIError(422, '搜索结果不明确，请粘贴这个 App 的官网地址。');
  const app = matches[0];
  const artwork = app.artworkUrl512 || app.artworkUrl100;
  if (typeof artwork !== 'string' || typeof app.trackViewUrl !== 'string') throw failure();
  // Store artwork and links must really belong to Apple's catalog/CDN.
  const imageURL = publicURL(artwork),
    listing = publicURL(app.trackViewUrl);
  if (!imageURL.hostname.endsWith('.mzstatic.com') || listing.hostname !== 'apps.apple.com')
    throw failure();
  const icon = await publicFetch(imageURL.href, {
    maxBytes: MAX_IMAGE_BYTES,
    deadline,
    accept: 'image/*',
  });
  const saved = await saveUpload(ownerId, await normalizeRemoteIcon(icon.body));
  let website = listing.href;
  if (typeof app.sellerUrl === 'string') {
    try {
      website = publicURL(app.sellerUrl).href;
    } catch {
      /* Keep the verified store link. */
    }
  }
  return {
    service: remoteDefinition(app.trackName!.slice(0, 80), website, saved.url),
    source: 'search',
    sourceLabel: `App Store · ${String(app.sellerName || app.trackName).slice(0, 100)}`,
  };
}

export async function discoverService(query: unknown, ownerId: string): Promise<ServiceDiscovery> {
  if (typeof query !== 'string' || !query.trim() || query.length > 2048)
    throw new APIError(400, '请输入 App 名称或官网地址。');
  query = query.trim();
  const found = matchCatalog(query as string);
  if (found) return { service: found, source: 'catalog', sourceLabel: '内置目录' };
  const now = Date.now();
  for (const [key, value] of slots) if (now - value.since >= 60000) slots.delete(key);
  const slot = slots.get(ownerId) || { since: now, count: 0 };
  if (slot.count >= 8 || slots.size >= 100 || active >= 2)
    throw new APIError(429, '查询较频繁，请稍后再试。');
  slot.count++;
  slots.set(ownerId, slot);
  active++;
  try {
    const value = query as string;
    const looksLikeURL = /^\w+:\/\//.test(value) || (!/\s/.test(value) && /[.:[\]]/.test(value));
    if (!looksLikeURL && value.length > 100)
      throw new APIError(400, 'App 名称不能超过 100 个字符。');
    return looksLikeURL
      ? await fromWebsite(value, ownerId, now + 18000)
      : await fromSearch(value, ownerId, now + 18000);
  } finally {
    active--;
  }
}
