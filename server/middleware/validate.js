/**
 * ZOD VALIDATION MIDDLEWARE — Request Schema Enforcement
 * 
 * Validates request body, params, and query against Zod schemas.
 * Rejects malformed requests before they reach route handlers.
 * 
 * PRODUCTION: Every state-changing endpoint MUST be validated.
 */

import { z } from 'zod';

/**
 * Create Express middleware that validates req.body against a Zod schema.
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns Express middleware
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Request body validation failed.',
        details: result.error.issues.map(i => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.validatedBody = result.data;
    next();
  };
}

/**
 * Create Express middleware that validates req.params against a Zod schema.
 */
export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'URL parameter validation failed.',
        details: result.error.issues.map(i => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.validatedParams = result.data;
    next();
  };
}

/**
 * Create Express middleware that validates req.query against a Zod schema.
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'Query parameter validation failed.',
        details: result.error.issues.map(i => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.validatedQuery = result.data;
    next();
  };
}

// ══════════════════════════════════════════════════════════════════
// SCHEMAS — All request body schemas for state-changing endpoints
// ══════════════════════════════════════════════════════════════════

export const schemas = {
  // Kill Switch
  killSwitch: z.object({
    scope: z.enum(['account', 'group', 'global']),
    targetAccountIds: z.array(z.string().uuid()).optional(),
    reason: z.string().min(3).max(500),
  }),

  // Copy Trading Config
  copyTradingConfig: z.object({
    slaveAccountId: z.string().uuid(),
    copyMode: z.enum(['mirror', 'fixed_lot', 'ratio']).optional().default('mirror'),
    copyRatio: z.number().min(0.1).max(10).optional().default(1.0),
    fixedLotSize: z.number().int().min(1).max(10000).optional().nullable(),
  }),

  // Order Placement
  placeOrder: z.object({
    symbol: z.string().min(1).max(50),
    token: z.string().min(1).max(30),
    segment: z.string().min(1).max(10),
    exchange: z.string().min(1).max(10).optional(), // Optional — defaults to segment if not provided
    instrumentType: z.string().min(1).max(20).optional(),
    expiry: z.string().max(30).optional(),
    strike: z.number().min(0).optional(),
    optionType: z.enum(['CE', 'PE']).optional(),
    lotSize: z.number().int().min(1).optional(),
    side: z.enum(['BUY', 'SELL']),
    orderType: z.enum(['MARKET', 'LIMIT', 'SL', 'SL-M']),
    productType: z.enum(['CNC', 'MIS', 'NRML', 'INTRADAY']),
    qty: z.number().int().min(1).max(100000),
    price: z.number().min(0).optional(),
    triggerPrice: z.number().min(0).optional(),
    validity: z.enum(['DAY', 'IOC', 'GTC']).optional().default('DAY'),
    isAmo: z.boolean().optional().default(false),
    slPrice: z.number().min(0).optional(),   // bracket stop-loss trigger
    tpPrice: z.number().min(0).optional(),   // bracket take-profit limit
  }),

  // Order Modification
  modifyOrder: z.object({
    orderId: z.string().min(1).optional(), // Also available in req.params.id
    qty: z.number().int().min(1).max(100000).optional(),
    price: z.number().min(0).optional(),
    triggerPrice: z.number().min(0).optional(),
    orderType: z.enum(['MARKET', 'LIMIT', 'SL', 'SL-M']).optional(),
  }),

  // Provisioning
  provision: z.object({
    email: z.string().email(),
    name: z.string().min(1).max(200),
    phone: z.string().max(20).optional(),
    plan: z.enum(['10K', '25K', '50K', '1L']),
    orderId: z.string().min(1).max(200),
    paymentMethod: z.enum(['razorpay', 'upi_manual', 'bank_transfer']),
    paymentRef: z.string().max(200).optional(),
    source: z.enum(['website', 'admin']),
    fwUserId: z.string().optional(),
    challengeType: z.enum(['flash', 'instant', '1-step', '2-step']).optional(),
    ruleProfile: z.object({
      challengeType: z.string(),
      plan: z.string(),
      phase: z.string(),
      initialBalance: z.number().positive(),
      rules: z.record(z.unknown()),
    }).optional(),
  }),

  // SSO Generate
  ssoGenerate: z.object({
    fwUserId: z.string().min(1),
    accountId: z.string().uuid(),
    challengeId: z.string().uuid().optional().nullable(),
    email: z.string().email().optional().nullable(),
    name: z.string().max(200).optional().nullable(),
    // Optional pass-through fields from the dashboard API server
    accountCode: z.string().max(50).optional().nullable(),
    traderId: z.string().optional().nullable(),
    plan: z.string().max(50).optional().nullable(),
    activationToken: z.string().optional().nullable(),
  }),

  // Alert
  createAlert: z.object({
    symbol: z.string().min(1).max(50),
    token: z.string().min(1).max(20),
    condition: z.enum(['above', 'below', 'crosses']),
    price: z.number().positive(),
    message: z.string().max(500).optional(),
  }),
};
