import type { AppSyncIdentityIAM, AppSyncResolverHandler } from 'aws-lambda';
import { createHash } from 'node:crypto';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { CHOOSE_MS, DRAW_SECONDS, MAX_PLAYERS, REVEAL_MS, ROUNDS, cleanName, drawerPoints, guessPoints, hintsDue, judge, maskOf, pickWords, revealLetter } from './rules';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as Parameters<typeof getAmplifyDataClientConfig>[0]);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

// Neon Sketch: one player draws, everyone else guesses. The word only ever lives here and in SketchSecret, and
// every guess is judged here, so a guesser's browser never has the answer. All room changes go through save(),
// which only succeeds if nobody else changed the room first — two "time's up" ticks can't both advance the game.

type Args = { code?: string | null; name?: string | null; rounds?: number | null; drawSeconds?: number | null; choice?: number | null; text?: string | null };
type Room = Schema['SketchRoom']['type'];
type Player = Schema['SketchPlayer']['type'];
type Reply = Record<string, unknown>;

const ROOM_TTL = 6 * 60 * 60;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const expires = () => Math.floor(Date.now() / 1000) + ROOM_TTL;
const roomCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const chatId = () => `${String(Date.now()).padStart(14, '0')}-${Math.random().toString(36).slice(2, 6)}`;

// Subscribers get exactly the fields a mutation selects, so select every field the browsers' models expect.
const ROOM_FIELDS = 'code hostKey status round rounds drawSeconds turnIndex turnId drawerKey drawerName mask hints lastWord turnStartedAt turnEndsAt seq expiresAt createdAt updatedAt';
const PLAYER_FIELDS = 'roomCode playerKey name score guessedTurn joinedAt expiresAt createdAt updatedAt';
const UPDATE_ROOM = `mutation UpdateRoom($input: UpdateSketchRoomInput!, $condition: ModelSketchRoomConditionInput) { updateSketchRoom(input: $input, condition: $condition) { ${ROOM_FIELDS} } }`;
const UPDATE_PLAYER = `mutation UpdatePlayer($input: UpdateSketchPlayerInput!, $condition: ModelSketchPlayerConditionInput) { updateSketchPlayer(input: $input, condition: $condition) { ${PLAYER_FIELDS} } }`;

async function conditional<T>(query: string, field: string, input: Record<string, unknown>, condition: Record<string, unknown>): Promise<T | null> {
  try {
    const result = await client.graphql({ query, variables: { input, condition } }) as { data?: Record<string, T | null> };
    return result.data?.[field] ?? null;
  } catch { return null; } // condition failed: someone else got there first
}
const save = (room: Room, changes: Partial<Room>) => conditional<Room>(UPDATE_ROOM, 'updateSketchRoom', { code: room.code, ...changes, seq: room.seq + 1, expiresAt: expires() }, { seq: { eq: room.seq } });

async function getRoom(code: unknown) {
  const clean = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 5) return null;
  return (await client.models.SketchRoom.get({ code: clean })).data;
}
async function players(code: string) {
  const all: Player[] = [];
  let nextToken: string | null | undefined;
  do { const page = await client.models.SketchPlayer.list({ roomCode: code, nextToken }); all.push(...page.data); nextToken = page.nextToken; } while (nextToken);
  return all.sort((a, b) => a.joinedAt - b.joinedAt);
}
const say = (roomCode: string, text: string, kind = 'system', name = '') => client.models.SketchChat.create({ roomCode, cid: chatId(), name, text, kind, expiresAt: expires() });
async function secret(room: Room) {
  const { data } = await client.models.SketchSecret.get({ code: room.code });
  return data && data.turnId === room.turnId ? { options: JSON.parse(data.options) as string[], word: data.word } : null;
}

// ---------- turns ----------
async function nextTurn(room: Room, first = false): Promise<Room | null> {
  const list = await players(room.code), now = Date.now();
  if (list.length < 2) return save(room, { status: 'lobby', drawerKey: '', drawerName: '', mask: '', turnEndsAt: 0 });
  let round = first ? 1 : room.round, turnIndex = first ? 0 : room.turnIndex + 1;
  if (turnIndex >= list.length) { round += 1; turnIndex = 0; }
  if (round > room.rounds) {
    const over = await save(room, { status: 'over', drawerKey: '', drawerName: '', mask: '', turnEndsAt: 0 });
    if (over) { const winner = [...list].sort((a, b) => b.score - a.score)[0]; await say(room.code, `GAME OVER — ${winner.name} WINS WITH ${winner.score}`); }
    return over;
  }
  const drawer = list[turnIndex], turnId = room.turnId + 1;
  const next = await save(room, { status: 'choosing', round, turnIndex, turnId, drawerKey: drawer.playerKey, drawerName: drawer.name, mask: '', hints: 0, turnStartedAt: now, turnEndsAt: now + CHOOSE_MS });
  if (next) {
    const words = { code: room.code, turnId, options: JSON.stringify(pickWords()), word: '', expiresAt: expires() };
    const { errors } = await client.models.SketchSecret.update(words);
    if (errors?.length) await client.models.SketchSecret.create(words); // first turn in this room
    await say(room.code, `${drawer.name} IS CHOOSING A WORD`);
  }
  return next;
}

