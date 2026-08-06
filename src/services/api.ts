import type {
  Instrument,
  Order,
  Position,
  Trade,
  AccountInfo,
  OrderSide,
  OrderType,
  ProductType,
  OptionChainEntry,
  OHLC,
} from '@/types';

const BASE_URL = '/api';

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    const err = new Error(error.message || error.error || `HTTP ${response.status}`);
    (err as any).status = response.status;
    (err as any).code = error.error;
    throw err;
  }

  return response.json();
}

// Account
export const getAccount = (signal?: AbortSignal) => request<AccountInfo>('/account', signal ? { signal } : undefined);

// Multiple accounts
export const getAccounts = () => request<AccountInfo[]>('/accounts');
export const getAccountById = (id: string) => request<AccountInfo>(`/accounts/${id}`);

// Switch active account (server-side override — no re-auth required)
export const switchAccount = (accountId: string) =>
  request<{ success: boolean; account: AccountInfo }>('/account/switch', {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  });

// Margin
export const getMarginInfo = () => request<{ balance: number; usedMargin: number; availableMargin: number }>('/account/margin');

// Real-time risk state
export interface RiskState {
  accountId: string;
  balance: number;
  currentEquity: number;
  initialBalance: number;
  peakBalance: number;
  todayRealizedPnl: number;
  unrealizedPnl: number;
  totalDailyPnl: number;
  pnlFromStart: number;
  dailyLoss: number;
  dailyLossLimit: number;
  dailyLossUsedPct: number;
  dailyLossRemaining: number;
  drawdown: number;
  maxDrawdownLimit: number;
  maxDrawdownUsedPct: number;
  maxDrawdownRemaining: number;
  profitTargetAmount: number;
  targetProgressPct: number;
  targetRemaining: number;
  todayTradeCount: number;
  accountStatus: string;
  challengeStatus: string;
  challengeType: string;
}
export const getRiskState = () => request<RiskState>('/account/risk-state');

// Terminal status
export interface TerminalStatus {
  executionMode: { mode: string; isLive: boolean; isPaper: boolean; reason: string };
  broker: { provider: string; connected: boolean; cachedQuotes: number };
  feed: { isLive: boolean; cachedQuotes: number };
  tradingAllowed: boolean;
  tradingBlocked: boolean;
}
export const getTerminalStatus = () => request<TerminalStatus>('/terminal/status');

// Holiday/market status
export const getHolidayStatus = () => request<{ isClosed: boolean; reason: string | null; holidayName: string | null; isWeekend: boolean; upcoming: { date: string; name: string }[] }>('/market/holiday');

// Search
export const searchInstruments = (query: string, segment?: string) =>
  request<Instrument[]>(`/instruments/search?q=${encodeURIComponent(query)}${segment ? `&segment=${segment}` : ''}`);

// Orders
export const getPositions = () => request<Position[]>('/positions');
export const getOrders = () => request<Order[]>('/orders');
export const getTrades = (period?: 'today' | 'week' | 'month') =>
  request<Trade[]>(`/trades${period ? `?period=${period}` : ''}`);

export interface PlaceOrderParams {
  symbol: string;
  token: string;
  segment: string;
  side: OrderSide;
  orderType: OrderType;
  productType: ProductType;
  qty: number;
  price?: number;
  triggerPrice?: number;
  validity?: 'DAY' | 'IOC' | 'GTC';
  isAmo?: boolean;
  slPrice?: number;   // optional bracket stop-loss trigger price
  tpPrice?: number;   // optional bracket take-profit limit price
}

export const placeOrder = (params: PlaceOrderParams) =>
  request<{ orderId: string; status: string }>('/orders/place', {
    method: 'POST',
    body: JSON.stringify(params),
  });

export const modifyOrder = (orderId: string, params: Partial<PlaceOrderParams>) =>
  request<{ status: string }>(`/orders/${orderId}/modify`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });

export const cancelOrder = (orderId: string) =>
  request<{ status: string }>(`/orders/${orderId}/cancel`, {
    method: 'DELETE',
  });

// Positions
export const exitPosition = (positionId: string) =>
  request<{ status: string }>(`/positions/${positionId}/exit`, {
    method: 'POST',
  });

export const partialClosePosition = (positionId: string, qty: number) =>
  request<{ status: string }>(`/positions/${positionId}/exit`, {
    method: 'POST',
    body: JSON.stringify({ qty }),
  });

export const reversePosition = (positionId: string) =>
  request<{ status: string }>(`/positions/${positionId}/reverse`, {
    method: 'POST',
  });

export const attachStopLoss = (positionId: string, triggerPrice: number) =>
  request<{ orderId: string; status: string }>(`/positions/${positionId}/stoploss`, {
    method: 'POST',
    body: JSON.stringify({ triggerPrice }),
  });

export const attachTakeProfit = (positionId: string, targetPrice: number) =>
  request<{ orderId: string; status: string }>(`/positions/${positionId}/takeprofit`, {
    method: 'POST',
    body: JSON.stringify({ targetPrice }),
  });

export const breakEvenPosition = (positionId: string) =>
  request<{ orderId: string; status: string }>(`/positions/${positionId}/breakeven`, {
    method: 'POST',
  });

export const closeAllPositions = () =>
  request<{ status: string; results: any[] }>('/positions/close-all', {
    method: 'POST',
    body: JSON.stringify({ reason: 'user_requested' }),
  });

// Market Data
export const getHistoricalData = (token: string, timeframe: string, exchange?: string, from?: number, to?: number) =>
  request<OHLC[]>(
    `/market/history?token=${token}&tf=${timeframe}${exchange ? `&exchange=${encodeURIComponent(exchange)}` : ''}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`
  );

