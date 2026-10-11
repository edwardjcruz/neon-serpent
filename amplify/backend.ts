import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { rankPool } from './functions/rank-pool/resource';

const backend = defineBackend({ auth, data, rankPool });

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
