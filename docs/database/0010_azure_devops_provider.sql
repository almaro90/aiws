-- AIWS v0.6 Azure DevOps Services managed provider
-- aiws:migration foreign_keys=off

PRAGMA legacy_alter_table = ON;

ALTER TABLE connections RENAME TO connections_v05;

CREATE TABLE connections (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'con_'),
    provider TEXT NOT NULL CHECK (provider IN ('github', 'azure_devops')),
    host TEXT NOT NULL,
    external_account_id TEXT NOT NULL,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 255),
    installation_id TEXT,
    organization_id TEXT,
    organization_name TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('active', 'reauthorization_required', 'revoked')),
    refresh_token_ciphertext BLOB,
    refresh_token_iv BLOB,
    refresh_token_auth_tag BLOB,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
        (provider = 'github' AND installation_id IS NOT NULL
            AND organization_id IS NULL AND organization_name IS NULL)
        OR
        (provider = 'azure_devops' AND installation_id IS NULL
            AND organization_id IS NOT NULL AND organization_name IS NOT NULL)
    ),
    CHECK (
        (refresh_token_ciphertext IS NULL AND refresh_token_iv IS NULL
            AND refresh_token_auth_tag IS NULL)
        OR
        (provider = 'azure_devops' AND refresh_token_ciphertext IS NOT NULL
            AND refresh_token_iv IS NOT NULL AND refresh_token_auth_tag IS NOT NULL)
    )
) STRICT;

INSERT INTO connections(
    id, provider, host, external_account_id, display_name, installation_id,
    organization_id, organization_name, status, created_at, updated_at
)
SELECT id, provider, host, external_account_id, display_name, installation_id,
       NULL, NULL, status, created_at, updated_at
FROM connections_v05;

DROP TABLE connections_v05;

CREATE UNIQUE INDEX idx_connections_github_installation
    ON connections(host, installation_id)
    WHERE provider = 'github';
CREATE UNIQUE INDEX idx_connections_azure_organization
    ON connections(host, organization_id)
    WHERE provider = 'azure_devops';

CREATE TABLE azure_oauth_authorizations (
    id TEXT PRIMARY KEY CHECK (length(id) = 30 AND substr(id, 1, 4) = 'azr_'),
    state_hash TEXT NOT NULL UNIQUE CHECK (length(state_hash) = 64),
    code_verifier_ciphertext BLOB,
    code_verifier_iv BLOB,
    code_verifier_auth_tag BLOB,
    snapshot_ciphertext BLOB,
    snapshot_iv BLOB,
    snapshot_auth_tag BLOB,
    reauthorize_connection_id TEXT
        REFERENCES connections(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    callback_consumed_at TEXT,
    completed_at TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (
        (code_verifier_ciphertext IS NULL AND code_verifier_iv IS NULL
            AND code_verifier_auth_tag IS NULL)
        OR
        (code_verifier_ciphertext IS NOT NULL AND code_verifier_iv IS NOT NULL
            AND code_verifier_auth_tag IS NOT NULL)
    ),
    CHECK (
        (snapshot_ciphertext IS NULL AND snapshot_iv IS NULL AND snapshot_auth_tag IS NULL)
        OR
        (snapshot_ciphertext IS NOT NULL AND snapshot_iv IS NOT NULL
            AND snapshot_auth_tag IS NOT NULL)
    )
) STRICT;

CREATE INDEX idx_azure_oauth_authorizations_expires
    ON azure_oauth_authorizations(expires_at);
