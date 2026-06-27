/**
 * ADMIN INTEGRATION EXAMPLE
 * 
 * This file shows how the FundedWealth Admin panel calls
 * the Terminal Provisioning API after manual payment approval.
 * 
 * Flow:
 *   1. User submits UTR / bank transfer proof on Website
 *   2. Admin reviews payment in Admin Panel
 *   3. Admin clicks "Approve & Provision Account"
 *   4. Admin backend calls Terminal Provisioning API
 *   5. Terminal creates account, sends email
 *   6. Admin panel shows success status
 * 
 * Copy this pattern into the Admin backend.
 */

import axios from 'axios';

const TERMINAL_API_URL = process.env.TERMINAL_API_URL || 'https://terminal.fundedwealth.com';
const PROVISIONING_API_KEY = process.env.PROVISIONING_API_KEY;

/**
 * Admin API endpoint: Approve payment and provision account.
 * 
 * POST /admin/api/orders/:orderId/approve
 * Body: { utrNumber, approvedBy }
 */
export async function approveAndProvision(req, res) {
  const { orderId } = req.params;
  const { utrNumber, approvedBy } = req.body;

  // 1. Get order details from admin database
  const order = await getOrder(orderId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (order.status === 'provisioned') {
    return res.status(409).json({ error: 'Already provisioned' });
  }

  // 2. Mark payment as approved
  await updateOrderStatus(orderId, 'payment_approved', {
    utrNumber,
    approvedBy,
    approvedAt: new Date().toISOString(),
  });

  // 3. Call Terminal Provisioning API
  try {
    const response = await axios.post(
      `${TERMINAL_API_URL}/provisioning/provision`,
      {
        email: order.user.email,
        name: order.user.name,
        phone: order.user.phone,
        plan: order.plan,
        orderId: order.id,
        paymentMethod: 'upi_manual',
        paymentRef: utrNumber,
        source: 'admin',
        fwUserId: order.user.fwUserId || null,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-provisioning-key': PROVISIONING_API_KEY,
        },
        timeout: 30000,
      }
    );

    if (response.data.success) {
      await updateOrderStatus(orderId, 'provisioned', {
        tradingAccountId: response.data.tradingAccount.id,
        accountCode: response.data.tradingAccount.accountCode,
        provisionedAt: new Date().toISOString(),
      });

      return res.json({
        success: true,
        message: 'Account provisioned and email sent to user',
        account: response.data.tradingAccount,
        credentials: response.data.credentials,
      });
    }
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.message;
    await updateOrderStatus(orderId, 'provisioning_failed', { error: errorMsg });

    return res.status(500).json({
      success: false,
      error: 'Provisioning failed',
      message: errorMsg,
      retriable: true,
    });
  }
}

/**
 * Admin API endpoint: Retry failed provisioning.
 * 
 * POST /admin/api/orders/:orderId/retry-provision
 */
export async function retryProvision(req, res) {
  const { orderId } = req.params;

  const order = await getOrder(orderId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  try {
    const response = await axios.post(
      `${TERMINAL_API_URL}/provisioning/retry`,
      {
        email: order.user.email,
        name: order.user.name,
        phone: order.user.phone,
        plan: order.plan,
        orderId: order.id,
        paymentMethod: order.paymentMethod || 'upi_manual',
        paymentRef: order.paymentRef,
        source: 'admin',
        fwUserId: order.user.fwUserId || null,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-provisioning-key': PROVISIONING_API_KEY,
        },
        timeout: 30000,
      }
    );

    if (response.data.success) {
      await updateOrderStatus(orderId, 'provisioned', {
        tradingAccountId: response.data.tradingAccount?.id,
        retriedAt: new Date().toISOString(),
      });
      return res.json({ success: true, ...response.data });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.response?.data?.message || err.message,
    });
  }
}

/**
 * Admin Frontend: "Provision Account" button component (React example)
 * 
 * <ProvisionButton orderId={order.id} onSuccess={refreshOrders} />
 */
export const AdminProvisionButtonExample = `
import { useState } from 'react';

export function ProvisionButton({ orderId, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleProvision() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(\`/admin/api/orders/\${orderId}/approve\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: currentUser.id }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccess?.(data);
      } else {
        setError(data.message || 'Provisioning failed');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleProvision}
      disabled={loading}
      className="btn btn-primary"
    >
      {loading ? 'Provisioning...' : 'Approve & Provision Account'}
    </button>
  );
}
`;

// Placeholder — implement in your Admin codebase
async function getOrder(orderId) {
  return { id: orderId, user: { email: 'test@example.com', name: 'Test User' }, plan: '25K' };
}

async function updateOrderStatus(orderId, status, meta) {
  console.log(`[Admin] Order ${orderId} → ${status}`, meta);
}
