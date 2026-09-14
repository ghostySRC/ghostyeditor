import assert from 'node:assert/strict';
import test from 'node:test';

import { LOCAL_OFFLINE_USER, appUserForSession } from '../src/lib/local-session.ts';

test('uses one stable anonymous identity when no cloud session exists', () => {
  assert.equal(appUserForSession(null), LOCAL_OFFLINE_USER);
  assert.equal(LOCAL_OFFLINE_USER.mode, 'local');
  assert.equal(LOCAL_OFFLINE_USER.id, 'local-offline-user');
  assert.deepEqual(LOCAL_OFFLINE_USER.identities, []);
});
