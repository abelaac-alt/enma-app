import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isConfigured = Boolean(url && anonKey && !url.includes('TU-PROYECTO'));
export const supabase = isConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export async function signUp({ email, password, fullName, role }) {
  ensureClient();
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, role } }
  });
}

export async function signIn({ email, password }) {
  ensureClient();
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  ensureClient();
  return supabase.auth.signOut();
}

export async function getSession() {
  ensureClient();
  return supabase.auth.getSession();
}

export async function getProfile(userId) {
  ensureClient();
  return supabase.from('profiles').select('*').eq('id', userId).single();
}

export async function getWomanData(userId) {
  ensureClient();
  const [settingsResult, periodsResult, partnershipResult] = await Promise.all([
    supabase.from('cycle_settings').select('*').eq('user_id', userId).single(),
    supabase.from('periods').select('*').eq('user_id', userId).order('start_date', { ascending: true }),
    supabase.from('partnerships').select('id,woman_id,man_id,active,created_at').eq('woman_id', userId).eq('active', true).maybeSingle()
  ]);
  return { settingsResult, periodsResult, partnershipResult };
}

export async function getPartnerData(manId) {
  ensureClient();
  const partnership = await supabase
    .from('partnerships')
    .select('id,woman_id,man_id,active,created_at')
    .eq('man_id', manId)
    .eq('active', true)
    .maybeSingle();
  if (partnership.error || !partnership.data) return { partnership };
  const womanId = partnership.data.woman_id;
  const [profile, settings, periods] = await Promise.all([
    supabase.from('profiles').select('id,full_name,role').eq('id', womanId).single(),
    supabase.from('cycle_settings').select('*').eq('user_id', womanId).single(),
    supabase.from('periods').select('*').eq('user_id', womanId).order('start_date', { ascending: true })
  ]);
  return { partnership, profile, settings, periods };
}

export async function saveCycleSettings(userId, values) {
  ensureClient();
  return supabase.from('cycle_settings').upsert({ user_id: userId, ...values }, { onConflict: 'user_id' }).select().single();
}

export async function addPeriod(userId, { startDate, endDate }) {
  ensureClient();
  return supabase.from('periods').insert({
    user_id: userId,
    start_date: startDate,
    end_date: endDate || startDate
  }).select().single();
}

export async function updatePeriod(id, userId, { startDate, endDate }) {
  ensureClient();
  return supabase.from('periods').update({ start_date: startDate, end_date: endDate || startDate }).eq('id', id).eq('user_id', userId).select().single();
}

export async function deletePeriod(id, userId) {
  ensureClient();
  return supabase.from('periods').delete().eq('id', id).eq('user_id', userId);
}

export async function createPairCode() {
  ensureClient();
  return supabase.rpc('create_pairing_code');
}

export async function claimPairCode(code) {
  ensureClient();
  return supabase.rpc('claim_pairing_code', { p_code: code.trim().toUpperCase() });
}

export async function revokePartnership() {
  ensureClient();
  return supabase.rpc('revoke_partnership');
}

function ensureClient() {
  if (!supabase) throw new Error('Supabase no está configurado.');
}
