import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { isPublicAddress, publicURL, publicFetch } from '../lib/server/safe-public-fetch';
import {
  appMatchesQuery,
  normalizeRemoteIcon,
  safeSVG,
  websiteMetadata,
} from '../lib/server/remote-logo';

test('remote icon URLs reject local, reserved, credentials and non-web schemes', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.1.3',
    '172.31.4.5',
    '192.168.0.1',
    '169.254.169.254',
    '100.100.100.200',
    '0.0.0.0',
    '224.0.0.1',
    '198.18.0.1',
    '192.0.2.1',
    '203.0.113.2',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '2001:0::1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111'])
    assert.equal(isPublicAddress(address), true, address);
  for (const url of [
    'file:///etc/passwd',
    'ftp://public.com/a',
    'http://localhost/',
    'http://server.local/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://[::1]/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'https://user:pass@public.com/',
    'http://public.com:3000/',
    'http://169.254.169.254/latest/meta-data',
  ])
    assert.throws(() => publicURL(url), url);
  assert.equal(
    publicURL('/icon.png', 'https://example.org/abc').href,
    'https://example.org/icon.png',
  );
});

test('connections use the checked DNS address and redirects revalidate targets', async (t) => {
  let resolutions = 0,
    requests = 0;
  t.mock.method(dns, 'lookup', async () => {
    resolutions++;
    return [{ address: '93.184.216.34', family: 4 }];
  });
  t.mock.method(
    https,
    'request',
    (url: URL, options: https.RequestOptions, handler: (res: unknown) => void) => {
      requests++;
      assert.equal(url.hostname, 'example.org');
      assert.equal(options.agent, false);
      assert.equal(options.family, 4);
      options.lookup!('example.org', { all: true }, (_err, addresses) =>
        assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]),
      );
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.destroy = () => {
        req.emit('close');
      };
      req.end = () => {
        const res = Object.assign(new PassThrough(), {
          statusCode: 302,
          headers: { location: 'http://127.0.0.1/private' },
        });
        handler(res);
        req.emit('close');
      };
      return req;
    },
  );
  await assert.rejects(publicFetch('https://example.org/'));
  assert.equal(resolutions, 1);
  assert.equal(requests, 1);
});

test('mixed public/private DNS answers are rejected before connecting', async (t) => {
  t.mock.method(dns, 'lookup', async () => [
    { address: '1.1.1.1', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ]);
  let connections = 0;
  t.mock.method(https, 'request', () => {
    connections++;
    throw new Error('must not connect');
  });
  await assert.rejects(publicFetch('https://example.org/'));
  assert.equal(connections, 0);
});

test('a DNS rebind on a public-looking redirect is rejected', async (t) => {
  let resolutions = 0,
    requests = 0;
  t.mock.method(dns, 'lookup', async () => [
    { address: ++resolutions === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 },
  ]);
  t.mock.method(
    https,
    'request',
    (_url: URL, _options: https.RequestOptions, handler: (res: unknown) => void) => {
      requests++;
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.destroy = () => {
        req.emit('close');
      };
      req.end = () => {
        handler(
          Object.assign(new PassThrough(), {
            statusCode: 302,
            headers: { location: 'https://example.org/next' },
          }),
        );
        req.emit('close');
      };
      return req;
    },
  );
  await assert.rejects(publicFetch('https://example.org/'));
  assert.equal(resolutions, 2);
  assert.equal(requests, 1);
});

test('public fetch reads bounded headers without downloading the whole page', async (t) => {
  t.mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  t.mock.method(
    https,
    'request',
    (_url: URL, _options: https.RequestOptions, handler: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.destroy = () => {
        req.emit('close');
      };
      req.end = () => {
        const res = Object.assign(new PassThrough(), {
          statusCode: 200,
          headers: { 'content-type': 'text/html', 'content-length': '9999999' },
        });
        res.on('close', () => req.emit('close'));
        handler(res);
        res.write('<html><head><title>Example</title></he');
        res.write('ad>');
      };
      return req;
    },
  );
  const response = await publicFetch('https://example.org/', { maxBytes: 128, headOnly: true });
  assert.equal(response.contentType, 'text/html');
  assert.equal(response.body.toString(), '<html><head><title>Example</title></head>');
});

test('streamed responses cannot exceed the byte budget', async (t) => {
  t.mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  t.mock.method(
    https,
    'request',
    (_url: URL, _options: https.RequestOptions, handler: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.destroy = () => {
        req.emit('close');
      };
      req.end = () => {
        const res = Object.assign(new PassThrough(), {
          statusCode: 200,
          headers: { 'content-type': 'image/png' },
        });
        res.on('close', () => req.emit('close'));
        handler(res);
        res.end(Buffer.alloc(129));
      };
      return req;
    },
  );
  await assert.rejects(publicFetch('https://example.org/', { maxBytes: 128 }));
});

test('compressed private IPv6 DNS answers never open a connection', async (t) => {
  let connections = 0;
  t.mock.method(https, 'request', () => {
    connections++;
    throw new Error('must not connect');
  });
  for (const address of ['::1', '::', '::ffff:7f00:1', '::ffff:127.0.0.1']) {
    const mocked = t.mock.method(dns, 'lookup', async () => [{ address, family: 6 }]);
    await assert.rejects(publicFetch('https://example.org/'));
    mocked.mock.restore();
  }
  assert.equal(connections, 0);
});

test('website icon extraction handles relative paths and prefers larger touch icons', () => {
  const meta = websiteMetadata(
    `<meta property="og:site_name" content="A &amp; B"><link href="/favicon.ico" rel="shortcut icon"><link sizes="180x180" rel="apple-touch-icon" href="assets/icon.png"><link rel="icon" href="http://127.0.0.1/private">`,
    'https://example.org/app/',
  );
  assert.equal(meta.name, 'A & B');
  assert.equal(meta.icons[0], 'https://example.org/app/assets/icon.png');
  assert.equal(
    meta.icons.some((icon) => icon.includes('127.0.0.1')),
    false,
  );
});

test('remote SVG rasterization rejects active/external content and stores actual PNG pixels', async () => {
  for (const source of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://internal/)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "http://internal";</style></svg>',
    '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
  ])
    assert.throws(() => safeSVG(source));
  const png = await normalizeRemoteIcon(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#aabbcc"/></svg>',
    ),
  );
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 512);
  await assert.rejects(normalizeRemoteIcon(Buffer.from('not an image')));
  const active = '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>';
  await assert.rejects(normalizeRemoteIcon(gzipSync(Buffer.from(active))));
  await assert.rejects(normalizeRemoteIcon(Buffer.from(active, 'utf16le')));
  await assert.rejects(normalizeRemoteIcon(Buffer.from('<!-- hide svg -->' + active)));
});

test('App Store search does not accept loosely related names', () => {
  assert.equal(appMatchesQuery('Things 3', 'things 3'), true);
  assert.equal(appMatchesQuery('Things 3: Task Manager', 'Things 3'), true);
  assert.equal(appMatchesQuery('Things 3 Fake GPT', 'Things 3'), false);
  assert.equal(appMatchesQuery('Not ChatGPT', 'ChatGPT'), false);
});
