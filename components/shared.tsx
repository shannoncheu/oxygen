'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Plus } from 'lucide-react';
import { OxygenMark } from './brand';
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from 'react';
import type { Action, BusinessData, Currency, Subscription } from '@/lib/model';
import { formatMoney } from '@/lib/billing';
export type Act = (type: string, payload: Action['payload']) => Promise<void>;
export type DataProps = {
  data: BusinessData;
  act: Act;
  today: string;
  openSubscription: (s?: Subscription) => void;
};
export const currencies: Currency[] = [
  'CNY',
  'USD',
  'EUR',
  'GBP',
  'HKD',
  'TWD',
  'JPY',
  'KRW',
  'KWD',
];
export const statusLabels: Record<string, string> = {
  active: '启用中',
  trial: '试用中',
  paused: '已暂停',
  cancelled: '已停止续费',
  archived: '已归档',
  pending: '待确认',
  paid: '已记录付款',
  skipped: '已跳过',
};
export function cycleLabel(s: Pick<Subscription, 'interval' | 'unit'>) {
  const names = { day: '天', week: '周', month: '月', year: '年' };
  return s.interval === 1 ? `每${names[s.unit]}` : `每 ${s.interval} ${names[s.unit]}`;
}
export function displayDate(s: string) {
  return s ? s.slice(5).replace('-', '月') + '日' : '—';
}
export function dayDiff(from: string, to: string) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}
export function offsetDay(s: string, n: number) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  return { from: month + '-01', to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
export function Logo({
  name,
  logo,
  color,
  size = 44,
}: {
  name: string;
  logo?: string;
  color?: string;
  size?: number;
}) {
  const [failedLogo, setFailedLogo] = useState('');
  return (
    <span
      className="service-logo"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: color ? `${color}16` : undefined,
        color: color || 'var(--accent)',
      }}
    >
      {logo && logo !== failedLogo ? (
        <img
          src={logo}
          alt=""
          width={size * 0.57}
          height={size * 0.57}
          onError={() => setFailedLogo(logo)}
        />
      ) : (
        <span>{name.slice(0, 2).toUpperCase()}</span>
      )}
    </span>
  );
}
export function Avatar({ seed, name, size = 36 }: { seed: string; name: string; size?: number }) {
  return (
    <img
      className="avatar"
      width={size}
      height={size}
      alt={name}
      title={name}
      src={`/api/avatar/${encodeURIComponent(seed)}`}
    />
  );
}
export function Money({
  amount,
  currency,
  className = '',
}: {
  amount: number;
  currency: Currency;
  className?: string;
}) {
  return <span className={`money ${className}`}>{formatMoney(amount, currency)}</span>;
}
export function Amounts({
  values,
  empty = '暂无计划支出',
}: {
  values: Partial<Record<Currency, number>>;
  empty?: string;
}) {
  const entries = Object.entries(values) as [Currency, number][];
  return entries.length ? (
    <span className="amounts">
      {entries.map(([c, v]) => (
        <span key={c}>
          <Money amount={v} currency={c} />
          <small>{c}</small>
        </span>
      ))}
    </span>
  ) : (
    <span className="zero-text">{empty}</span>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          ref={content}
          className={`dialog-content ${wide ? 'wide' : ''}`}
          aria-describedby={description ? 'dialog-description' : undefined}
          onOpenAutoFocus={(event) => {
            if (window.matchMedia('(max-width: 700px), (pointer: coarse)').matches) {
              event.preventDefault();
              content.current?.focus({ preventScroll: true });
            }
          }}
        >
          <div className="dialog-handle" />
          <div className="dialog-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && (
                <Dialog.Description id="dialog-description">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭">
              <X size={21} />
            </Dialog.Close>
          </div>
          <div className="dialog-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Empty({
  title,
  description,
  action,
  label = '添加订阅',
}: {
  title: string;
  description: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <OxygenMark size={34} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <button className="button primary" onClick={action}>
          <Plus size={17} />
          {label}
        </button>
      )}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  function associate(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (node) => {
      if (!isValidElement(node)) return node;
      const el = node as ReactElement<any>;
      if (['input', 'select', 'textarea'].includes(el.type as string))
        return cloneElement(el, { id, 'aria-describedby': hint ? id + '-hint' : undefined });
      return el.props.children ? cloneElement(el, {}, associate(el.props.children)) : el;
    });
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {associate(children)}
      {hint && (
        <span id={id + '-hint'} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return <p className="notice">{children}</p>;
}
export function SubmitBar({
  busy,
  label = '保存',
  onCancel,
}: {
  busy: boolean;
  label?: string;
  onCancel: () => void;
}) {
  return (
    <div className="submit-bar">
      <button type="button" className="button" onClick={onCancel}>
        取消
      </button>
      <button type="submit" className="button primary" disabled={busy}>
        {busy ? '正在保存…' : label}
      </button>
    </div>
  );
}
