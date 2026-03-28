/**
 * Echo Gamer Companion — GGI Apex Predator Cloud Backend v1.0.0
 * AI-powered gaming companion: session tracking, training drills,
 * pro player profiles, team coordination, strategy knowledge.
 */

interface Env {
  DB: D1Database;
  GC_CACHE: KVNamespace;
  ENGINE_RUNTIME: Fetcher;
  SHARED_BRAIN: Fetcher;
  ECHO_API_KEY: string;
}

interface RLState { c: number; t: number }

/* ── Helpers ── */
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'X-XSS-Protection': '1; mode=block', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } });
}

function slog(level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, worker: 'echo-gamer-companion', version: '1.0.0', msg, ...data };
  if (level === 'error') console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

function sanitize(s: string | null | undefined, max = 500): string {
  if (!s) return '';
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, max);
}

function authOk(req: Request, env: Env): boolean {
  const k = req.headers.get('X-Echo-API-Key') || req.headers.get('Authorization')?.replace('Bearer ', '') || new URL(req.url).searchParams.get('key');
  return k === env.ECHO_API_KEY;
}

async function rateLimit(kv: KVNamespace, key: string, limit: number, windowSec: number): Promise<boolean> {
  const raw = await kv.get<RLState>(`rl:${key}`, 'json');
  const now = Date.now();
  if (!raw || (now - raw.t) > windowSec * 1000) {
    await kv.put(`rl:${key}`, JSON.stringify({ c: 1, t: now }), { expirationTtl: windowSec * 2 });
    return false;
  }
  const elapsed = (now - raw.t) / 1000;
  const decay = Math.max(0, raw.c - (elapsed / windowSec) * limit);
  if (decay + 1 > limit) return true;
  await kv.put(`rl:${key}`, JSON.stringify({ c: decay + 1, t: now }), { expirationTtl: windowSec * 2 });
  return false;
}

