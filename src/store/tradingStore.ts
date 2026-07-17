import { create } from 'zustand';
import type { Position, Order, Trade, AccountInfo, OrderSide, OrderType, ProductType } from '@/types';

interface OrderForm {
  symbol: string;
  token: string;
  side: OrderSide;
  orderType: OrderType;
  productType: ProductType;
  qty: number;
  price: number;
  triggerPrice: number;
  validity: 'DAY' | 'IOC' | 'GTC' | 'GTD';
  isAmo: boolean;
}

export interface SelectedContract {
  symbol: string;
  token: string;
  underlying: string;
  strike: number;
  optionType: 'CE' | 'PE';
  expiry: string;
  lotSize: number;
  ltp?: number;
}

interface TradingState {
  positions: Position[];
  orders: Order[];
  trades: Trade[];
  account: AccountInfo | null;
  // Multi-account: all active accounts for the session user
  accounts: AccountInfo[];
  isSwitching: boolean;
  isLoadingAccounts: boolean;
  switchError: string | null;
  orderForm: OrderForm;
  selectedContract: SelectedContract | null;

  setPositions: (positions: Position[]) => void;
  updatePosition: (id: string, update: Partial<Position>) => void;
  setOrders: (orders: Order[]) => void;
  addOrder: (order: Order) => void;
  updateOrder: (id: string, update: Partial<Order>) => void;
  setTrades: (trades: Trade[]) => void;
  setAccount: (account: AccountInfo) => void;
  setAccounts: (accounts: AccountInfo[]) => void;
  setIsSwitching: (v: boolean) => void;
  setIsLoadingAccounts: (v: boolean) => void;
  setSwitchError: (e: string | null) => void;
  setOrderForm: (form: Partial<OrderForm>) => void;
  resetOrderForm: () => void;
  setSelectedContract: (contract: SelectedContract | null) => void;
}

const defaultOrderForm: OrderForm = {
  symbol: '',
  token: '',
  side: 'BUY',
  orderType: 'MARKET',
  productType: 'MIS',
  qty: 1,
  price: 0,
  triggerPrice: 0,
  validity: 'DAY',
  isAmo: false,
};

export const useTradingStore = create<TradingState>((set) => ({
  positions: [],
  orders: [],
  trades: [],
  account: null,
  accounts: [],
  isSwitching: false,
  isLoadingAccounts: false,
  switchError: null,
  orderForm: { ...defaultOrderForm },
  selectedContract: null,

  setPositions: (positions) => set({ positions }),
  updatePosition: (id, update) =>
    set((state) => ({
      positions: state.positions.map((p) => (p.id === id ? { ...p, ...update } : p)),
    })),
  setOrders: (orders) => set({ orders }),
  addOrder: (order) => set((state) => ({ orders: [order, ...state.orders] })),
  updateOrder: (id, update) =>
    set((state) => ({
      orders: state.orders.map((o) => (o.id === id ? { ...o, ...update } : o)),
    })),
  setTrades: (trades) => set({ trades }),
  setAccount: (account) => set({ account }),
  setAccounts: (accounts) => set({ accounts }),
  setIsSwitching: (isSwitching) => set({ isSwitching }),
  setIsLoadingAccounts: (isLoadingAccounts) => set({ isLoadingAccounts }),
  setSwitchError: (switchError) => set({ switchError }),
  setOrderForm: (form) =>
    set((state) => ({ orderForm: { ...state.orderForm, ...form } })),
  resetOrderForm: () => set({ orderForm: { ...defaultOrderForm }, selectedContract: null }),
  setSelectedContract: (contract) => set({ selectedContract: contract }),
}));
