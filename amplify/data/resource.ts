import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { rankPool } from '../functions/rank-pool/resource';

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

  // A private online room for Neon Cue (pool), Line Up or Gomoku. Players find it only by its code; the game state is a
  // JSON string written by whoever just moved, and both browsers listen for updates to stay in sync.
  // (Named PoolRoom because pool came first; renaming the model would replace the table and its rooms.)
  PoolRoom: a
    .model({
      code: a.string().required(),
      // 'pool', 'lineup' or 'gomoku'; rooms made before Line Up existed have none and are pool rooms.
      game: a.string(),
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
      // Epoch seconds; DynamoDB deletes abandoned rooms after this time.
      expiresAt: a.integer().required(),
    })
    .identifier(['code'])
    .authorization((allow) => [allow.guest().to(['create', 'read', 'update'])]),

  // Neon Cue global ranking. Only the rank-pool function writes it; everyone can read it.
  // playerId is a hash of the browser's player id, so the private id never appears on the public board.
  PoolRating: a
    .model({
      playerId: a.string().required(),
      name: a.string().required(),
      rating: a.integer().required(), // Elo from online racks
      bonus: a.integer().required(), // small capped extra from Medium/Hard CPU racks
      score: a.integer().required(), // rating + bonus: what the ranking sorts on
      wins: a.integer().required(),
      losses: a.integer().required(),
      cpuWins: a.integer().required(),
      cpuLosses: a.integer().required(),
      games: a.integer().required(),
      // 'yes' once a player has enough ranked racks to be listed; the ranking index is partitioned on it.
      ranked: a.string().required(),
    })
    .identifier(['playerId'])
    .secondaryIndexes((index) => [index('ranked').sortKeys(['score']).queryField('listPoolRanking')])
    .authorization((allow) => [allow.guest().to(['read'])]),

  // Server-only bookkeeping for the ranking: which browser owns a player id, which player confirmed which rack,
  // and daily counters. Only rank-pool (via the schema rule below) uses it; every model needs a rule of its own, so
  // reading is limited to a user group nobody is in.
  RankLedger: a
    .model({
      key: a.string().required(),
      value: a.string(),
      expiresAt: a.integer(),
    })
    .identifier(['key'])
    .authorization((allow) => [allow.group('ranking-admins').to(['read'])]),

  // Ties this browser's player id to its guest identity, so only this browser can report racks for it.
  claimPoolPlayer: a
    .mutation()
    .arguments({ playerId: a.string().required() })
    .returns(a.json())
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(rankPool)),

  // Both players' browsers report a finished online rack; it counts once both agree on the winner.
  reportPoolRack: a
    .mutation()
    .arguments({ playerId: a.string().required(), code: a.string().required(), rack: a.integer().required(), winner: a.integer().required() })
    .returns(a.json())
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(rankPool)),

  // A finished rack against the computer (Medium and Hard only; they nudge a capped bonus).
  reportPoolCpu: a
    .mutation()
    .arguments({ playerId: a.string().required(), name: a.string(), level: a.string().required(), won: a.boolean().required() })
    .returns(a.json())
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(rankPool)),
}).authorization((allow) => [allow.resource(rankPool)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
