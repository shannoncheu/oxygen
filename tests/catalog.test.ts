import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { services, searchServices } from '../lib/catalog';
import { matchCatalog } from '../lib/server/remote-logo';

test('AI names, common spellings and official URLs find the matching service locally', () => {
  for (const [query, id] of [
    ['GPT', 'chatgpt'],
    ['Chat GPT', 'chatgpt'],
    ['CLAUDED', 'claude'],
    ['Claude Code', 'claude'],
    ['Google AI Pro', 'gemini'],
    ['Copilot', 'github-copilot'],
    ['https://chatgpt.com/', 'chatgpt'],
    ['https://github.com/features/copilot', 'github-copilot'],
  ]) {
    assert.equal(matchCatalog(query)?.id, id, query);
    assert.ok(
      searchServices(query).some((item) => item.id === id),
      query,
    );
  }
});

test('catalog ships every referenced logo and contains no duplicated ids', () => {
  assert.equal(new Set(services.map((item) => item.id)).size, services.length);
  for (const service of services)
    assert.ok(existsSync(path.join(process.cwd(), 'public', service.logo)), service.logo);
  assert.ok(services.filter((service) => service.category === 'AI').length >= 12);
});
