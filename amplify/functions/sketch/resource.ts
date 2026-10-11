import { defineFunction } from '@aws-amplify/backend';

// Runs Neon Sketch rooms: joining, turns, the secret word, guesses and scores. Called by the sketch* mutations.
export const sketchGame = defineFunction({
  name: 'sketch-game',
  entry: './handler.ts',
  timeoutSeconds: 15,
  // It both handles data mutations and reads/writes data, so it lives in the data stack (avoids a circular dependency).
  resourceGroupName: 'data',
});
