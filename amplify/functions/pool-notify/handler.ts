import type { DynamoDBStreamHandler } from 'aws-lambda';
import webpush from 'web-push';

type Image = Record<string, { S?: string; N?: string; NULL?: boolean }> | undefined;
type Room = Record<string, string | number | null>;
type Table = { turn: number; winner: number | null; isBreak?: boolean; message?: string };
type Push = { title: string; body: string };

// Stream images use DynamoDB's typed JSON; rooms only hold strings and numbers.
const plain = (image: Image): Room => Object.fromEntries(Object.entries(image ?? {}).map(([key, value]) => [key, value.S ?? (value.N !== undefined ? Number(value.N) : null)]));
const parse = <T>(value: unknown): T | null => { try { return typeof value === 'string' ? JSON.parse(value) as T : null; } catch { return null; } };
const clean = (value: unknown) => String(value ?? '').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16) || 'Your opponent';

webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

// Work out who (if anyone) should hear about this change, and what to tell them.
function messages(before: Room, after: Room): Array<{ seat: number; push: Push }> {
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

export const handler: DynamoDBStreamHandler = async (event) => {
  const sends: Promise<unknown>[] = [];
  for (const record of event.Records) {
    if (record.eventName !== 'MODIFY') continue;
    const before = plain(record.dynamodb?.OldImage as Image), after = plain(record.dynamodb?.NewImage as Image);
    for (const { seat, push } of messages(before, after)) {
      const subscription = parse<webpush.PushSubscription>(seat === 0 ? after.hostPush : after.guestPush);
      if (!subscription?.endpoint) continue;
      const payload = JSON.stringify({ ...push, tag: `pool-${after.code}`, url: `/?room=${after.code}` });
      // An expired or revoked subscription just means that player turned alerts off; nothing to retry.
      sends.push(webpush.sendNotification(subscription, payload, { TTL: 60 * 60 }).catch((error: { statusCode?: number }) => console.log('push failed', after.code, seat, error?.statusCode)));
    }
  }
  await Promise.all(sends);
};
