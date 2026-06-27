export class BrokerService {
  constructor() { this.isConnected = false; }
  async getAccount() { return { clientId: 'FW-10001', name: 'Trader', balance: 10000000, availableMargin: 8500000, usedMargin: 1500000, totalPnl: 125000 }; }
  async placeOrder(p) { return { orderId: 'ORD' + Date.now(), status: p.orderType === 'MARKET' ? 'FILLED' : 'OPEN' }; }
  async modifyOrder() { return { status: 'modified' }; }
  async cancelOrder() { return { status: 'cancelled' }; }
  async getPositions() { return [
    { id: 'p1', symbol: 'RELIANCE', token: '2885', segment: 'NSE', productType: 'MIS', qty: 10, avgPrice: 2935, ltp: 2950, pnl: 150, mtm: 150, buyQty: 10, sellQty: 0, buyAvg: 2935, sellAvg: 0 },
    { id: 'p2', symbol: 'NIFTY FUT', token: 'NF_FUT', segment: 'NFO', productType: 'NRML', qty: -2, avgPrice: 24550, ltp: 24520, pnl: 6000, mtm: 6000, buyQty: 0, sellQty: 2, buyAvg: 0, sellAvg: 24550 },
    { id: 'p3', symbol: 'BANKNIFTY FUT', token: 'BNF_FUT', segment: 'NFO', productType: 'MIS', qty: 1, avgPrice: 51800, ltp: 52050, pnl: 3750, mtm: 3750, buyQty: 1, sellQty: 0, buyAvg: 51800, sellAvg: 0 },
  ]; }
  async getOrders() { return [
    { id: 'o1', symbol: 'SBIN', token: '3045', segment: 'NSE', side: 'BUY', orderType: 'LIMIT', productType: 'MIS', qty: 50, price: 845, triggerPrice: 0, filledQty: 0, avgPrice: 0, status: 'OPEN', timestamp: new Date().toISOString() },
    { id: 'o2', symbol: 'RELIANCE', token: '2885', segment: 'NSE', side: 'BUY', orderType: 'MARKET', productType: 'MIS', qty: 10, price: 0, triggerPrice: 0, filledQty: 10, avgPrice: 2935, status: 'FILLED', timestamp: new Date(Date.now() - 3600000).toISOString() },
  ]; }
  async getTrades() { return []; }
}
