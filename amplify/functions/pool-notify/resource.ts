import { defineFunction, secret } from '@aws-amplify/backend';

// Sends "your turn" push notifications when a pool room changes (triggered by the PoolRoom table stream).
export const poolNotify = defineFunction({
  name: 'pool-notify',
  entry: './handler.ts',
  timeoutSeconds: 15,
  // Lives with the data stack because the table stream that triggers it is defined there.
  resourceGroupName: 'data',
  environment: {
    VAPID_PUBLIC_KEY: 'BOsUaj5d7uTAR2HPVaJl3fB-2Mv1eYnYP2YQ9IemQWvU2Rc-83u5_Cmo6ALXXiXksWiAyuhyE1ZFG_abMDJfs9Q',
    VAPID_SUBJECT: 'https://github.com/edwardjcruz/neon-serpent',
    // Set once in the Amplify console (Hosting → Secrets) before deploying.
    VAPID_PRIVATE_KEY: secret('POOL_VAPID_PRIVATE_KEY'),
  },
});
