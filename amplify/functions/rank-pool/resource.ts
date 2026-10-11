import { defineFunction } from '@aws-amplify/backend';

// Records finished Neon Cue racks for the global ranking. Called by the reportPoolRack / reportPoolCpu mutations.
export const rankPool = defineFunction({
  name: 'rank-pool',
  entry: './handler.ts',
  timeoutSeconds: 15,
  // It both handles data mutations and reads/writes data, so it lives in the data stack (avoids a circular dependency).
  resourceGroupName: 'data',
});