function slug(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });

    const url = new URL(req.url);
    const p = url.pathname;
    const m = req.method;

    try {
      /* ══════════════════ PUBLIC ══════════════════ */

      if (p === '/') return json({ name: 'echo-gamer-companion', status: 'ok', version: '1.0.0', docs: '/health', timestamp: new Date().toISOString() });
      if (p === '/health') return json({ status: 'ok', service: 'echo-gamer-companion', version: '1.0.0', timestamp: new Date().toISOString() });

      /* ── Public leaderboard ── */
      if (m === 'GET' && p.startsWith('/lb/')) {
        const gameSlug = p.split('/')[2];
        const season = url.searchParams.get('season') || '2026-S1';
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
        const cached = await env.GC_CACHE.get(`lb:${gameSlug}:${season}`, 'json');
        if (cached) return json({ success: true, data: cached, cached: true });
        const rows = await env.DB.prepare('SELECT l.*, p.username, p.avatar_url FROM leaderboard l JOIN players p ON l.player_id = p.id WHERE l.game_slug = ? AND l.season = ? ORDER BY l.score DESC LIMIT ?').bind(gameSlug, season, limit).all();
        if (rows.results.length) await env.GC_CACHE.put(`lb:${gameSlug}:${season}`, JSON.stringify(rows.results), { expirationTtl: 300 });
        return json({ success: true, data: rows.results });
      }

      /* ── Public game catalog ── */
      if (m === 'GET' && p === '/games') {
        const cached = await env.GC_CACHE.get('games:all', 'json');
        if (cached) return json({ success: true, data: cached, cached: true });
        const rows = await env.DB.prepare('SELECT * FROM games WHERE status = ? ORDER BY total_sessions DESC').bind('active').all();
        await env.GC_CACHE.put('games:all', JSON.stringify(rows.results), { expirationTtl: 600 });
        return json({ success: true, data: rows.results });
      }

      /* ── Public pro profiles ── */
      if (m === 'GET' && p === '/pros') {
        const game = url.searchParams.get('game');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
        let q = 'SELECT * FROM pro_profiles';
        const binds: unknown[] = [];
        if (game) { q += ' WHERE game_slug = ?'; binds.push(game); }
        q += ' ORDER BY total_mimics DESC LIMIT ?';
        binds.push(limit);
        const rows = await env.DB.prepare(q).bind(...binds).all();
        return json({ success: true, data: rows.results });
      }

      /* ── Public strategies ── */
      if (m === 'GET' && p === '/strategies/public') {
        const game = url.searchParams.get('game');
        const map = url.searchParams.get('map');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
        let q = 'SELECT * FROM strategies WHERE team_id IS NULL';
        const binds: unknown[] = [];
        if (game) { q += ' AND game_slug = ?'; binds.push(game); }
        if (map) { q += ' AND map_name = ?'; binds.push(map); }
        q += ' ORDER BY times_used DESC LIMIT ?';
        binds.push(limit);
        const rows = await env.DB.prepare(q).bind(...binds).all();
        return json({ success: true, data: rows.results });
      }

      /* ── Public drill catalog ── */
      if (m === 'GET' && p === '/drills') {
        const game = url.searchParams.get('game_id');
        const type = url.searchParams.get('type');
        let q = 'SELECT * FROM training_drills WHERE 1=1';
        const binds: unknown[] = [];
        if (game) { q += ' AND game_id = ?'; binds.push(parseInt(game)); }
        if (type) { q += ' AND type = ?'; binds.push(type); }
        q += ' ORDER BY total_attempts DESC';
        const rows = await env.DB.prepare(q).bind(...binds).all();
        return json({ success: true, data: rows.results });
      }

      /* ── Join team by invite code ── */
      if (m === 'POST' && p === '/teams/join') {
        if (await rateLimit(env.GC_CACHE, `join:${req.headers.get('CF-Connecting-IP') || 'u'}`, 10, 60)) return json({ error: 'Rate limited' }, 429);
        const b = await req.json() as Record<string, unknown>;
        const code = sanitize(b.invite_code as string, 20);
        const playerId = parseInt(b.player_id as string);
        if (!code || !playerId) return json({ error: 'invite_code and player_id required' }, 400);
        const team = await env.DB.prepare('SELECT * FROM teams WHERE invite_code = ?').bind(code).first();
        if (!team) return json({ error: 'Invalid invite code' }, 404);
        if ((team.total_members as number) >= (team.max_members as number)) return json({ error: 'Team is full' }, 400);
        const existing = await env.DB.prepare('SELECT id FROM team_members WHERE team_id = ? AND player_id = ?').bind(team.id, playerId).first();
        if (existing) return json({ error: 'Already a member' }, 409);
        await env.DB.prepare('INSERT INTO team_members (team_id, player_id, role) VALUES (?, ?, ?)').bind(team.id, playerId, 'member').run();
        await env.DB.prepare('UPDATE teams SET total_members = total_members + 1 WHERE id = ?').bind(team.id).run();
        return json({ success: true, team_id: team.id, team_name: team.name });
      }

      /* ══════════════════ AUTH REQUIRED ══════════════════ */
      if (!authOk(req, env)) return json({ error: 'Unauthorized' }, 401);

      /* ── Players CRUD ── */
      if (m === 'GET' && p === '/players') {
        const search = url.searchParams.get('q');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
        let q = 'SELECT * FROM players WHERE 1=1';
        const binds: unknown[] = [];
        if (search) { q += ' AND (username LIKE ? OR email LIKE ?)'; binds.push(`%${search}%`, `%${search}%`); }
        q += ' ORDER BY xp DESC LIMIT ?';
        binds.push(limit);
        const rows = await env.DB.prepare(q).bind(...binds).all();
        return json({ success: true, data: rows.results, total: rows.results.length });
      }

      if (m === 'GET' && p.match(/^\/players\/\d+$/)) {
        const id = parseInt(p.split('/')[2]);
        const player = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(id).first();
        if (!player) return json({ error: 'Resource not found' }, 404);
        const profiles = await env.DB.prepare('SELECT gp.*, g.name as game_name, g.slug as game_slug FROM game_profiles gp JOIN games g ON gp.game_id = g.id WHERE gp.player_id = ?').bind(id).all();
        const recentSessions = await env.DB.prepare('SELECT s.*, g.name as game_name FROM sessions s JOIN games g ON s.game_id = g.id WHERE s.player_id = ? ORDER BY s.created_at DESC LIMIT 10').bind(id).all();
        return json({ success: true, data: { ...player, game_profiles: profiles.results, recent_sessions: recentSessions.results } });
      }

      if (m === 'POST' && p === '/players') {
        const b = await req.json() as Record<string, unknown>;
        const username = sanitize(b.username as string, 50);
        if (!username) return json({ error: 'username required' }, 400);
        const r = await env.DB.prepare('INSERT INTO players (username, email, steam_id, discord_id, avatar_url, settings) VALUES (?, ?, ?, ?, ?, ?)').bind(username, sanitize(b.email as string, 200), sanitize(b.steam_id as string, 50), sanitize(b.discord_id as string, 50), sanitize(b.avatar_url as string, 500), JSON.stringify(b.settings || {})).run();
        return json({ success: true, id: r.meta.last_row_id }, 201);
      }

      if (m === 'PATCH' && p.match(/^\/players\/\d+$/)) {
        const id = parseInt(p.split('/')[2]);
        const b = await req.json() as Record<string, unknown>;
        const sets: string[] = []; const vals: unknown[] = [];
        if (b.email !== undefined) { sets.push('email = ?'); vals.push(sanitize(b.email as string, 200)); }
        if (b.steam_id !== undefined) { sets.push('steam_id = ?'); vals.push(sanitize(b.steam_id as string, 50)); }
        if (b.discord_id !== undefined) { sets.push('discord_id = ?'); vals.push(sanitize(b.discord_id as string, 50)); }
        if (b.avatar_url !== undefined) { sets.push('avatar_url = ?'); vals.push(sanitize(b.avatar_url as string, 500)); }
        if (b.settings !== undefined) { sets.push('settings = ?'); vals.push(JSON.stringify(b.settings)); }
        if (b.xp !== undefined) { sets.push('xp = ?'); vals.push(b.xp); }
        if (b.level !== undefined) { sets.push('level = ?'); vals.push(b.level); }
        if (b.rank !== undefined) { sets.push('rank = ?'); vals.push(sanitize(b.rank as string, 30)); }
        if (sets.length === 0) return json({ error: 'Nothing to update' }, 400);
        sets.push("updated_at = datetime('now')");
        vals.push(id);
        await env.DB.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
        return json({ success: true });
      }

      /* ── Games CRUD ── */
      if (m === 'POST' && p === '/games') {
        const b = await req.json() as Record<string, unknown>;
        const name = sanitize(b.name as string, 100);
        if (!name) return json({ error: 'name required' }, 400);
        const s = slug(name);
        const r = await env.DB.prepare('INSERT INTO games (slug, name, genre, icon, supported_modes, default_settings, detection_process, detection_steam_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(s, name, sanitize(b.genre as string, 50), sanitize(b.icon as string, 10), JSON.stringify(b.supported_modes || ['observe', 'assist', 'coach']), JSON.stringify(b.default_settings || {}), sanitize(b.detection_process as string, 100), sanitize(b.detection_steam_id as string, 30)).run();
        return json({ success: true, id: r.meta.last_row_id, slug: s }, 201);
      }

      if (m === 'PATCH' && p.match(/^\/games\/\d+$/)) {
        const id = parseInt(p.split('/')[2]);
        const b = await req.json() as Record<string, unknown>;
        const sets: string[] = []; const vals: unknown[] = [];
        if (b.name !== undefined) { sets.push('name = ?'); vals.push(sanitize(b.name as string, 100)); }
        if (b.genre !== undefined) { sets.push('genre = ?'); vals.push(sanitize(b.genre as string, 50)); }
        if (b.supported_modes !== undefined) { sets.push('supported_modes = ?'); vals.push(JSON.stringify(b.supported_modes)); }
        if (b.default_settings !== undefined) { sets.push('default_settings = ?'); vals.push(JSON.stringify(b.default_settings)); }
        if (b.status !== undefined) { sets.push('status = ?'); vals.push(sanitize(b.status as string, 20)); }
        if (sets.length === 0) return json({ error: 'Nothing to update' }, 400);
        vals.push(id);
        await env.DB.prepare(`UPDATE games SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
        return json({ success: true });
      }

      /* ── Game Profiles ── */
      if (m === 'GET' && p.match(/^\/players\/\d+\/profiles$/)) {
        const playerId = parseInt(p.split('/')[2]);
        const rows = await env.DB.prepare('SELECT gp.*, g.name as game_name, g.slug as game_slug FROM game_profiles gp JOIN games g ON gp.game_id = g.id WHERE gp.player_id = ?').bind(playerId).all();
        return json({ success: true, data: rows.results });
      }

      if (m === 'PUT' && p.match(/^\/players\/\d+\/profiles\/\d+$/)) {
        const parts = p.split('/');
        const playerId = parseInt(parts[2]);
        const gameId = parseInt(parts[4]);
        const b = await req.json() as Record<string, unknown>;
        await env.DB.prepare(`INSERT INTO game_profiles (player_id, game_id, skill_level, aggression, reaction_time_ms, dpi, sensitivity, preferred_mode, session_limit_hours, keybinds, stats)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(player_id, game_id) DO UPDATE SET
            skill_level=excluded.skill_level, aggression=excluded.aggression, reaction_time_ms=excluded.reaction_time_ms,
            dpi=excluded.dpi, sensitivity=excluded.sensitivity, preferred_mode=excluded.preferred_mode,
            session_limit_hours=excluded.session_limit_hours, keybinds=excluded.keybinds, stats=excluded.stats, updated_at=datetime('now')
        `).bind(playerId, gameId, sanitize(b.skill_level as string, 30) || 'intermediate', b.aggression ?? 0.5, b.reaction_time_ms ?? 200, b.dpi ?? 800, b.sensitivity ?? 1.0, sanitize(b.preferred_mode as string, 20) || 'assist', b.session_limit_hours ?? 4, JSON.stringify(b.keybinds || {}), JSON.stringify(b.stats || {})).run();
        return json({ success: true });
      }

      /* ── Sessions ── */
      if (m === 'GET' && p === '/sessions') {
        const playerId = url.searchParams.get('player_id');
        const gameId = url.searchParams.get('game_id');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
        let q = 'SELECT s.*, g.name as game_name FROM sessions s JOIN games g ON s.game_id = g.id WHERE 1=1';
        const binds: unknown[] = [];
        if (playerId) { q += ' AND s.player_id = ?'; binds.push(parseInt(playerId)); }
        if (gameId) { q += ' AND s.game_id = ?'; binds.push(parseInt(gameId)); }
        q += ' ORDER BY s.created_at DESC LIMIT ?';
        binds.push(limit);
        const rows = await env.DB.prepare(q).bind(...binds).all();
        return json({ success: true, data: rows.results });
      }

      if (m === 'POST' && p === '/sessions') {
        const b = await req.json() as Record<string, unknown>;
        const playerId = b.player_id as number;
        const gameId = b.game_id as number;
        const mode = sanitize(b.mode as string, 20) || 'observe';
        if (!playerId || !gameId) return json({ error: 'player_id and game_id required' }, 400);
        const r = await env.DB.prepare('INSERT INTO sessions (player_id, game_id, mode, map_name, metadata) VALUES (?, ?, ?, ?, ?)').bind(playerId, gameId, mode, sanitize(b.map_name as string, 50), JSON.stringify(b.metadata || {})).run();
        return json({ success: true, id: r.meta.last_row_id }, 201);
      }

      if (m === 'PATCH' && p.match(/^\/sessions\/\d+$/)) {
        const id = parseInt(p.split('/')[2]);
        const b = await req.json() as Record<string, unknown>;
        const sets: string[] = []; const vals: unknown[] = [];
        if (b.ended_at !== undefined) { sets.push('ended_at = ?'); vals.push(b.ended_at); }
        if (b.duration_min !== undefined) { sets.push('duration_min = ?'); vals.push(b.duration_min); }
        if (b.kills !== undefined) { sets.push('kills = ?'); vals.push(b.kills); }
        if (b.deaths !== undefined) { sets.push('deaths = ?'); vals.push(b.deaths); }
        if (b.assists !== undefined) { sets.push('assists = ?'); vals.push(b.assists); }
        if (b.score !== undefined) { sets.push('score = ?'); vals.push(b.score); }
        if (b.result !== undefined) { sets.push('result = ?'); vals.push(sanitize(b.result as string, 20)); }
        if (b.ai_actions !== undefined) { sets.push('ai_actions = ?'); vals.push(b.ai_actions); }
        if (b.ai_suggestions !== undefined) { sets.push('ai_suggestions = ?'); vals.push(b.ai_suggestions); }
        if (b.ai_accuracy !== undefined) { sets.push('ai_accuracy = ?'); vals.push(b.ai_accuracy); }
        if (b.mistakes !== undefined) { sets.push('mistakes = ?'); vals.push(JSON.stringify(b.mistakes)); }
        if (b.highlights !== undefined) { sets.push('highlights = ?'); vals.push(JSON.stringify(b.highlights)); }
        if (sets.length === 0) return json({ error: 'Nothing to update' }, 400);
        vals.push(id);
        await env.DB.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
        // Update player aggregate stats
        const session = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first();
        if (session && b.ended_at) {
          await env.DB.prepare(`UPDATE players SET total_sessions = total_sessions + 1, total_hours = total_hours + ?, total_kills = total_kills + ?, total_deaths = total_deaths + ?, total_wins = total_wins + ?, total_losses = total_losses + ?, updated_at = datetime('now') WHERE id = ?`).bind((b.duration_min as number || 0) / 60, b.kills || 0, b.deaths || 0, b.result === 'win' ? 1 : 0, b.result === 'loss' ? 1 : 0, session.player_id).run();
          await env.DB.prepare('UPDATE game_profiles SET total_sessions = total_sessions + 1, total_hours = total_hours + ?, updated_at = datetime(\'now\') WHERE player_id = ? AND game_id = ?').bind((b.duration_min as number || 0) / 60, session.player_id, session.game_id).run();
          await env.DB.prepare('UPDATE games SET total_sessions = total_sessions + 1 WHERE id = ?').bind(session.game_id).run();
        }
        return json({ success: true });
      }

      /* ── Training Drills ── */
      if (m === 'POST' && p === '/drills') {
        const b = await req.json() as Record<string, unknown>;
        const name = sanitize(b.name as string, 100);
        if (!name) return json({ error: 'name required' }, 400);
        const r = await env.DB.prepare('INSERT INTO training_drills (game_id, name, type, difficulty, description, config, max_score) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(b.game_id || null, name, sanitize(b.type as string, 30) || 'aim', sanitize(b.difficulty as string, 20) || 'medium', sanitize(b.description as string, 500), JSON.stringify(b.config || {}), b.max_score || 100).run();
        return json({ success: true, id: r.meta.last_row_id }, 201);
      }

      if (m === 'POST' && p === '/drills/attempt') {
        const b = await req.json() as Record<string, unknown>;
        const drillId = b.drill_id as number;
        const playerId = b.player_id as number;
        const score = b.score as number;
        if (!drillId || !playerId || score === undefined) return json({ error: 'drill_id, player_id, score required' }, 400);
        await env.DB.prepare('INSERT INTO drill_attempts (player_id, drill_id, score, accuracy, time_ms, details) VALUES (?, ?, ?, ?, ?, ?)').bind(playerId, drillId, score, b.accuracy || 0, b.time_ms || 0, JSON.stringify(b.details || {})).run();
        await env.DB.prepare('UPDATE training_drills SET total_attempts = total_attempts + 1, avg_score = (SELECT AVG(score) FROM drill_attempts WHERE drill_id = ?) WHERE id = ?').bind(drillId, drillId).run();
        // Update best_score on game_profile
        const drill = await env.DB.prepare('SELECT game_id FROM training_drills WHERE id = ?').bind(drillId).first();
        if (drill && drill.game_id) {
          await env.DB.prepare('UPDATE game_profiles SET best_score = MAX(best_score, ?), avg_score = (SELECT AVG(score) FROM drill_attempts da JOIN training_drills td ON da.drill_id = td.id WHERE da.player_id = ? AND td.game_id = ?), updated_at = datetime(\'now\') WHERE player_id = ? AND game_id = ?').bind(score, playerId, drill.game_id, playerId, drill.game_id).run();
        }
        return json({ success: true });
      }

      if (m === 'GET' && p.match(/^\/drills\/\d+\/history$/)) {
        const drillId = parseInt(p.split('/')[2]);
        const playerId = url.searchParams.get('player_id');
        let q = 'SELECT * FROM drill_attempts WHERE drill_id = ?';
        const binds: unknown[] = [drillId];
        if (playerId) { q += ' AND player_id = ?'; binds.push(parseInt(playerId)); }
        q += ' ORDER BY created_at DESC LIMIT 50';
        const rows = await env.DB.prepare(q).bind(...binds).all();
        return json({ success: true, data: rows.results });
      }

      /* ── Pro Profiles ── */
      if (m === 'POST' && p === '/pros') {
        const b = await req.json() as Record<string, unknown>;
        const name = sanitize(b.name as string, 100);
        if (!name) return json({ error: 'name required' }, 400);
        const r = await env.DB.prepare('INSERT INTO pro_profiles (name, game_slug, team, region, role, playstyle, settings, patterns, stats, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(name, sanitize(b.game_slug as string, 50), sanitize(b.team as string, 50), sanitize(b.region as string, 20), sanitize(b.role as string, 30), sanitize(b.playstyle as string, 100), JSON.stringify(b.settings || {}), JSON.stringify(b.patterns || {}), JSON.stringify(b.stats || {}), sanitize(b.source_url as string, 500)).run();
        return json({ success: true, id: r.meta.last_row_id }, 201);
      }

      if (m === 'POST' && p.match(/^\/pros\/\d+\/mimic$/)) {
        const id = parseInt(p.split('/')[2]);
        await env.DB.prepare('UPDATE pro_profiles SET total_mimics = total_mimics + 1 WHERE id = ?').bind(id).run();
        return json({ success: true });
      }

      /* ── Teams ── */
      if (m === 'GET' && p === '/teams') {
        const rows = await env.DB.prepare('SELECT * FROM teams ORDER BY total_members DESC').all();
        return json({ success: true, data: rows.results });
      }

      if (m === 'POST' && p === '/teams') {
        const b = await req.json() as Record<string, unknown>;
        const name = sanitize(b.name as string, 50);
        if (!name) return json({ error: 'name required' }, 400);
        const inviteCode = Math.random().toString(36).slice(2, 10).toUpperCase();
        const r = await env.DB.prepare('INSERT INTO teams (name, tag, game_slug, captain_id, invite_code, max_members, settings) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(name, sanitize(b.tag as string, 10), sanitize(b.game_slug as string, 50), b.captain_id || null, inviteCode, b.max_members || 10, JSON.stringify(b.settings || {})).run();
        // Add captain as member
        if (b.captain_id) {
          await env.DB.prepare('INSERT INTO team_members (team_id, player_id, role) VALUES (?, ?, ?)').bind(r.meta.last_row_id, b.captain_id, 'captain').run();
          await env.DB.prepare('UPDATE teams SET total_members = 1 WHERE id = ?').bind(r.meta.last_row_id).run();
        }
        return json({ success: true, id: r.meta.last_row_id, invite_code: inviteCode }, 201);
      }

      if (m === 'GET' && p.match(/^\/teams\/\d+$/)) {
        const id = parseInt(p.split('/')[2]);
        const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first();
        if (!team) return json({ error: 'Resource not found' }, 404);
        const members = await env.DB.prepare('SELECT tm.*, p.username, p.avatar_url, p.rank FROM team_members tm JOIN players p ON tm.player_id = p.id WHERE tm.team_id = ?').bind(id).all();
        const strategies = await env.DB.prepare('SELECT * FROM strategies WHERE team_id = ? ORDER BY times_used DESC').bind(id).all();
        return json({ success: true, data: { ...team, members: members.results, strategies: strategies.results } });
      }

      /* ── Strategies ── */
      if (m === 'POST' && p === '/strategies') {
        const b = await req.json() as Record<string, unknown>;
        const name = sanitize(b.name as string, 100);
        if (!name) return json({ error: 'name required' }, 400);
        const r = await env.DB.prepare('INSERT INTO strategies (team_id, game_slug, name, map_name, type, description, steps, positions, utility, callouts, ai_generated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(b.team_id || null, sanitize(b.game_slug as string, 50), name, sanitize(b.map_name as string, 50), sanitize(b.type as string, 20) || 'offensive', sanitize(b.description as string, 1000), JSON.stringify(b.steps || []), JSON.stringify(b.positions || []), JSON.stringify(b.utility || []), JSON.stringify(b.callouts || []), b.ai_generated ? 1 : 0).run();
        return json({ success: true, id: r.meta.last_row_id }, 201);
      }

      if (m === 'POST' && p.match(/^\/strategies\/\d+\/use$/)) {
        const id = parseInt(p.split('/')[2]);
        await env.DB.prepare('UPDATE strategies SET times_used = times_used + 1, updated_at = datetime(\'now\') WHERE id = ?').bind(id).run();
        return json({ success: true });
      }

      /* ── Leaderboard management ── */
      if (m === 'POST' && p === '/leaderboard/update') {
        const b = await req.json() as Record<string, unknown>;
        const gameSlug = sanitize(b.game_slug as string, 50);
        const playerId = b.player_id as number;
        const season = sanitize(b.season as string, 20) || '2026-S1';
        if (!gameSlug || !playerId) return json({ error: 'game_slug and player_id required' }, 400);
        await env.DB.prepare(`INSERT INTO leaderboard (game_slug, player_id, season, score, wins, losses, kd_ratio, avg_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_slug, player_id, season) DO UPDATE SET score=excluded.score, wins=excluded.wins, losses=excluded.losses, kd_ratio=excluded.kd_ratio, avg_score=excluded.avg_score, updated_at=datetime('now')`).bind(gameSlug, playerId, season, b.score || 0, b.wins || 0, b.losses || 0, b.kd_ratio || 0, b.avg_score || 0).run();
        // Recalculate ranks
        await env.DB.prepare(`UPDATE leaderboard SET rank = (SELECT COUNT(*) + 1 FROM leaderboard l2 WHERE l2.game_slug = leaderboard.game_slug AND l2.season = leaderboard.season AND l2.score > leaderboard.score) WHERE game_slug = ? AND season = ?`).bind(gameSlug, season).run();
        await env.GC_CACHE.delete(`lb:${gameSlug}:${season}`);
        return json({ success: true });
      }

      /* ── AI Endpoints ── */
      if (m === 'POST' && p === '/ai/analyze-session') {
        const b = await req.json() as Record<string, unknown>;
        const sessionId = b.session_id as number;
        if (!sessionId) return json({ error: 'session_id required' }, 400);
        const session = await env.DB.prepare('SELECT s.*, g.name as game_name FROM sessions s JOIN games g ON s.game_id = g.id WHERE s.id = ?').bind(sessionId).first();
        if (!session) return json({ error: 'Session not found' }, 404);
        const prompt = `Analyze this gaming session and provide improvement tips:\nGame: ${session.game_name}\nMode: ${session.mode}\nDuration: ${session.duration_min}min\nK/D/A: ${session.kills}/${session.deaths}/${session.assists}\nScore: ${session.score}\nResult: ${session.result}\nMap: ${session.map_name}\nMistakes: ${JSON.stringify(session.mistakes)}\nHighlights: ${JSON.stringify(session.highlights)}\n\nProvide 3-5 specific actionable tips.`;
        try {
          const aiRes = await env.ENGINE_RUNTIME.fetch(new Request('https://engine/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine_id: 'GEN-01', query: prompt, max_tokens: 500 }) }));
          const aiData = await aiRes.json() as Record<string, unknown>;
          return json({ success: true, analysis: aiData });
        } catch { return json({ success: true, analysis: { tips: ['Practice aim for 10 min before ranked', 'Review minimap every 5 seconds', 'Work on crosshair placement at head level'] } }); }
      }

      if (m === 'POST' && p === '/ai/generate-strategy') {
        const b = await req.json() as Record<string, unknown>;
        const game = sanitize(b.game as string, 50);
        const map = sanitize(b.map as string, 50);
        const teamSize = b.team_size || 5;
        if (!game || !map) return json({ error: 'game and map required' }, 400);
        const prompt = `Generate a competitive ${game} strategy for map ${map} with ${teamSize} players. Include:\n1. Team composition and roles\n2. Opening strategy (first 30 seconds)\n3. Mid-round rotation\n4. Key positions and callouts\n5. Utility usage plan\n6. Counter-strategy considerations\nFormat as structured tactical guide.`;
        try {
          const aiRes = await env.ENGINE_RUNTIME.fetch(new Request('https://engine/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine_id: 'GEN-01', query: prompt, max_tokens: 800 }) }));
          const aiData = await aiRes.json() as Record<string, unknown>;
          return json({ success: true, strategy: aiData });
        } catch { return json({ success: true, strategy: { error: 'Engine unavailable, try again' } }); }
      }

      if (m === 'POST' && p === '/ai/recommend-settings') {
        const b = await req.json() as Record<string, unknown>;
        const playerId = b.player_id as number;
        const gameId = b.game_id as number;
        if (!playerId || !gameId) return json({ error: 'player_id and game_id required' }, 400);
        const sessions = await env.DB.prepare('SELECT * FROM sessions WHERE player_id = ? AND game_id = ? ORDER BY created_at DESC LIMIT 20').bind(playerId, gameId).all();
        const profile = await env.DB.prepare('SELECT * FROM game_profiles WHERE player_id = ? AND game_id = ?').bind(playerId, gameId).first();
        const avgKD = sessions.results.length ? sessions.results.reduce((a: number, s: Record<string, unknown>) => a + ((s.kills as number) / Math.max(1, s.deaths as number)), 0) / sessions.results.length : 0;
        const avgScore = sessions.results.length ? sessions.results.reduce((a: number, s: Record<string, unknown>) => a + (s.score as number), 0) / sessions.results.length : 0;
        return json({
          success: true,
          recommendations: {
            current: { dpi: profile?.dpi, sensitivity: profile?.sensitivity, aggression: profile?.aggression },
            avg_kd: Math.round(avgKD * 100) / 100,
            avg_score: Math.round(avgScore * 100) / 100,
            tips: avgKD < 1 ? ['Lower sensitivity for better aim control', 'Reduce aggression — play more positions', 'Practice aim drills 15 min/day'] : avgKD < 2 ? ['Good fundamentals — focus on game sense', 'Study pro player positioning', 'Try Coach mode for real-time callouts'] : ['Elite stats — try Mimic mode with pro profiles', 'Focus on team coordination (Swarm mode)', 'Consider competitive play'],
          }
        });
      }

      /* ── Analytics ── */
      if (m === 'GET' && p === '/analytics/overview') {
        const cached = await env.GC_CACHE.get('analytics:overview', 'json');
        if (cached) return json({ success: true, data: cached, cached: true });
        const players = await env.DB.prepare('SELECT COUNT(*) as c FROM players').first();
        const sessions = await env.DB.prepare('SELECT COUNT(*) as c, SUM(duration_min) as total_min FROM sessions').first();
        const games = await env.DB.prepare('SELECT COUNT(*) as c FROM games WHERE status = ?').bind('active').first();
        const teams = await env.DB.prepare('SELECT COUNT(*) as c FROM teams').first();
        const drills = await env.DB.prepare('SELECT COUNT(*) as c FROM drill_attempts').first();
        const topGames = await env.DB.prepare('SELECT g.name, g.slug, g.total_sessions FROM games g WHERE g.status = ? ORDER BY g.total_sessions DESC LIMIT 5').bind('active').all();
        const data = {
          total_players: players?.c || 0,
          total_sessions: sessions?.c || 0,
          total_hours: Math.round(((sessions?.total_min as number) || 0) / 60),
          total_games: games?.c || 0,
          total_teams: teams?.c || 0,
          total_drill_attempts: drills?.c || 0,
          top_games: topGames.results,
        };
        await env.GC_CACHE.put('analytics:overview', JSON.stringify(data), { expirationTtl: 300 });
        return json({ success: true, data });
      }

      if (m === 'GET' && p === '/analytics/trends') {
        const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 90);
        const rows = await env.DB.prepare('SELECT * FROM analytics_daily ORDER BY date DESC LIMIT ?').bind(days).all();
        return json({ success: true, data: rows.results });
      }

      if (m === 'GET' && p.match(/^\/players\/\d+\/stats$/)) {
        const playerId = parseInt(p.split('/')[2]);
        const player = await env.DB.prepare('SELECT total_sessions, total_hours, total_kills, total_deaths, total_wins, total_losses, xp, level, rank FROM players WHERE id = ?').bind(playerId).first();
        if (!player) return json({ error: 'Resource not found' }, 404);
        const byGame = await env.DB.prepare('SELECT g.name, gp.total_sessions, gp.total_hours, gp.best_score, gp.avg_score FROM game_profiles gp JOIN games g ON gp.game_id = g.id WHERE gp.player_id = ? ORDER BY gp.total_sessions DESC').bind(playerId).all();
        const recentDrills = await env.DB.prepare('SELECT da.*, td.name as drill_name FROM drill_attempts da JOIN training_drills td ON da.drill_id = td.id WHERE da.player_id = ? ORDER BY da.created_at DESC LIMIT 10').bind(playerId).all();
        return json({
          success: true, data: {
            ...player,
            kd_ratio: Math.round(((player.total_kills as number) / Math.max(1, player.total_deaths as number)) * 100) / 100,
            win_rate: Math.round(((player.total_wins as number) / Math.max(1, (player.total_wins as number) + (player.total_losses as number))) * 100),
            by_game: byGame.results,
            recent_drills: recentDrills.results,
          }
        });
      }

      /* ── Export ── */
      if (m === 'GET' && p === '/export/sessions') {
        const playerId = url.searchParams.get('player_id');
        const format = url.searchParams.get('format') || 'json';
        let q = 'SELECT s.*, g.name as game_name FROM sessions s JOIN games g ON s.game_id = g.id';
        const binds: unknown[] = [];
        if (playerId) { q += ' WHERE s.player_id = ?'; binds.push(parseInt(playerId)); }
        q += ' ORDER BY s.created_at DESC LIMIT 1000';
        const rows = await env.DB.prepare(q).bind(...binds).all();
        if (format === 'csv') {
          const headers = ['id', 'player_id', 'game_name', 'mode', 'started_at', 'ended_at', 'duration_min', 'kills', 'deaths', 'assists', 'score', 'result', 'map_name'];
          const csv = [headers.join(','), ...rows.results.map((r: Record<string, unknown>) => headers.map(h => `"${r[h] ?? ''}"`).join(','))].join('\n');
          return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=sessions.csv', 'Access-Control-Allow-Origin': '*' } });
        }
        return json({ success: true, data: rows.results, total: rows.results.length });
      }

      /* ── Activity log ── */
      if (m === 'GET' && p === '/activity') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
        const rows = await env.DB.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').bind(limit).all();
        return json({ success: true, data: rows.results });
      }

      return json({ error: 'Not found', path: p, endpoints: ['/health', '/games', '/players', '/sessions', '/drills', '/pros', '/teams', '/strategies', '/leaderboard', '/analytics', '/ai'] }, 404);

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Internal error';
      if (msg.includes('JSON')) {
        return json({ error: 'Invalid JSON body' }, 400);
      }
      console.error(`[echo-gamer-companion] Unhandled error: ${msg}`);
      return json({ error: 'Internal server error' }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    // Daily analytics aggregation
    const today = new Date().toISOString().split('T')[0];
    const sessions = await env.DB.prepare('SELECT COUNT(*) as c, COUNT(DISTINCT player_id) as p, SUM(duration_min) as d FROM sessions WHERE DATE(created_at) = ?').bind(today).first();
    const drills = await env.DB.prepare('SELECT COUNT(*) as c FROM drill_attempts WHERE DATE(created_at) = ?').bind(today).first();
    const popular = await env.DB.prepare('SELECT g.name, COUNT(*) as c FROM sessions s JOIN games g ON s.game_id = g.id WHERE DATE(s.created_at) = ? GROUP BY g.name ORDER BY c DESC LIMIT 1').bind(today).first();
    const popularMode = await env.DB.prepare('SELECT mode, COUNT(*) as c FROM sessions WHERE DATE(created_at) = ? GROUP BY mode ORDER BY c DESC LIMIT 1').bind(today).first();

    await env.DB.prepare(`INSERT INTO analytics_daily (date, total_sessions, total_players, total_hours, total_drills, popular_game, popular_mode, avg_session_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET total_sessions=excluded.total_sessions, total_players=excluded.total_players, total_hours=excluded.total_hours, total_drills=excluded.total_drills, popular_game=excluded.popular_game, popular_mode=excluded.popular_mode, avg_session_min=excluded.avg_session_min`)
      .bind(today, sessions?.c || 0, sessions?.p || 0, Math.round(((sessions?.d as number) || 0) / 60 * 100) / 100, drills?.c || 0, popular?.name || null, popularMode?.mode || null, sessions?.c ? Math.round(((sessions?.d as number) || 0) / (sessions.c as number)) : 0).run();
  }
};
