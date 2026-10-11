import type { AppSyncIdentityIAM, AppSyncResolverHandler } from 'aws-lambda';
import { createHash } from 'node:crypto';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { CPU_DAILY_LIMIT, CPU_MIN_GAP_MS, MIN_GAMES, PAIR_DAILY_LIMIT, START, cleanName, cpuBonus, day, eloDelta } from './rating';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as Parameters<typeof getAmplifyDataClientConfig>[0]);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

type Args = { playerId: string; name?: string | null; code?: string | null; rack?: number | null; winner?: number | null; level?: string | null; won?: boolean | null };
type Result = { status: string; rating?: number };
type Rating = Schema['PoolRating']['type'];

const LEDGER_TTL = 3 * 24 * 60 * 60;
const expires = () => Math.floor(Date.now() / 1000) + LEDGER_TTL;
// The ranking never shows the browser's private player id (it lets you reclaim seats in rooms), only a hash of it.
// pool-ranking.js computes the same hash to find "you" on the board.
const publicId = (playerId: string) => createHash('sha256').update(`neon-pool:${playerId}`).digest('hex').slice(0, 20);
const parse = <T>(text: unknown): T | null => { try { return typeof text === 'string' ? JSON.parse(text) as T : null; } catch { return null; } };

// ---------- ledger: server-only bookkeeping (who owns an id, who confirmed a rack, daily counters) ----------
async function ledger(key: string) { const { data } = await client.models.RankLedger.get({ key }); return data; }
// Creates the entry only if it doesn't exist yet; true when this call created it.
async function claimKey(key: string, value: string, ttl = true) {
  const { data, errors } = await client.models.RankLedger.create({ key, value, expiresAt: ttl ? expires() : null });
  return Boolean(data && !errors?.length);
}
async function bump(key: string, value: string) {
  const { errors } = await client.models.RankLedger.update({ key, value, expiresAt: expires() });
  if (errors?.length) await client.models.RankLedger.create({ key, value, expiresAt: expires() });
}

// The first browser (guest identity) to use a player id owns it from then on, so nobody can report racks for
// someone else even after seeing that player's id in a room. pool-ranking.js claims its id as soon as the site
// loads, well before an opponent could see it.
// Stored hashed: a guest identity id is enough to get that guest's AWS credentials, so it never sits in a table.
async function owns(id: string, identity: string) {
  const owner = createHash('sha256').update(identity).digest('hex');
  if (await claimKey(`owner:${id}`, owner, false)) return true;
  return (await ledger(`owner:${id}`))?.value === owner;
}

type Player = Pick<Rating, 'playerId' | 'name' | 'rating' | 'bonus' | 'wins' | 'losses' | 'cpuWins' | 'cpuLosses' | 'games'>;
async function loadRating(id: string, name: string): Promise<{ player: Player; isNew: boolean }> {
  const { data } = await client.models.PoolRating.get({ playerId: id });
  if (data) { const { playerId, rating, bonus, wins, losses, cpuWins, cpuLosses, games } = data; return { player: { playerId, name: data.name, rating, bonus, wins, losses, cpuWins, cpuLosses, games }, isNew: false }; }
  return { player: { playerId: id, name: name || `PLAYER ${id.slice(0, 4).toUpperCase()}`, rating: START, bonus: 0, wins: 0, losses: 0, cpuWins: 0, cpuLosses: 0, games: 0 }, isNew: true };
}
// `ranked` is the ranking index's partition: only players with enough racks are listed.
async function saveRating(player: Player, isNew: boolean) {
  const record = { ...player, score: player.rating + player.bonus, ranked: player.games >= MIN_GAMES ? 'yes' : 'no' };
  const { errors } = isNew ? await client.models.PoolRating.create(record) : await client.models.PoolRating.update(record);
  if (errors?.length) throw new Error(errors.map((error) => error.message).join(' '));
}

