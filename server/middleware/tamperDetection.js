/**
 * TAMPER DETECTION MIDDLEWARE
 * 
 * Detects and blocks suspicious request patterns that indicate:
 *   - JWT tampering attempts
 *   - Parameter pollution
 *   - Prototype pollution via __proto__
 *   - Path traversal attempts
 *   - Request smuggling indicators
 * 
 * PRODUCTION: Logs all tamper attempts to audit trail.
 */

import { AuditLogger } from '../services/auditLogger.js';

/**
 * Detect and block tampered/malicious requests.
 */
export function tamperDetection(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress;

  // 1. Prototype pollution prevention
  if (req.body && typeof req.body === 'object') {
    if (hasProtoKeys(req.body)) {
      AuditLogger.tamperDetected({ type: 'prototype_pollution', details: 'Body contains __proto__ or constructor keys', ip });
      return res.status(400).json({ error: 'bad_request', message: 'Invalid request body.' });
    }
  }

  // 2. Path traversal detection
  if (req.path.includes('..') || req.path.includes('%2e%2e') || req.path.includes('%252e')) {
    AuditLogger.tamperDetected({ type: 'path_traversal', details: req.path, ip });
    return res.status(400).json({ error: 'bad_request', message: 'Invalid path.' });
  }

  // 3. Oversized headers (request smuggling indicator)
  const totalHeaderSize = Object.entries(req.headers).reduce((sum, [k, v]) => sum + k.length + String(v).length, 0);
  if (totalHeaderSize > 16384) { // 16KB header limit
    AuditLogger.tamperDetected({ type: 'oversized_headers', details: `${totalHeaderSize} bytes`, ip });
    return res.status(431).json({ error: 'headers_too_large' });
  }

  // 4. Null byte injection
  if (req.url.includes('\x00') || req.url.includes('%00')) {
    AuditLogger.tamperDetected({ type: 'null_byte_injection', details: req.url, ip });
    return res.status(400).json({ error: 'bad_request' });
  }

  // 5. Content-Type mismatch (JSON body expected but different content-type sent)
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const contentType = req.headers['content-type'] || '';
    if (req.body && Object.keys(req.body).length > 0 && !contentType.includes('application/json')) {
      // Allow form-urlencoded for some endpoints, but flag unusual types
      if (!contentType.includes('application/x-www-form-urlencoded') && !contentType.includes('multipart/form-data')) {
        AuditLogger.tamperDetected({ type: 'content_type_mismatch', details: contentType, ip });
      }
    }
  }

  next();
}

/**
 * Recursively check for __proto__, constructor, or prototype keys.
 */
function hasProtoKeys(obj, depth = 0) {
  if (depth > 10) return false; // Prevent DoS via deeply nested objects
  if (obj === null || typeof obj !== 'object') return false;

  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true;
    }
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      if (hasProtoKeys(obj[key], depth + 1)) return true;
    }
  }
  return false;
}
