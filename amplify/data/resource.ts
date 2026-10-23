import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { rankPool } from '../functions/rank-pool/resource';
import { sketchGame } from '../functions/sketch/resource';

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

  // A private online room for Neon Cue (pool), Line Up, Gomoku or Checkers. Players find it only by its code; the game state is a
  // JSON string written by whoever just moved, and both browsers listen for updates to stay in sync.
  // (Named PoolRoom because pool came first; renaming the model would replace the table and its rooms.)
  PoolRoom: a
    .model({
      code: a.string().required(),
      // 'pool', 'lineup', 'gomoku' or 'checkers'; rooms made before Line Up existed have none and are pool rooms.
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

  // ---------- Neon Sketch (draw and guess) ----------
  // A room's shared state. Only the sketch-game function writes it; everyone can read and subscribe.
  // turnStartedAt / turnEndsAt are epoch milliseconds (too big for a GraphQL Int).
  SketchRoom: a
    .model({
      code: a.string().required(),
      hostKey: a.string().required(),
      status: a.string().required(), // lobby | choosing | drawing | reveal | over
      round: a.integer().required(),
      rounds: a.integer().required(),
      drawSeconds: a.integer().required(),
      turnIndex: a.integer().required(),
      turnId: a.integer().required(),
      drawerKey: a.string().required(),
      drawerName: a.string().required(),
      mask: a.string().required(), // the word as blanks plus any hint letters (the whole word during reveal)
      hints: a.integer().required(),
      lastWord: a.string().required(),
      turnStartedAt: a.float().required(),
      turnEndsAt: a.float().required(),
      seq: a.integer().required(), // bumped on every change; updates only apply to the version they read
      expiresAt: a.integer().required(),
    })
    .identifier(['code'])
    .authorization((allow) => [allow.guest().to(['read'])]),

  // A player in a room, keyed by a hash of their browser's guest identity. Written only by sketch-game.
  SketchPlayer: a
    .model({
      roomCode: a.string().required(),
      playerKey: a.string().required(),
      name: a.string().required(),
      score: a.integer().required(),
      guessedTurn: a.integer().required(), // the turnId they last guessed right
      joinedAt: a.float().required(),
      expiresAt: a.integer().required(),
    })
    .identifier(['roomCode', 'playerKey'])
    .authorization((allow) => [allow.guest().to(['read'])]),

  // A batch of the drawer's pen points (or a clear/undo), written straight from the drawer's browser so drawing
  // feels live. Browsers only draw batches whose `by` is the current drawer for the current turn.
  SketchStroke: a
    .model({
      roomCode: a.string().required(),
      sid: a.string().required(), // "<turnId>:<seq>", so a turn's strokes list in order
      turnId: a.integer().required(),
      by: a.string().required(),
      data: a.string().required(),
      expiresAt: a.integer().required(),
    })
    .identifier(['roomCode', 'sid'])
    .authorization((allow) => [allow.guest().to(['create', 'read'])]),

  // Chat and wrong guesses (right guesses never appear here, only "NAME guessed the word!"). Written by sketch-game.
  SketchChat: a
    .model({
      roomCode: a.string().required(),
      cid: a.string().required(), // time-ordered
      name: a.string().required(),
      text: a.string().required(),
      kind: a.string().required(), // chat | guessed | correct | system
      expiresAt: a.integer().required(),
    })
    .identifier(['roomCode', 'cid'])
    .authorization((allow) => [allow.guest().to(['read'])]),

  // The current turn's word choices and word. Server-only, like RankLedger.
  SketchSecret: a
    .model({
      code: a.string().required(),
      turnId: a.integer().required(),
      options: a.string().required(),
      word: a.string().required(),
      expiresAt: a.integer().required(),
    })
    .identifier(['code'])
    .authorization((allow) => [allow.group('ranking-admins').to(['read'])]),

  sketchCreate: a
    .mutation()
    .arguments({ name: a.string().required(), rounds: a.integer(), drawSeconds: a.integer() })
    .returns(a.json())
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(sketchGame)),

  sketchJoin: a
    .mutation()
    .arguments({ code: a.string().required(), name: a.string().required() })
    .returns(a.json())
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(sketchGame)),

  sketchLeave: a
    .mutation()
    .arguments({ code: a.string().required() })
    .returns(a.json())
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(sketchGame)),

  sketchStart: a
    .mutation()
    .arguments({ code: a.string().required(), rounds: a.integer(), drawSeconds: a.integer() })
    .returns(a.json())
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(sketchGame)),

  sketchWord: a
    .mutation()
    .arguments({ code: a.string().required() })
    .returns(a.json())
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(sketchGame)),

  sketchChoose: a
    .mutation()
    .arguments({ code: a.string().required(), choice: a.integer().required() })
    .returns(a.json())
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(sketchGame)),

  sketchGuess: a
    .mutation()
    .arguments({ code: a.string().required(), text: a.string().required() })
    .returns(a.json())
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(sketchGame)),

  sketchTick: a
    .mutation()
    .arguments({ code: a.string().required() })
    .returns(a.json())
    .authorization((allow) => [allow.guest()])
    .handler(a.handler.function(sketchGame)),
}).authorization((allow) => [allow.resource(rankPool), allow.resource(sketchGame)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
