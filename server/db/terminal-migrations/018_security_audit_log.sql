-- ══════════════════════════════════════════════════════════════════
-- MIGRATION 018: Security Audit Log Table
-- Required for: AuditLogger service, tamper detection, compliance
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS security_audit_log (
    id BIGSERIAL PRIMARY KEY,
    event VARCHAR(50) NOT NULL,
    severity VARCHAR(10) NOT NULL DEFAULT 'info',
    data JSONB NOT NULL DEFAULT '{}',
    server_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_security_audit_event ON security_audit_log(event);
CREATE INDEX idx_security_audit_severity ON security_audit_log(severity) WHERE severity IN ('critical', 'high');
CREATE INDEX idx_security_audit_created ON security_audit_log(created_at DESC);
CREATE INDEX idx_security_audit_user ON security_audit_log((data->>'userId')) WHERE data->>'userId' IS NOT NULL;

-- Partition by month for production (optional, uncomment if needed)
-- CREATE TABLE security_audit_log_partition PARTITION OF security_audit_log
--   FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- RLS (service role bypasses)
ALTER TABLE security_audit_log ENABLE ROW LEVEL SECURITY;

-- Retention policy: auto-delete entries older than 90 days (via cron/scheduled function)
-- SELECT cron.schedule('cleanup_audit_log', '0 3 * * *',
--   $$DELETE FROM security_audit_log WHERE created_at < NOW() - INTERVAL '90 days'$$
-- );

COMMENT ON TABLE security_audit_log IS 'Security event audit trail. Every auth failure, IDOR attempt, kill switch, trade action is logged here.';
