// src/lib/aerolux/community.js
// supabase client, auth, Discord sync, community API
// currently defunct

import { createClient } from '@supabase/supabase-js';

// client setup ──────────────────────────────────────────────────────

const supabaseUrl = import.meta.env?.PUBLIC_SUPABASE_URL
    ?? (typeof window !== 'undefined' ? window.__AEROLUX_SUPABASE_URL : undefined);
const supabaseKey = import.meta.env?.PUBLIC_SUPABASE_ANON_KEY
    ?? (typeof window !== 'undefined' ? window.__AEROLUX_SUPABASE_KEY : undefined);

export const supabase = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

function requireSupabase() {
    if (!supabase) throw new Error('Community library is not configured');
    return supabase;
}

// membership cache (avoids hammering the sync endpoint) ─────────────

let _membershipCache = null; // { isMember, role, fetchedAt }
const CACHE_TTL_MS   = 5 * 60 * 1000; // 5 minutes

export function clearMembershipCache() {
    _membershipCache = null;
}

// auth ──────────────────────────────────────────────────────────────

export async function signInWithDiscord() {
    const client = requireSupabase();
    const { error } = await client.auth.signInWithOAuth({
        provider: 'discord',
        options: {
            scopes: 'identify guilds guilds.members.read',
        },
    });
    if (error) throw error;
}

export async function signOut() {
    const client = requireSupabase();
    clearMembershipCache();
    const { error } = await client.auth.signOut();
    if (error) throw error;
}

export async function getSession() {
    const client = requireSupabase();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
}

export function onAuthStateChange(callback) {
    if (!supabase) {
        callback(null, null);
        return { data: { subscription: { unsubscribe() {} } } };
    }
    return supabase.auth.onAuthStateChange((_event, session) => {
        callback(session);
    });
}

// profile upsert ────────────────────────────────────────────────────

export async function upsertProfile(session) {
    if (!session) return;
    const client = requireSupabase();
    const meta   = session.user.user_metadata;
    const { error } = await client.from('profiles').upsert({
        id:          session.user.id,
        discord_id:  meta.provider_id ?? meta.sub,
        username:    meta.full_name ?? meta.name ?? 'Unknown',
        avatar_url:  meta.avatar_url ?? null,
    }, { onConflict: 'id' });
    if (error) console.error('Profile upsert failed:', error);
}

// Discord role + membership sync ────────────────────────────────────
// called on sign-in and on each admin/preset page load
// returns { isMember, role } and caches the result for 5 minutes

export async function syncDiscordRoles(forceRefresh = false) {
    const client = requireSupabase();

    // return cache if fresh
    if (
        !forceRefresh &&
        _membershipCache &&
        Date.now() - _membershipCache.fetchedAt < CACHE_TTL_MS
    ) {
        return _membershipCache;
    }

    const { data: { session } } = await client.auth.getSession();
    if (!session) {
        _membershipCache = { isMember: false, role: null, fetchedAt: Date.now() };
        return _membershipCache;
    }

    const meta = session.user.user_metadata;
    const discordId = meta.provider_id ?? meta.sub;

    try {
        const res = await fetch('/api/aerolux/discord-sync', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                userId:    session.user.id,
                discordId,
            }),
        });

        if (!res.ok) throw new Error(`Sync endpoint returned ${res.status}`);

        const data = await res.json();
        _membershipCache = {
            isMember:  data.isMember  ?? false,
            role:      data.role      ?? null,
            fetchedAt: Date.now(),
        };

    } catch (err) {
        console.warn('Discord sync failed, using cached or default:', err.message);
        // don't overwrite a valid cache on transient failure
        if (!_membershipCache) {
            _membershipCache = { isMember: false, role: null, fetchedAt: Date.now() };
        }
    }

    return _membershipCache;
}

// convenience getter: resolves from cache without a network call
export async function getMembership() {
    return syncDiscordRoles(false);
}

// fingerprint (for anonymous download dedup) ────────────────────────

async function getFingerprint() {
    const raw = [
        navigator.userAgent,
        navigator.language,
        screen.width,
        screen.height,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    ].join('|');
    const buffer = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(raw)
    );
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// gradients ─────────────────────────────────────────────────────────

export async function fetchCommunityGradients(limit = 20, offset = 0) {
    const client = requireSupabase();
    const { data, error } = await client
        .from('gradients')
        .select(`
            id, name, description, author_id, download_count, flag_count,
            is_hidden, is_under_review, created_at,
            meta,
            profiles ( username, avatar_url, discord_id )
        `)
        .eq('is_hidden', false)
        .eq('is_under_review', false)
        .order('download_count', { ascending: false })
        .range(offset, offset + limit - 1);

    if (error) throw error;
    return data ?? [];
}