// ---------- online racks ----------
async function reportRack(me: string, args: Args): Promise<Result> {
  const code = String(args.code ?? '').toUpperCase(), rack = Number(args.rack), winner = Number(args.winner);
  if (!/^[A-Z0-9]{5}$/.test(code) || !Number.isInteger(rack) || rack < 1 || (winner !== 0 && winner !== 1)) return { status: 'invalid' };
  const { data: room } = await client.models.PoolRoom.get({ code });
  if (!room || (room.game && room.game !== 'pool') || !room.guestId) return { status: 'invalid' };
  const seat = room.hostId === args.playerId ? 0 : room.guestId === args.playerId ? 1 : -1;
  if (seat < 0) return { status: 'invalid' };
  const table = parse<{ winner: number | null; match?: number[] }>(room.state);
  const finished = (table?.match ?? []).reduce((sum, n) => sum + n, 0);
  // The room must show this rack: either still on its result, or already re-racked for a rematch.
  if (!table || finished !== rack || (table.winner !== null && table.winner !== winner)) return { status: 'invalid' };

  const key = `rack:${code}:${rack}`;
  await claimKey(`${key}:${seat}`, String(winner)); // already there if this player is retrying
  const other = await ledger(`${key}:${1 - seat}`);
  if (!other) return { status: 'waiting' };
  if (other.value !== String(winner)) return { status: 'disputed' };
  if (!(await claimKey(`${key}:counted`, me))) return { status: 'counted' };

  const ids = [publicId(room.hostId), publicId(room.guestId)], names = [cleanName(room.hostName), cleanName(room.guestName)];
  const pair = `pair:${[...ids].sort().join(':')}:${day()}`, played = Number((await ledger(pair))?.value ?? 0);
  if (played >= PAIR_DAILY_LIMIT) return { status: 'limit' };
  await bump(pair, String(played + 1));

  const [loadedWin, loadedLose] = await Promise.all([loadRating(ids[winner], names[winner]), loadRating(ids[1 - winner], names[1 - winner])]);
  const win = loadedWin.player, lose = loadedLose.player, delta = eloDelta(win.rating, lose.rating);
  Object.assign(win, { name: names[winner] || win.name, rating: win.rating + delta, wins: win.wins + 1, games: win.games + 1 });
  Object.assign(lose, { name: names[1 - winner] || lose.name, rating: lose.rating - delta, losses: lose.losses + 1, games: lose.games + 1 });
  await Promise.all([saveRating(win, loadedWin.isNew), saveRating(lose, loadedLose.isNew)]);
  const mine = seat === winner ? win : lose;
  return { status: 'counted', rating: mine.rating + mine.bonus };
}

// ---------- racks against the computer ----------
async function reportCpu(me: string, args: Args): Promise<Result> {
  const level = String(args.level ?? ''), won = Boolean(args.won);
  if (level !== 'medium' && level !== 'hard') return { status: 'unranked' };
  const key = `cpu:${me}:${day()}`, today = parse<{ n: number; at: number }>((await ledger(key))?.value) ?? { n: 0, at: 0 };
  if (today.n >= CPU_DAILY_LIMIT) return { status: 'limit' };
  if (Date.now() - today.at < CPU_MIN_GAP_MS) return { status: 'too_soon' };
  await bump(key, JSON.stringify({ n: today.n + 1, at: Date.now() }));

  const { player, isNew } = await loadRating(me, cleanName(args.name));
  Object.assign(player, { name: cleanName(args.name) || player.name, bonus: cpuBonus(player.bonus, level, won), games: player.games + 1, cpuWins: player.cpuWins + (won ? 1 : 0), cpuLosses: player.cpuLosses + (won ? 0 : 1) });
  await saveRating(player, isNew);
  return { status: 'counted', rating: player.rating + player.bonus };
}

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
  const identity = (event.identity as AppSyncIdentityIAM | null)?.cognitoIdentityId;
  const playerId = String(event.arguments.playerId ?? '');
  if (!identity || playerId.length < 8 || playerId.length > 64) return { status: 'invalid' };
  const me = publicId(playerId);
  if (!(await owns(me, identity))) return { status: 'not_yours' };
  if (event.info.fieldName === 'claimPoolPlayer') return { status: 'ok' };
  return event.info.fieldName === 'reportPoolCpu' ? reportCpu(me, event.arguments) : reportRack(me, event.arguments);
};
