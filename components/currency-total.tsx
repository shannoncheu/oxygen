'use client';
import type { Currency } from '@/lib/model';
import { formatMoney } from '@/lib/billing';
import {
  convertTotal,
  EXCHANGE_PROVIDER_URL,
  type ExchangeRates,
  type ExchangeSettings,
} from '@/lib/exchange';

export function ExchangeAttribution() {
  return (
    <a
      className="exchange-attribution"
      href={EXCHANGE_PROVIDER_URL}
      target="_blank"
      rel="noreferrer"
    >
      汇率来源：ExchangeRate-API
    </a>
  );
}
export function CurrencyTotal({
  values,
  target = 'CNY',
  exchange,
  breakdown = true,
  className = '',
  empty,
}: {
  values: ExchangeRates;
  target?: Currency;
  exchange?: ExchangeSettings;
  breakdown?: boolean;
  className?: string;
  empty?: string;
}) {
  const total = convertTotal(values, target, exchange);
  const entries = Object.entries(values).filter(([, amount]) => amount !== 0) as [
    Currency,
    number,
  ][];
  return (
    <div className={`currency-total ${className}`}>
      <strong className="currency-total-value">
        {total.amountMinor === null
          ? '—'
          : !entries.length && empty
            ? empty
            : `${total.estimated ? '≈ ' : ''}${formatMoney(total.amountMinor, target)}`}
      </strong>
      {total.missing.length > 0 && (
        <span className="currency-total-warning" role="status">
          缺少 {total.missing.join('、')} 换算汇率，请到设置填写
          {total.partialMinor ? `；已换算 ${formatMoney(total.partialMinor, target)}` : ''}
        </span>
      )}
      {total.overflow && (
        <span className="currency-total-warning" role="status">
          金额超出可精确显示范围
        </span>
      )}
      {breakdown && entries.length > 0 && (entries.length > 1 || entries[0][0] !== target) && (
        <span className="currency-total-originals">
          {entries
            .map(([currency, amount]) => `${currency} ${formatMoney(amount, currency)}`)
            .join(' + ')}
        </span>
      )}
      {total.estimated && (
        <span className="currency-total-note">
          {total.stale ? '使用上次汇率 · ' : ''}
          {total.usedManual ? '含手动汇率 · ' : ''}折合 {target}，仅供参考
        </span>
      )}
      {total.usedProvider && <ExchangeAttribution />}
    </div>
  );
}
