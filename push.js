// Web Push for the arcade's online games: registers the service worker and returns this browser's push
// subscription, which a game saves on the player's room seat so the pool-notify function can reach them.
window.NeonPush = (() => {
  // Public half of the key pair; the private half is the Amplify secret POOL_VAPID_PRIVATE_KEY.
  const PUBLIC_KEY = 'BOsUaj5d7uTAR2HPVaJl3fB-2Mv1eYnYP2YQ9IemQWvU2Rc-83u5_Cmo6ALXXiXksWiAyuhyE1ZFG_abMDJfs9Q';
  // iPhones only allow web push for sites added to the Home Screen and opened from there.
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const key = () => { const padded = PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - PUBLIC_KEY.length % 4) % 4); return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)); };

  async function subscription() {
    const registration = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    return JSON.stringify(existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key() }));
  }
  return { isIos, installed, supported, needsHomeScreen: !supported && isIos && !installed, subscription };
})();
