/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { User } from '@supabase/supabase-js';

/** The identity shape the editor needs, independent of a cloud session. */
export type AppUser = Pick<
  User,
  'id' | 'email' | 'user_metadata' | 'app_metadata' | 'identities' | 'email_confirmed_at'
> & {
  mode: 'local' | 'cloud';
};

/**
 * A stable, deliberately non-cloud identity for local-first editing.
 *
 * It is not a Supabase session and is never used as an authorization token.
 * Keeping it here gives editor integrations one safe user shape without
 * inventing account values at each call site.
 */
export const LOCAL_OFFLINE_USER: AppUser = {
  id: 'local-offline-user',
  email: undefined,
  user_metadata: { full_name: 'Local mode' },
  app_metadata: { provider: 'local' },
  identities: [],
  email_confirmed_at: undefined,
  mode: 'local',
};

export function appUserForSession(sessionUser: User | null | undefined): AppUser {
  return sessionUser
    ? { ...sessionUser, mode: 'cloud' }
    : LOCAL_OFFLINE_USER;
}
