/**
 * AI ROUTES — Trade analysis and coaching
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AIService } from '../services/aiService.js';

export function createAIRouter() {
  const router = Router();

  /**
   * POST /api/ai/trade-review — Review a specific trade
   */
  router.post('/ai/trade-review', requireAuth, async (req, res) => {
    try {
      const result = await AIService.reviewTrade(req.user.accountId, req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'ai_error', message: err.message });
    }
  });

  /**
   * GET /api/ai/behavioral-analysis — Analyze trading behavior
   * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  router.get('/ai/behavioral-analysis', requireAuth, async (req, res) => {
    try {
      const result = await AIService.analyzeBehavior(req.user.accountId, {
        fromDate: req.query.from,
        toDate: req.query.to,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'ai_error', message: err.message });
    }
  });

  /**
   * GET /api/ai/daily-summary — Get daily trading summary
   * Query: ?date=YYYY-MM-DD
   */
  router.get('/ai/daily-summary', requireAuth, async (req, res) => {
    try {
      const result = await AIService.getDailySummary(req.user.accountId, req.query.date);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'ai_error', message: err.message });
    }
  });

  /**
   * GET /api/ai/coaching — Get personalized coaching advice
   */
  router.get('/ai/coaching', requireAuth, async (req, res) => {
    try {
      const result = await AIService.getCoachingAdvice(req.user.accountId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'ai_error', message: err.message });
    }
  });

  /**
   * GET /api/ai/status — Check AI service availability
   */
  router.get('/ai/status', requireAuth, (req, res) => {
    res.json({
      available: true,
      llmConfigured: AIService.isLLMAvailable(),
      provider: process.env.AI_PROVIDER || 'data-driven-only',
    });
  });

  return router;
}
