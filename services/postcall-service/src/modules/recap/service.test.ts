import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { MockLlmClient } from '@athena/sdk-llm';
import { runRecap } from './service.js';

// Note: full DB-backed integration test runs once Postgres is up. Here we only
// exercise the input-validation paths that don't require the DB.

describe('runRecap', () => {
  it('rejects empty workspaceId', async () => {
    await assert.rejects(() =>
      runRecap({ workspaceId: '', meetingId: '00000000-0000-0000-0000-000000000000' }, { llm: null }),
    );
  });

  it('rejects empty meetingId', async () => {
    await assert.rejects(() =>
      runRecap({ workspaceId: 'ws_a', meetingId: '' }, { llm: new MockLlmClient() }),
    );
  });
});
