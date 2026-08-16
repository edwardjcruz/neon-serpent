import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';

const BOARD = 'snake';

function cleanCallsign(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
}

async function startLeaderboard() {
  const response = await fetch('./amplify_outputs.json');
  if (!response.ok) throw new Error('Leaderboard configuration is unavailable.');
  Amplify.configure(await response.json());
  const client = generateClient({ authMode: 'identityPool' });

  async function list({ board = BOARD, sortDirection = 'DESC', limit = 10 } = {}) {
  const { data, errors } = await client.models.Score.listLeaderboard(
    { board, sortDirection, limit },
    { authMode: 'identityPool' },
  );
  if (errors?.length) throw new Error(errors.map((error) => error.message).join(' '));
    return data;
  }

  async function submit({ callsign, score, board = BOARD }) {
  const safeCallsign = cleanCallsign(callsign);
  if (!safeCallsign) throw new Error('Enter a callsign.');
  if (!Number.isInteger(score) || score < 1 || score > 100000) throw new Error('Invalid score.');
  const { errors } = await client.models.Score.create(
    { board, callsign: safeCallsign, score },
    { authMode: 'identityPool' },
  );
    if (errors?.length) throw new Error(errors.map((error) => error.message).join(' '));
  }

  window.neonLeaderboard = { list, submit };
  window.dispatchEvent(new Event('neon-leaderboard-ready'));
}

startLeaderboard().catch(() => {});