async function choose(room: Room, choice: number): Promise<{ room: Room | null; word: string | null }> {
  const hidden = await secret(room);
  if (!hidden) return { room: null, word: null };
  const word = hidden.options[Math.max(0, Math.min(hidden.options.length - 1, Math.floor(choice) || 0))], now = Date.now();
  const next = await save(room, { status: 'drawing', mask: maskOf(word), hints: 0, turnStartedAt: now, turnEndsAt: now + room.drawSeconds * 1000 });
  if (next) await client.models.SketchSecret.update({ code: room.code, word });
  return { room: next, word: next ? word : null };
}

async function endTurn(room: Room) {
  const hidden = await secret(room), word = hidden?.word || '';
  const next = await save(room, { status: 'reveal', mask: word, lastWord: word, turnEndsAt: Date.now() + REVEAL_MS });
  if (!next) return null;
  const list = await players(room.code), guessers = list.filter((player) => player.playerKey !== room.drawerKey && player.guessedTurn === room.turnId).length;
  const drawer = list.find((player) => player.playerKey === room.drawerKey);
  if (drawer && guessers) await client.models.SketchPlayer.update({ roomCode: room.code, playerKey: drawer.playerKey, score: drawer.score + drawerPoints(guessers) });
  await say(room.code, word ? `THE WORD WAS ${word.toUpperCase()}` : 'TURN SKIPPED');
  return next;
}

// Anyone in the room calls this when a deadline passes; the server checks the clock itself.
async function tick(room: Room) {
  const now = Date.now();
  if (room.status === 'choosing' && now >= room.turnEndsAt) return (await choose(room, 0)).room;
  if (room.status === 'reveal' && now >= room.turnEndsAt) return nextTurn(room);
  if (room.status !== 'drawing') return room;
  if (now >= room.turnEndsAt) return endTurn(room);
  const hidden = await secret(room);
  if (!hidden?.word) return room;
  const due = hintsDue(hidden.word, now - room.turnStartedAt, room.turnEndsAt - room.turnStartedAt);
  if (due <= room.hints) return room;
  let mask = room.mask;
  for (let i = room.hints; i < due; i += 1) mask = revealLetter(hidden.word, mask);
  return save(room, { mask, hints: due });
}

// ---------- operations ----------
async function create(me: string, args: Args): Promise<Reply> {
  const name = cleanName(args.name);
  if (!name) return { error: 'NAME' };
  const rounds = ROUNDS.includes(Number(args.rounds)) ? Number(args.rounds) : 3, drawSeconds = DRAW_SECONDS.includes(Number(args.drawSeconds)) ? Number(args.drawSeconds) : 80;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = roomCode();
    const { data, errors } = await client.models.SketchRoom.create({ code, hostKey: me, status: 'lobby', round: 0, rounds, drawSeconds, turnIndex: -1, turnId: 0, drawerKey: '', drawerName: '', mask: '', hints: 0, lastWord: '', turnStartedAt: 0, turnEndsAt: 0, seq: 1, expiresAt: expires() });
    if (!data || errors?.length) continue; // code taken
    await client.models.SketchPlayer.create({ roomCode: code, playerKey: me, name, score: 0, guessedTurn: 0, joinedAt: Date.now(), expiresAt: expires() });
    await say(code, `${name} OPENED THE ROOM`);
    return { code };
  }
  return { error: 'BUSY' };
}

async function join(me: string, room: Room, args: Args): Promise<Reply> {
  const name = cleanName(args.name);
  if (!name) return { error: 'NAME' };
  const list = await players(room.code), mine = list.find((player) => player.playerKey === me);
  if (mine) { if (mine.name !== name) await client.models.SketchPlayer.update({ roomCode: room.code, playerKey: me, name }); return { code: room.code }; }
  if (list.length >= MAX_PLAYERS) return { error: 'FULL' };
  await client.models.SketchPlayer.create({ roomCode: room.code, playerKey: me, name, score: 0, guessedTurn: 0, joinedAt: Date.now(), expiresAt: expires() });
  await say(room.code, `${name} JOINED`);
  return { code: room.code };
}

async function leave(me: string, room: Room): Promise<Reply> {
  const list = await players(room.code), mine = list.find((player) => player.playerKey === me);
  if (!mine) return {};
  await client.models.SketchPlayer.delete({ roomCode: room.code, playerKey: me });
  await say(room.code, `${mine.name} LEFT`);
  const rest = list.filter((player) => player.playerKey !== me);
  let current: Room | null = room;
  if (room.hostKey === me && rest.length) current = await save(room, { hostKey: rest[0].playerKey });
  if (current && rest.length < 2 && ['choosing', 'drawing', 'reveal'].includes(current.status)) await save(current, { status: 'lobby', drawerKey: '', drawerName: '', mask: '', turnEndsAt: 0 });
  else if (current && current.drawerKey === me && ['choosing', 'drawing'].includes(current.status)) await endTurn(current);
  return {};
}

