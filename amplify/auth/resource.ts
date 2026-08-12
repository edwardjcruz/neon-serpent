import { defineAuth } from '@aws-amplify/backend';

// Guests receive a device-scoped identity; no sign-up screen is required.
export const auth = defineAuth({
  loginWith: { email: true },
  allowGuestAccess: true,
});
