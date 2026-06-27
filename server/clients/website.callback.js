/**
 * WEBSITE CALLBACK CLIENT
 * 
 * Utility for calling back the Website API to update order status
 * after provisioning is complete.
 * 
 * The Website should expose:
 *   POST /api/orders/:orderId/provision-callback
 *   Body: { status: 'provisioned', accountCode, tradingAccountId }
 * 
 * This is called by the provisioning service after successful account creation.
 */

import axios from 'axios';

const WEBSITE_API_URL = process.env.WEBSITE_API_URL || 'https://fundedwealth.com/api';
const WEBSITE_CALLBACK_KEY = process.env.WEBSITE_CALLBACK_KEY || process.env.PROVISIONING_API_KEY;
const CALLBACK_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds between retries

export class WebsiteCallbackClient {
  /**
   * Notify Website that an order has been provisioned.
   * Updates order_status = 'provisioned' on the Website side.
   * 
   * Retries up to MAX_RETRIES times if Website is unavailable.
   */
  static async notifyProvisioned({ orderId, accountCode, tradingAccountId, userId }) {
    const payload = {
      status: 'provisioned',
      accountCode,
      tradingAccountId,
      userId,
      provisionedAt: new Date().toISOString(),
    };

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(
          `${WEBSITE_API_URL}/orders/${orderId}/provision-callback`,
          payload,
          {
            headers: {
              'Content-Type': 'application/json',
              'x-callback-key': WEBSITE_CALLBACK_KEY,
            },
            timeout: CALLBACK_TIMEOUT,
          }
        );

        console.log(`[WebsiteCallback] Order ${orderId} marked provisioned (attempt ${attempt})`);
        return { success: true, response: response.data };
      } catch (err) {
        const isLastAttempt = attempt === MAX_RETRIES;
        const status = err.response?.status;
        const message = err.response?.data?.message || err.message;

        console.warn(`[WebsiteCallback] Attempt ${attempt}/${MAX_RETRIES} failed for order ${orderId}: ${message}`);

        // Don't retry on 4xx (client errors — won't resolve with retry)
        if (status && status >= 400 && status < 500) {
          return { success: false, error: message, status, retriable: false };
        }

        if (!isLastAttempt) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
        } else {
          return { success: false, error: message, attempts: MAX_RETRIES, retriable: true };
        }
      }
    }
  }

  /**
   * Notify Website that provisioning failed.
   * Website can show this to the user or trigger manual review.
   */
  static async notifyFailed({ orderId, error, code }) {
    try {
      await axios.post(
        `${WEBSITE_API_URL}/orders/${orderId}/provision-callback`,
        {
          status: 'failed',
          error,
          code,
          failedAt: new Date().toISOString(),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-callback-key': WEBSITE_CALLBACK_KEY,
          },
          timeout: CALLBACK_TIMEOUT,
        }
      );
      return { success: true };
    } catch (err) {
      console.warn(`[WebsiteCallback] Failed to notify failure for order ${orderId}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
