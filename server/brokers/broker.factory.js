/**
 * BROKER FACTORY
 * 
 * Creates and manages broker adapter instances.
 * Supports: AngelOne (implemented), Dhan (placeholder), Upstox, Shoonya.
 * 
 * Features:
 * - Instance pooling (keyed by provider:clientId)
 * - Health monitoring
 * - Failover coordination
 */

import { AngelOneAdapter } from './angelone/angelone.adapter.js';
// import { DhanAdapter } from './dhan/dhan.adapter.js'; // Placeholder — not yet implemented

export class BrokerFactory {
  static instances = new Map();
  static healthStatus = new Map();

  /**
   * Register a pre-authenticated adapter instance.
   * Used to share the AngelFeedConnector's session with order execution.
   */
  static registerInstance(provider, adapter, clientId = 'default') {
    const key = `${provider}:${clientId}`;
    this.instances.set(key, adapter);
    this.healthStatus.set(key, {
      provider,
      clientId,
      connected: true,
      lastCheck: Date.now(),
      lastError: null,
      connectTime: Date.now(),
    });
    console.log(`[BrokerFactory] ✓ Registered pre-authenticated ${provider} adapter (${clientId})`);
  }

  /**
   * Create or retrieve a broker adapter instance.
   * Keyed by provider + clientId for multi-account support.
   */
  static async create(provider, credentials = {}) {
    const clientId = credentials.clientId || process.env[`${provider.toUpperCase()}_CLIENT_ID`] || 'default';
    const key = `${provider}:${clientId}`;

    // Return existing connected instance
    if (this.instances.has(key)) {
      const existing = this.instances.get(key);
      if (existing.isConnected) {
        return existing;
      }
      // Stale — remove and recreate
      this.instances.delete(key);
    }

    let adapter;

    switch (provider) {
      case 'angelone': {
        adapter = new AngelOneAdapter();
        break;
      }
      case 'dhan': {
        // Dhan adapter placeholder — structure exists but not implemented
        throw new Error('[BrokerFactory] Dhan adapter not yet implemented. Credentials available but adapter pending.');
      }
      case 'upstox':
        throw new Error('[BrokerFactory] Upstox adapter not implemented');
      case 'shoonya':
        throw new Error('[BrokerFactory] Shoonya adapter not implemented');
      default:
        throw new Error(`[BrokerFactory] Unknown broker provider: ${provider}`);
    }

    // Attempt connection
    try {
      await adapter.connect(credentials);
      this.instances.set(key, adapter);
      this.healthStatus.set(key, {
        provider,
        clientId,
        connected: true,
        lastCheck: Date.now(),
        lastError: null,
        connectTime: Date.now(),
      });
      console.log(`[BrokerFactory] ✓ ${provider} adapter connected (${clientId})`);
      return adapter;
    } catch (err) {
      this.healthStatus.set(key, {
        provider,
        clientId,
        connected: false,
        lastCheck: Date.now(),
        lastError: err.message,
        connectTime: null,
      });
      throw new Error(`[BrokerFactory] Failed to connect ${provider}: ${err.message}`);
    }
  }

  /**
   * Get an existing connected adapter without creating.
   */
  static get(provider, clientId) {
    const key = `${provider}:${clientId || 'default'}`;
    return this.instances.get(key) || null;
  }

  /**
   * Disconnect a specific adapter.
   */
  static async disconnect(provider, clientId) {
    const key = `${provider}:${clientId || 'default'}`;
    const adapter = this.instances.get(key);
    if (adapter) {
      try {
        await adapter.disconnect();
      } catch (e) {
        console.error(`[BrokerFactory] Disconnect error for ${key}:`, e.message);
      }
      this.instances.delete(key);
      this.healthStatus.set(key, {
        ...this.healthStatus.get(key),
        connected: false,
        lastCheck: Date.now(),
      });
    }
  }

  /**
   * Disconnect all broker instances.
   */
  static async disconnectAll() {
    for (const [key, adapter] of this.instances) {
      try {
        await adapter.disconnect();
      } catch (e) {
        console.error(`[BrokerFactory] Error disconnecting ${key}:`, e.message);
      }
    }
    this.instances.clear();
    console.log('[BrokerFactory] All adapters disconnected');
  }

  /**
   * Get health status for all brokers.
   */
  static getHealthReport() {
    const report = {};
    for (const [key, status] of this.healthStatus) {
      report[key] = { ...status };
    }
    // Add available providers info
    report._available = {
      angelone: {
        configured: !!(process.env.ANGEL_API_KEY && process.env.ANGEL_CLIENT_ID),
        status: this.healthStatus.get(`angelone:${process.env.ANGEL_CLIENT_ID}`)?.connected || false,
      },
      dhan: {
        configured: !!(process.env.DHAN_ACCESS_TOKEN && process.env.DHAN_CLIENT_ID),
        status: 'not_implemented',
      },
    };
    return report;
  }

  /**
   * List all active connections.
   */
  static listConnections() {
    const connections = [];
    for (const [key, adapter] of this.instances) {
      connections.push({
        key,
        provider: adapter.name,
        connected: adapter.isConnected,
      });
    }
    return connections;
  }
}