async function start(me: string, room: Room, args: Args): Promise<Reply> {
  if (room.hostKey !== me) return { error: 'NOT_HOST' };
  if (!['lobby', 'over'].includes(room.status)) return { error: 'PLAYING' };
  const list = await players(room.code);
  if (list.length < 2) return { error: 'NEED_PLAYERS' };
  await Promise.all(list.map((player) => client.models.SketchPlayer.update({ roomCode: room.code, playerKey: player.playerKey, score: 0, guessedTurn: 0 })));
  const rounds = ROUNDS.includes(Number(args.rounds)) ? Number(args.rounds) : room.rounds, drawSeconds = DRAW_SECONDS.includes(Number(args.drawSeconds)) ? Number(args.drawSeconds) : room.drawSeconds;
  const set = await save(room, { rounds, drawSeconds, lastWord: '' });
  if (!set) return { error: 'RETRY' };
  await say(room.code, `NEW GAME · ${rounds} ROUNDS · ${drawSeconds}s TO DRAW`);
  return (await nextTurn(set, true)) ? {} : { error: 'RETRY' };
}

async function guess(me: string, room: Room, args: Args): Promise<Reply> {
  const text = String(args.text ?? '').trim().slice(0, 60);
  if (!text) return {};
  const { data: player } = await client.models.SketchPlayer.get({ roomCode: room.code, playerKey: me });
  if (!player) return { error: 'NOT_IN_ROOM' };
  const drawing = room.status === 'drawing', word = drawing ? (await secret(room))?.word || '' : '';
  if (!drawing || !word) { await say(room.code, text, 'chat', player.name); return {}; }
  const verdict = judge(text, word), done = me === room.drawerKey || player.guessedTurn === room.turnId;
  // The drawer and players who already guessed can chat, but never in a way that gives the word away.
  if (done) { if (verdict === 'wrong' || verdict === 'close') await say(room.code, text, 'guessed', player.name); return { result: verdict === 'wrong' || verdict === 'close' ? 'sent' : 'hidden' }; }
  if (verdict === 'hidden') return { result: 'hidden' };
  if (verdict !== 'correct') { await say(room.code, text, 'chat', player.name); return { result: verdict }; }
  const points = guessPoints(room.turnEndsAt - Date.now(), room.turnEndsAt - room.turnStartedAt);
  const scored = await conditional<Player>(UPDATE_PLAYER, 'updateSketchPlayer', { roomCode: room.code, playerKey: me, score: player.score + points, guessedTurn: room.turnId }, { guessedTurn: { ne: room.turnId } });
  if (!scored) return { result: 'hidden' };
  await say(room.code, `${player.name} GUESSED THE WORD! +${points}`, 'correct', player.name);
  const list = await players(room.code);
  if (list.every((other) => other.playerKey === room.drawerKey || other.guessedTurn === room.turnId)) await endTurn(room);
  return { result: 'correct', points, word };
}

async function word(me: string, room: Room): Promise<Reply> {
  if (room.drawerKey !== me) return { error: 'NOT_DRAWER' };
  const hidden = await secret(room);
  if (!hidden) return { pending: true };
  return room.status === 'choosing' ? { options: hidden.options } : { word: hidden.word };
}

export const handler: AppSyncResolverHandler<Args, Reply> = async (event) => {
  const identity = (event.identity as AppSyncIdentityIAM | null)?.cognitoIdentityId, now = Date.now();
  if (!identity) return { error: 'NO_IDENTITY', now };
  // Players are known by a hash of their browser's guest identity, which the browser can't fake.
  const me = createHash('sha256').update(`sketch:${identity}`).digest('hex').slice(0, 16), op = event.info.fieldName, args = event.arguments;
  try {
    if (op === 'sketchCreate') return { ...(await create(me, args)), key: me, now };
    const room = await getRoom(args.code);
    if (!room) return { error: 'NO_ROOM', now };
    const reply = op === 'sketchJoin' ? await join(me, room, args)
      : op === 'sketchLeave' ? await leave(me, room)
      : op === 'sketchStart' ? await start(me, room, args)
      : op === 'sketchGuess' ? await guess(me, room, args)
      : op === 'sketchWord' ? await word(me, room)
      : op === 'sketchChoose' ? (room.drawerKey !== me || room.status !== 'choosing' ? { error: 'NOT_NOW' } : { word: (await choose(room, Number(args.choice))).word })
      : op === 'sketchTick' ? (await tick(room), {})
      : { error: 'UNKNOWN' };
    return { ...reply, key: me, now };
  } catch (error) {
    console.log(op, error);
    return { error: 'SERVER', now };
  }
};
