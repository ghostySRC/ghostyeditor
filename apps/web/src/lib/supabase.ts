/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
/** Cloud accounts are opt-in. Local editing never constructs an auth client. */
export const cloudAccountsEnabled = import.meta.env.VITE_ENABLE_CLOUD_ACCOUNT === 'true';

function initSupabase(): SupabaseClient | null {
  if (!cloudAccountsEnabled) return null;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[supabase] Cloud accounts are enabled but credentials are missing.');
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

export const supabase = initSupabase();
