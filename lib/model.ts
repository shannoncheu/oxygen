import type { ExchangeSettings } from './exchange';

export type Currency = 'CNY' | 'USD' | 'EUR' | 'GBP' | 'HKD' | 'TWD' | 'JPY' | 'KRW' | 'KWD';
export type CycleUnit = 'day' | 'week' | 'month' | 'year';
export type SubscriptionStatus = 'active' | 'trial' | 'paused' | 'cancelled' | 'archived';
export interface Subscription {
  id: string;
  name: string;
  serviceId: string;
  logo: string;
  color: string;
  category: string;
  plan: string;
  kind: 'personal' | 'family';
  amountMinor: number;
  currency: Currency;
  interval: number;
  unit: CycleUnit;
  anchorDate: string;
  billingStart: string;
  trialEnd: string;
  autoRenew: boolean;
  status: SubscriptionStatus;
  stopDate: string;
  notes: string;
  website: string;
  createdAt: string;
}
export interface FamilyGroup {
  id: string;
  subscriptionId: string;
  name: string;
  seats: number;
  splitMode: 'none' | 'equal' | 'custom';
  leaderId: string;
  notes: string;
}
export interface Member {
  id: string;
  nickname: string;
  seed: string;
  avatarStyle: 'thumbs';
  avatarVersion: string;
  contact: string;
  notes: string;
}
export interface Membership {
  id: string;
  groupId: string;
  memberId: string;
  role: 'leader' | 'member';
  joinedAt: string;
  leftAt: string;
  expiresAt: string;
  participates: boolean;
  customAmountMinor: number;
}
export interface Bill {
  id: string;
  subscriptionId: string;
  dueDate: string;
  periodEnd: string;
  name: string;
  category: string;
  serviceId: string;
  logo: string;
  color: string;
  amountMinor: number;
  currency: Currency;
  status: 'pending' | 'paid' | 'skipped';
  paidAt: string;
  note: string;
}
export interface Allocation {
  id: string;
  billId: string;
  memberId: string;
  nickname: string;
  seed: string;
  amountMinor: number;
  status: 'pending' | 'paid';
  paidAt: string;
}
export interface Settings {
  timezone: string;
  displayCurrency: Currency;
  theme: 'light' | 'dark' | 'system';
  categories: string[];
  reminderDays: number;
  avatarUrl?: string;
  avatarSeed?: string;
  exchange?: ExchangeSettings;
}
export interface BusinessData {
  settings: Settings;
  subscriptions: Subscription[];
  groups: FamilyGroup[];
  members: Member[];
  memberships: Membership[];
  bills: Bill[];
  allocations: Allocation[];
  revision: number;
}
export interface Action {
  type: string;
  payload: any;
  revision?: number;
}
export const defaultSettings: Settings = {
  timezone: 'Asia/Shanghai',
  displayCurrency: 'CNY',
  theme: 'system',
  categories: ['AI', '音乐', '视频', '效率', '云存储', '学习', '其他'],
  reminderDays: 7,
  avatarUrl: '',
  avatarSeed: '',
  exchange: { autoUpdate: true, snapshot: null, manualRates: {} },
};
export const emptyData = (): BusinessData => ({
  settings: structuredClone(defaultSettings),
  subscriptions: [],
  groups: [],
  members: [],
  memberships: [],
  bills: [],
  allocations: [],
  revision: 0,
});
