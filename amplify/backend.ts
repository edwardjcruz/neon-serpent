import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { rankPool } from './functions/rank-pool/resource';
import { sketchGame } from './functions/sketch/resource';

const backend = defineBackend({ auth, data, rankPool, sketchGame });

// Expire abandoned pool rooms instead of keeping them forever.
backend.data.resources.cfnResources.amplifyDynamoDbTables['PoolRoom'].timeToLiveAttribute = {
  attributeName: 'expiresAt',
  enabled: true,
};

// Rack confirmations and daily counters only matter for a few days.
backend.data.resources.cfnResources.amplifyDynamoDbTables['RankLedger'].timeToLiveAttribute = {
  attributeName: 'expiresAt',
  enabled: true,
};

// Neon Sketch rooms, players, strokes, chat and words are gone a few hours after a room goes quiet.
for (const table of ['SketchRoom', 'SketchPlayer', 'SketchStroke', 'SketchChat', 'SketchSecret']) {
  backend.data.resources.cfnResources.amplifyDynamoDbTables[table].timeToLiveAttribute = { attributeName: 'expiresAt', enabled: true };
}
