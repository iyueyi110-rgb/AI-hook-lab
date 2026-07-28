BEGIN;

CREATE TABLE IF NOT EXISTS content_strategy_card (
  id TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS content_strategy_version (
  card_id TEXT NOT NULL REFERENCES content_strategy_card(id),
  version INTEGER NOT NULL CHECK (version > 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  status TEXT NOT NULL CHECK (status IN (
    'draft',
    'pending_review',
    'approved_experiment',
    'active',
    'rejected',
    'archived'
  )),
  scope_pairs JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (card_id, version)
);

CREATE TABLE IF NOT EXISTS content_strategy_evidence (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('real_user', 'evaluation_set', 'simulation')),
  eligibility TEXT NOT NULL CHECK (eligibility IN (
    'draft_only',
    'review_support',
    'activation_eligible'
  )),
  collected_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  FOREIGN KEY (card_id, strategy_version)
    REFERENCES content_strategy_version(card_id, version)
);

CREATE TABLE IF NOT EXISTS content_strategy_review (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  FOREIGN KEY (card_id, strategy_version)
    REFERENCES content_strategy_version(card_id, version)
);

CREATE TABLE IF NOT EXISTS creative_strategy_assignment (
  run_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL,
  applied_guidance_hash TEXT NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  FOREIGN KEY (card_id, strategy_version)
    REFERENCES content_strategy_version(card_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS content_strategy_version_one_active_per_card
  ON content_strategy_version(card_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS content_strategy_version_active_idx
  ON content_strategy_version(status, expires_at, activated_at DESC);
CREATE INDEX IF NOT EXISTS content_strategy_version_scope_idx
  ON content_strategy_version USING GIN(scope_pairs);
CREATE INDEX IF NOT EXISTS content_strategy_evidence_version_idx
  ON content_strategy_evidence(card_id, strategy_version, collected_at DESC);
CREATE INDEX IF NOT EXISTS content_strategy_review_version_idx
  ON content_strategy_review(card_id, strategy_version, created_at DESC);
CREATE INDEX IF NOT EXISTS creative_strategy_assignment_card_idx
  ON creative_strategy_assignment(card_id, strategy_version);

COMMIT;
