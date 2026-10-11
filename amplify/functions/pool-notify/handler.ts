import type { DynamoDBStreamHandler } from 'aws-lambda';
import webpush from 'web-push';

type Image = Record<string, { S?: string; N?: string; NULL?: boolean }> | undefined;
type Room = Record<string, string | number | null>;
type Table = { turn: number; winner: number | null; draw?: boolean; moves?: number; isBreak?: boolean; message?: string };
type Push = { title: string; body: string };

// Stream images use DynamoDB's typed JSON; rooms only hold strings and numbers.
const plain = (image: Image): Room => Object.fromEntries(Object.entries(image ?? {}).map(([key, value]) => [key, value.S ?? (value.N !== undefined ? Number(value.N) : null)]));
const parse = <T>(value: unknown): T | null => { try { return typeof value === 'string' ? JSON.parse(value) as T : null; } catch { return null; } };
const clean = (value: unknown) => String(value ?? '').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16) || 'Your opponent';

webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

// Work out who (if anyone) should hear about this change, and what to tell them.
// Rooms are shared by Neon Cue (pool, the default for older rooms) and Line Up.
const isLineUp = (room: Room) => room.game === 'lineup';

function messages(before: Room, after: Room): Array<{ seat: number; push: Push }> {
  if (isLineUp(after)) return lineUpMessages(before, after);
  const names = [clean(after.hostName), clean(after.guestName)];
  const say = (text = '') => text.replace(/PLAYER ([12])/g, (_, seat) => names[Number(seat) - 1]);
  const out: Array<{ seat: number; push: Push }> = [];

  if (!before.guestId && after.guestId) out.push({ seat: 0, push: { title: `${names[1]} joined your table 🎱`, body: 'Your break — tap to play.' } });

  const reaction = parse<{ by: number; text: string }>(after.reaction);
  if (reaction && after.reaction !== before.reaction && (reaction.by === 0 || reaction.by === 1)) {
    out.push({ seat: 1 - reaction.by, push: { title: `${names[reaction.by]}: ${String(reaction.text).slice(0, 40)}`, body: 'Tap to open the table.' } });
  }

  if (Number(after.seq) > Number(before.seq) && after.state !== before.state && before.guestId) {
    const table = parse<Table>(after.state), shot = parse<{ seq: number; by: number }>(after.shot);
    if (!table) return out;
    if (shot && shot.seq === after.seq) {
      const other = 1 - shot.by;
      if (table.winner !== null) out.push({ seat: other, push: { title: table.winner === other ? 'You won the rack! 🏆' : `${names[shot.by]} won the rack`, body: `${say(table.message)} — tap for a rematch.` } });
      else if (table.turn === other) {
        const foul = table.message?.match(/^FOUL: (.+?) —/);
        const body = foul ? `${names[shot.by]} fouled (${foul[1].toLowerCase()}) — you have ball in hand.` : `${names[shot.by]} missed — you're up.`;
        out.push({ seat: other, push: { title: 'Your turn 🎱', body } });
      }
    } else if (!after.shot && table.isBreak && after.status === 'playing' && before.status === 'finished') {
      out.push({ seat: table.turn, push: { title: 'Rematch racked 🎱', body: 'Your break — tap to play.' } });
    }
  }
  return out;
}

function lineUpMessages(before: Room, after: Room): Array<{ seat: number; push: Push }> {
  const names = [clean(after.hostName), clean(after.guestName)];
  const out: Array<{ seat: number; push: Push }> = [];
  if (!before.guestId && after.guestId) out.push({ seat: 0, push: { title: `${names[1]} joined your Line Up game 🟢`, body: 'You go first — tap to play.' } });
  const reaction = parse<{ by: number; text: string }>(after.reaction);
  if (reaction && after.reaction !== before.reaction && (reaction.by === 0 || reaction.by === 1)) {
    out.push({ seat: 1 - reaction.by, push: { title: `${names[reaction.by]}: ${String(reaction.text).slice(0, 40)}`, body: 'Tap to open the board.' } });
  }
  if (Number(after.seq) > Number(before.seq) && after.state !== before.state && before.guestId) {
    const board = parse<Table>(after.state), move = parse<{ seq: number; by: number }>(after.shot);
    if (!board) return out;
    if (move && move.seq === after.seq) {
      const other = 1 - move.by;
      if (board.draw) out.push({ seat: other, push: { title: 'Line Up: it’s a draw', body: 'The board filled up — tap for a rematch.' } });
      else if (board.winner !== null) out.push({ seat: other, push: { title: board.winner === other ? 'You won at Line Up! 🏆' : `${names[move.by]} lined up four`, body: 'Tap for a rematch.' } });
      else if (board.turn === other) out.push({ seat: other, push: { title: 'Your move 🟢', body: `${names[move.by]} dropped a disc — you're up.` } });
    } else if (!after.shot && board.moves === 0 && after.status === 'playing' && before.status === 'finished') {
      out.push({ seat: board.turn, push: { title: 'Line Up rematch 🟢', body: 'You go first — tap to play.' } });
    }
  }
  return out;
}

export const handler: DynamoDBStreamHandler = async (event) => {
  const sends: Promise<unknown>[] = [];
  for (const record of event.Records) {
    if (record.eventName !== 'MODIFY') continue;
    const before = plain(record.dynamodb?.OldImage as Image), after = plain(record.dynamodb?.NewImage as Image);
    for (const { seat, push } of messages(before, after)) {
      const subscription = parse<webpush.PushSubscription>(seat === 0 ? after.hostPush : after.guestPush);
      if (!subscription?.endpoint) continue;
      const game = isLineUp(after) ? 'lineup' : 'pool';
      const payload = JSON.stringify({ ...push, tag: `${game}-${after.code}`, url: game === 'lineup' ? `/?lineup=${after.code}` : `/?room=${after.code}` });
      // An expired or revoked subscription just means that player turned alerts off; nothing to retry.
      sends.push(webpush.sendNotification(subscription, payload, { TTL: 60 * 60 }).catch((error: { statusCode?: number }) => console.log('push failed', after.code, seat, error?.statusCode)));
    }
  }
  await Promise.all(sends);
};
