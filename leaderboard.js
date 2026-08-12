import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import outputs from './amplify_outputs.json';

Amplify.configure(outputs);

const client = generateClient({ authMode: 'identityPool' });
const BOARD = 'global';

function cleanCallsign(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
}

async function list() {
  const { data, errors } = await client.models.Score.listLeaderboard(
    { board: BOARD, sortDirection: 'DESC', limit: 10 },
    { authMode: 'identityPool' },
  );
  if (errors?.length) throw new Error(errors.map((error) => error.message).join(' '));
  return data;
}

async function submit({ callsign, score }) {
  const safeCallsign = cleanCallsign(callsign);
  if (!safeCallsign) throw new Error('Enter a callsign.');
  if (!Number.isInteger(score) || score < 1 || score > 100000) throw new Error('Invalid score.');
  const { errors } = await client.models.Score.create(
    { board: BOARD, callsign: safeCallsign, score },
    { authMode: 'identityPool' },
  );
  if (errors?.length) throw new Error(errors.map((error) => error.message).join(' '));
}

window.neonLeaderboard = { list, submit };
window.dispatchEvent(new Event('neon-leaderboard-ready'));
