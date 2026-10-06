import { a, defineData, type ClientSchema } from '@aws-amplify/backend';

const schema = a.schema({
  Score: a
    .model({
      // A constant partition key lets DynamoDB return the global board efficiently.
      board: a.string().required(),
      callsign: a.string().required(),
      score: a.integer().required(),
    })
    .secondaryIndexes((index) => [
      index('board').sortKeys(['score']).queryField('listLeaderboard'),
    ])
    // A guest can submit and view scores, but cannot alter or delete a record.
    .authorization((allow) => [allow.guest().to(['create', 'read'])]),

  // A private 8-ball room. Players find it only by its code; the table state is a JSON string
  // written by whoever just shot, and both browsers listen for updates to stay in sync.
  PoolRoom: a
    .model({
      code: a.string().required(),
      hostId: a.string().required(),
      hostName: a.string().required(),
      guestId: a.string(),
      guestName: a.string(),
      status: a.string().required(),
      seq: a.integer().required(),
      state: a.string().required(),
      shot: a.string(),
      // The latest quick reaction ({ by, text, at }) so the other player can see it pop up.
      reaction: a.string(),
      // Each player's browser push subscription, so the notify function can tell them it's their turn.
      hostPush: a.string(),
      guestPush: a.string(),
      // Epoch seconds; DynamoDB deletes abandoned rooms after this time.
      expiresAt: a.integer().required(),
    })
    .identifier(['code'])
    .authorization((allow) => [allow.guest().to(['create', 'read', 'update'])]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