export async function fetchGradientState(gradientId) {
    const client = requireSupabase();
    const { data, error } = await client
        .from('gradients')
        .select('state')
        .eq('id', gradientId)
        .single();
    if (error) throw error;
    return data?.state ?? null;
}

export async function incrementDownload(gradientId) {
    try {
        const client = requireSupabase();
        const { data: { session } } = await client.auth.getSession();
        const fingerprint = await getFingerprint();

        await client.rpc('increment_download', {
            gradient_id: gradientId,
            user_id:     session?.user?.id ?? null,
            fingerprint,
        });
    } catch (e) {
        console.warn('Download increment failed:', e);
    }
}

export async function flagGradient(gradientId) {
    const client = requireSupabase();
    const { data: { session } } = await client.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const { error } = await client.from('flags').insert({
        gradient_id: gradientId,
        reporter_id: session.user.id,
    });
    if (error) {
        if (error.code === '23505') throw new Error('You have already flagged this gradient');
        throw error;
    }
}

export async function deleteGradient(gradientId) {
    const client = requireSupabase();
    const { error } = await client
        .from('gradients')
        .delete()
        .eq('id', gradientId);
    if (error) throw error;
}

// moderation ────────────────────────────────────────────────────────

async function moderateContent(text) {
    try {
        const response = await fetch('/api/aerolux/moderate', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ text }),
        });

        if (!response.ok) throw new Error('Moderation API unavailable');

        const data = await response.json();
        return ['clean', 'review', 'block'].includes(data.result)
            ? data.result
            : 'review';

    } catch (err) {
        // fail open: send to manual review rather than blocking publish
        console.warn('Moderation unavailable, failing open:', err.message);
        return 'review';
    }
}

// duplicate detection ───────────────────────────────────────────────

async function isDuplicate(velocities) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('check_gradient_duplicate', {
        velocity_sequence: JSON.stringify(velocities),
    });
    if (error) {
        console.warn('Duplicate check RPC failed, skipping:', error.message);
        return false; // fail open — don't block publish on a failed check
    }
    return data === true;
}

// publish ───────────────────────────────────────────────────────────

export async function publishGradient(name, description, state, meta) {
    const client = requireSupabase();
    const { data: { session } } = await client.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    // membership check
    const { isMember } = await getMembership();
    if (!isMember) {
        throw new Error('You must be a member of Airborne\'s Discord server to publish gradients.');
    }

    // duplicate check
    const duplicate = await isDuplicate(meta.velocities);
    if (duplicate) {
        throw new Error('This gradient already exists in the community library.');
    }

    // moderation
    const combined  = [name, description].filter(Boolean).join(' ');
    const modResult = await moderateContent(combined);

    if (modResult === 'block') {
        throw new Error(
            'Your gradient name or description was flagged by the automated moderation system. ' +
            'Please revise it and try again. If you think this is a mistake, contact a staff member.'
        );
    }

    const { data, error } = await client
        .from('gradients')
        .insert({
            name:            name.trim(),
            description:     description?.trim() ?? null,
            author_id:       session.user.id,
            state,
            meta,
            is_under_review: modResult === 'review',
        })
        .select()
        .single();

    if (error) throw error;
    return { ...data, underReview: modResult === 'review' };
}

// admin helpers ─────────────────────────────────────────────────────

export async function hideGradient(gradientId) {
    const client = requireSupabase();
    const { error } = await client
        .from('gradients')
        .update({ is_hidden: true })
        .eq('id', gradientId);
    if (error) throw error;
}

export async function approveGradient(gradientId) {
    const client = requireSupabase();
    const { error } = await client
        .from('gradients')
        .update({ is_hidden: false, is_under_review: false, flag_count: 0 })
        .eq('id', gradientId);
    if (error) throw error;
}

export async function fetchFlaggedGradients() {
    const client = requireSupabase();
    const { data, error } = await client
        .from('gradients')
        .select(`
            id, name, description, flag_count, is_hidden, is_under_review,
            profiles ( username, avatar_url )
        `)
        .or('flag_count.gt.0,is_under_review.eq.true')
        .order('flag_count', { ascending: false });
    if (error) throw error;
    return data ?? [];
}

export async function grantRole(userId, role) {
    const client = requireSupabase();
    const { error } = await client
        .from('user_roles')
        .insert({ user_id: userId, role });
    if (error) throw error;
}

export async function revokeRole(userId, role) {
    const client = requireSupabase();
    const { error } = await client
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', role);
    if (error) throw error;
}