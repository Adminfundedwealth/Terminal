/**
 * WEBSITE INTEGRATION EXAMPLE
 * 
 * This file shows how the FundedWealth Website calls
 * the Terminal Provisioning API after successful payment.
 * 
 * Copy this pattern into the Website payment success handler.
 */

import axios from 'axios';

const TERMINAL_API_URL = process.env.TERMINAL_API_URL || 'https://terminal.fundedwealth.com';
const PROVISIONING_API_KEY = process.env.PROVISIONING_API_KEY;

/**
 * Call this after Razorpay/Stripe payment is confirmed.
 * 
 * @param {Object} order - The website order record
 * @param {Object} payment - Payment gateway response
 */
export async function provisionAfterPayment(order, payment) {
  try {
    const response = await axios.post(
      `${TERMINAL_API_URL}/provisioning/provision`,
      {
        email: order.user.email,
        name: order.user.name,
        phone: order.user.phone,
        plan: order.plan,            // '10K', '25K', '50K', '1L'
        orderId: order.id,
        paymentMethod: 'razorpay',
        paymentRef: payment.razorpay_payment_id,
        source: 'website',
        fwUserId: order.user.fwUserId || null,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-provisioning-key': PROVISIONING_API_KEY,
        },
        timeout: 30000, // 30s timeout
      }
    );

    if (response.data.success) {
      // Update local order status
      await updateOrderStatus(order.id, 'provisioned', {
        tradingAccountId: response.data.tradingAccount.id,
        accountCode: response.data.tradingAccount.accountCode,
      });
    }

    return response.data;
  } catch (err) {
    console.error('[Website] Provisioning failed:', err.response?.data || err.message);

    // Mark order as pending_provisioning for retry
    await updateOrderStatus(order.id, 'pending_provisioning', {
      error: err.response?.data?.message || err.message,
    });

    // Queue for retry (implement based on your queue system)
    await queueProvisioningRetry(order.id, { retryAfter: 60000 });

    throw err;
  }
}

/**
 * Website endpoint to receive provisioning callbacks from Terminal.
 * Add this route to your Website Express app.
 * 
 * POST /api/orders/:orderId/provision-callback
 */
export function setupProvisioningCallback(app) {
  app.post('/api/orders/:orderId/provision-callback', async (req, res) => {
    // Validate callback key
    const key = req.headers['x-callback-key'];
    if (key !== process.env.WEBSITE_CALLBACK_KEY) {
      return res.status(403).json({ error: 'Invalid callback key' });
    }

    const { orderId } = req.params;
    const { status, accountCode, tradingAccountId, error } = req.body;

    if (status === 'provisioned') {
      await updateOrderStatus(orderId, 'provisioned', {
        tradingAccountId,
        accountCode,
        provisionedAt: new Date().toISOString(),
      });
      res.json({ success: true });
    } else if (status === 'failed') {
      await updateOrderStatus(orderId, 'provisioning_failed', { error });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Unknown status' });
    }
  });
}

/**
 * Check provisioning status (polling).
 * Call this if the initial provision request timed out.
 */
export async function checkProvisioningStatus(orderId) {
  try {
    const response = await axios.get(
      `${TERMINAL_API_URL}/provisioning/status/${orderId}`,
      {
        headers: { 'x-provisioning-key': PROVISIONING_API_KEY },
        timeout: 10000,
      }
    );
    return response.data;
  } catch (err) {
    return null;
  }
}

// Placeholder functions — implement in your Website codebase
async function updateOrderStatus(orderId, status, meta) {
  // UPDATE orders SET status = $status, meta = $meta WHERE id = $orderId
  console.log(`[Website] Order ${orderId} → ${status}`, meta);
}

async function queueProvisioningRetry(orderId, options) {
  // Add to your queue (BullMQ, SQS, etc.)
  console.log(`[Website] Queued retry for order ${orderId}`, options);
}
