/**
 * BROKER FACTORY
 * 
 * Creates the appropriate broker adapter based on provider name.
 * Used by the Trading Engine to get the correct broker for an account.
 */

import type { BrokerProvider, BrokerCredentials } from '../types/index.js';
import { BaseBrokerAdapter } from './broker.interface.js';

// Adapters will be imported here once implemented:
// import { AngelOneAdapter } from './angelone/angelone.adapter.js';
// import { DhanAdapter } from './dhan/dhan.adapter.js';
// import { UpstoxAdapter } from './upstox/upstox.adapter.js';
// import { ShoonyaAdapter } from './shoonya/shoonya.adapter.js';

export class BrokerFactory {
  private static instances: Map<string, BaseBrokerAdapter> = new Map();

  /**
   * Create or retrieve a broker adapter instance.
   * Keyed by provider + clientId to allow multiple accounts.
   */
  static async create(
    provider: BrokerProvider,
    credentials: BrokerCredentials
  ): Promise<BaseBrokerAdapter> {
    const key = `${provider}:${credentials.clientId}`;

    if (this.instances.has(key)) {
      const existing = this.instances.get(key)!;
      if (existing.isConnected) return existing;
    }

    let adapter: BaseBrokerAdapter;

    switch (provider) {
      case 'angelone':
        // adapter = new AngelOneAdapter();
        throw new Error('Angel One adapter not yet implemented');
      case 'dhan':
        // adapter = new DhanAdapter();
        throw new Error('Dhan adapter not yet implemented');
      case 'upstox':
        // adapter = new UpstoxAdapter();
        throw new Error('Upstox adapter not yet implemented');
      case 'shoonya':
        // adapter = new ShoonyaAdapter();
        throw new Error('Shoonya adapter not yet implemented');
      default:
        throw new Error(`Unknown broker provider: ${provider}`);
    }

    // await adapter.connect(credentials);
    // this.instances.set(key, adapter);
    // return adapter;
  }

  /**
   * Disconnect all broker instances.
   */
  static async disconnectAll(): Promise<void> {
    for (const [key, adapter] of this.instances) {
      try {
        await adapter.disconnect();
      } catch (e) {
        console.error(`[BrokerFactory] Error disconnecting ${key}:`, e);
      }
    }
    this.instances.clear();
  }

  /**
   * Get an existing connected adapter.
   */
  static get(provider: BrokerProvider, clientId: string): BaseBrokerAdapter | undefined {
    return this.instances.get(`${provider}:${clientId}`);
  }
}
