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
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
