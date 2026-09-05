'use client';
import { useState } from 'react';
import { RefreshCw, ArrowLeftRight } from 'lucide-react';
import {
  EXCHANGE_CURRENCIES,
  isSnapshotStale,
  validateExchangeSnapshot,
  type ExchangeSettings as ExchangeSettingsType,
  type ExchangeSnapshot,
} from '@/lib/exchange';
import { ExchangeAttribution } from './currency-total';

export function ExchangeSettings({
  value,
  onChange,
  onRefresh,
}: {
  value: ExchangeSettingsType;
  onChange: (value: ExchangeSettingsType) => void;
  onRefresh?: () => Promise<ExchangeSnapshot | null>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      let snapshot: ExchangeSnapshot | null;
      if (onRefresh) {
        // The parent persists the snapshot and merges it into the current draft.
        // Avoid replacing manual edits made while the request was in flight.
        await onRefresh();
        return;
      } else {
        const response = await fetch('/api/exchange', { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || result.error) throw Error(result.error || '汇率更新失败');
        snapshot = result.snapshot ? validateExchangeSnapshot(result.snapshot) : null;
      }
      if (snapshot) onChange({ ...value, snapshot });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel exchange-settings">
      <div className="section-heading">
        <h2>
          <ArrowLeftRight size={19} />
          汇率
        </h2>
        <button type="button" className="button" onClick={refresh} disabled={busy}>
          <RefreshCw size={15} className={busy ? 'spin' : ''} />
          {busy ? '更新中…' : '更新汇率'}
        </button>
      </div>
      <div className="setting-row">
        <div>
          <strong>自动更新汇率</strong>
          <p>打开网站时检查更新，汇率每日发布一次。</p>
        </div>
        <input
          aria-label="自动更新汇率"
          type="checkbox"
          checked={value.autoUpdate}
          onChange={(e) => onChange({ ...value, autoUpdate: e.target.checked })}
        />
      </div>
      <p className="muted small">
        {value.snapshot
          ? `汇率日期 ${value.snapshot.updatedAt.slice(0, 10)}${isSnapshotStale(value.snapshot) ? ' · 待更新' : ''}`
          : '尚未获取汇率'}
        。美元、人民币等订阅按默认显示货币合计，原始金额保留。
      </p>
      <details className="manual-rates">
        <summary>手动汇率</summary>
        <p className="muted small">
          填写「1 单位外币 = 多少人民币」。填写后优先使用手动值，留空则使用自动汇率。
        </p>
        <div className="manual-rate-grid">
          {EXCHANGE_CURRENCIES.filter((currency) => currency !== 'CNY').map((currency) => (
            <label className="manual-rate-row" key={currency}>
              <span>1 {currency} =</span>
              <input
                type="number"
                step="any"
                min="0.00000001"
                max="100000000"
                aria-label={`${currency} 手动汇率（人民币）`}
                placeholder={
                  value.snapshot?.rates[currency]
                    ? String(Number(value.snapshot.rates[currency]!.toPrecision(7)))
                    : '待填写'
                }
                value={value.manualRates[currency] ?? ''}
                onChange={(e) => {
                  const manualRates = { ...value.manualRates };
                  if (e.target.value === '') delete manualRates[currency];
                  else manualRates[currency] = Number(e.target.value);
                  onChange({ ...value, manualRates });
                }}
              />
              <span>CNY</span>
            </label>
          ))}
        </div>
      </details>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="muted small">
        修改后点击下方「保存设置」。汇率用于支出估算，实际扣款以付款账单为准。
      </p>
      <ExchangeAttribution />
    </section>
  );
}
