import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

const backend = defineBackend({ auth, data });

// Expire abandoned pool rooms instead of keeping them forever.
backend.data.resources.cfnResources.amplifyDynamoDbTables['PoolRoom'].timeToLiveAttribute = {
  attributeName: 'expiresAt',
  enabled: true,
};