export const getOptionChain = (symbol: string, expiry: string) =>
  request<OptionChainEntry[]>(`/market/option-chain?symbol=${symbol}&expiry=${expiry}`);

export const getExpiries = (symbol: string) =>
  request<string[]>(`/market/expiries?symbol=${symbol}`);

export const getMarketDepth = (token: string) =>
  request<any>(`/market/depth?token=${token}`);

// Instruments
export const getInstruments = (segment: string) =>
  request<Instrument[]>(`/instruments?segment=${segment}`);

// ─── Persistence APIs ──────────────────────────────────────────

// Layouts (Workspace Save)
export const getLayouts = () => request<any[]>('/layouts');
export const saveLayout = (layout: any) => request<any>('/layouts', { method: 'POST', body: JSON.stringify(layout) });
export const updateLayout = (id: string, layout: any) => request<any>(`/layouts/${id}`, { method: 'PUT', body: JSON.stringify(layout) });
export const deleteLayout = (id: string) => request<any>(`/layouts/${id}`, { method: 'DELETE' });
export const activateLayout = (id: string) => request<any>(`/layouts/${id}/activate`, { method: 'POST' });

// Themes
export const getThemes = () => request<any[]>('/themes');
export const saveTheme = (theme: any) => request<any>('/themes', { method: 'POST', body: JSON.stringify(theme) });
export const activateTheme = (id: string) => request<any>(`/themes/${id}/activate`, { method: 'POST' });
export const deleteTheme = (id: string) => request<any>(`/themes/${id}`, { method: 'DELETE' });

// Journal Persistence
export const getJournalEntries = () => request<any[]>('/journal');
export const saveJournalEntry = (entry: any) => request<any>('/journal', { method: 'POST', body: JSON.stringify(entry) });
export const updateJournalEntry = (id: string, entry: any) => request<any>(`/journal/${id}`, { method: 'PUT', body: JSON.stringify(entry) });
export const deleteJournalEntry = (id: string) => request<any>(`/journal/${id}`, { method: 'DELETE' });

// Advanced Orders
export const placeOCOOrder = (params: any) => request<any>('/orders/oco', { method: 'POST', body: JSON.stringify(params) });
export const placeBasketOrder = (legs: any[]) => request<any>('/orders/basket', { method: 'POST', body: JSON.stringify({ legs }) });
export const placeBracketOrder = (params: any) => request<any>('/orders/bracket', { method: 'POST', body: JSON.stringify(params) });

// Equity Curve & Metrics
export const getEquityCurve = (days?: number) => request<any[]>(`/account/equity-curve${days ? `?days=${days}` : ''}`);
export const getAccountMetrics = (days?: number) => request<any[]>(`/account/metrics${days ? `?days=${days}` : ''}`);

// Chart Templates
export const getChartTemplates = () => request<any[]>('/chart-templates');
export const saveChartTemplate = (tpl: any) => request<any>('/chart-templates', { method: 'POST', body: JSON.stringify(tpl) });
export const deleteChartTemplate = (id: string) => request<any>(`/chart-templates/${id}`, { method: 'DELETE' });


// Generic HTTP wrapper for dynamic API calls (used by components)
export const apiService = {
  get: <T = any>(url: string) => request<T>(url),
  post: <T = any>(url: string, data?: any) => request<T>(url, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: <T = any>(url: string, data?: any) => request<T>(url, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  delete: <T = any>(url: string) => request<T>(url, { method: 'DELETE' }),
};

// ─── Admin API ──────────────────────────────────────────────────────────────

export interface AdminAccount {
  id: string;
  account_code: string;
  broker_provider: string;
  balance: number;
  available_margin: number;
  used_margin: number;
  status: 'active' | 'locked' | 'breached' | 'completed';
  locked_reason: string | null;
  locked_at: string | null;
  unlocked_at: string | null;
  created_at: string;
  trader_id: string;
  terminal_traders: {
    id: string;
    email: string;
    display_name: string;
    status: string;
  } | null;
}

export interface AdminAccountDetail extends AdminAccount {
  challenge: any;
  trader: { id: string; email: string; display_name: string; status: string; external_id: string } | null;
  positions: Array<{ id: string; symbol: string; side: string; qty: number; product_type: string; is_open: boolean; opened_at: string }>;
}

export const adminCheckAccess = () =>
  request<{ isFounder: boolean }>('/admin/check');

export const adminListAccounts = (params?: { search?: string; status?: string; page?: number; limit?: number }) => {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.status) q.set('status', params.status);
  if (params?.page) q.set('page', String(params.page));
  if (params?.limit) q.set('limit', String(params.limit));
  return request<{ success: boolean; accounts: AdminAccount[]; pagination: { page: number; limit: number; total: number; pages: number } }>(
    `/admin/accounts${q.toString() ? '?' + q.toString() : ''}`
  );
};

export const adminGetAccount = (id: string) =>
  request<{ success: boolean } & AdminAccountDetail>(`/admin/accounts/${id}`);

export const adminFreezeAccount = (id: string, reason: string) =>
  request<{ success: boolean; message: string; status: string }>(`/admin/accounts/${id}/freeze`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const adminUnfreezeAccount = (id: string) =>
  request<{ success: boolean; message: string; status: string; previousStatus: string }>(`/admin/accounts/${id}/unfreeze`, {
    method: 'POST',
  });

export const adminClosePositions = (id: string) =>
  request<{ success: boolean; message: string; closed: number; positions: any[] }>(`/admin/accounts/${id}/close-positions`, {
    method: 'POST',
  });

export const adminGetPositions = (id: string) =>
  request<{ success: boolean; positions: any[] }>(`/admin/accounts/${id}/positions`);

export const adminGetRiskEvents = (id: string) =>
  request<{ success: boolean; events: any[] }>(`/admin/accounts/${id}/risk-events`);
