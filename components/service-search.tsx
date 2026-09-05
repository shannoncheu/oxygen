'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import type { ServiceDefinition } from '@/lib/catalog';
import { Logo } from './shared';

export async function discoverService(query: string, signal?: AbortSignal) {
  const response = await fetch('/api/services/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'subscribo' },
    body: JSON.stringify({ query }),
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '暂时无法获取图标，请填写官网或上传图片。');
  return result as { service: ServiceDefinition; source: string; sourceLabel: string };
}

export function ServiceSearch({
  query,
  enabled,
  onPick,
}: {
  query: string;
  enabled: boolean;
  onPick: (service: ServiceDefinition) => void;
}) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof discoverService>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setResult(null);
    setError('');
    setBusy(false);
    if (!enabled || query.trim().length < 2) return;
    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const found = await discoverService(query.trim(), controller.signal);
        if (!controller.signal.aborted) setResult(found);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 650);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, enabled]);
  if (!enabled || query.trim().length < 2) return null;
  return (
    <div className="service-discovery" aria-live="polite">
      {busy && (
        <p className="muted discovery-status">
          <LoaderCircle className="spin" size={16} />
          正在查找应用和图标…
        </p>
      )}
      {error && <p className="muted small">{error}</p>}
      {result && (
        <button className="discovered-service" onClick={() => onPick(result.service)}>
          <Logo
            name={result.service.name}
            logo={result.service.logo}
            color={result.service.color}
          />
          <span>
            <strong>{result.service.name}</strong>
            <small>
              {result.sourceLabel} · {new URL(result.service.website).hostname}
            </small>
          </span>
          <ArrowUpRight size={18} />
        </button>
      )}
    </div>
  );
}
