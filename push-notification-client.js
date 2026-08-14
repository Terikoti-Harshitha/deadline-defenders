// push-notification-client.js — Modern Web Push Client for Deadline Defenders

let cachedPublicKey = null;

// Helper to convert base64 URL to Uint8Array for Web Push
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

// Fetch public VAPID key dynamically from the server
async function getPublicVapidKey() {
  if (cachedPublicKey) return cachedPublicKey;
  try {
    const res = await fetch('/push/vapid-public-key');
    if (res.ok) {
      const data = await res.json();
      if (data.publicKey) {
        cachedPublicKey = data.publicKey;
        return cachedPublicKey;
      }
    }
  } catch (e) {
    console.warn('Could not fetch VAPID key from server, using fallback');
  }
  // Fallback default
  cachedPublicKey = 'BFs84GA9gHYEAhB2ehAKYu-45kQQu-ddolDbTkHBn_NN7Yic7jT9rUj-2fgyhboeq37g7TsGfFwzjA_4VX0mNMY';
  return cachedPublicKey;
}

// Check if browser supports Web Push & Service Worker
function isNotificationSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Register service worker
async function registerServiceWorker() {
  if (!isNotificationSupported()) {
    console.log('[Push] Notifications not supported in this browser');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/'
    });
    await navigator.serviceWorker.ready;
    console.log('[Push] Service Worker registered and ready');
    return registration;
  } catch (error) {
    console.error('[Push] Service Worker registration failed:', error);
    return null;
  }
}

// Request notification permission
async function requestNotificationPermission() {
  if (!isNotificationSupported()) {
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  return await Notification.requestPermission();
}

// Subscribe to push notifications
async function subscribeToPushNotifications() {
  if (!isNotificationSupported()) {
    showNotificationBanner('Push notifications are not supported in this browser.', 'warning');
    return false;
  }

  try {
    const permission = await requestNotificationPermission();

    if (permission !== 'granted') {
      showNotificationBanner('Please allow notifications in your browser to receive alerts.', 'warning');
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    const publicKey = await getPublicVapidKey();

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }

    const response = await fetch('/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(subscription)
    });

    if (response.ok) {
      console.log('[Push] Subscribed successfully');
      showNotificationBanner('🔔 Push notifications enabled! You will receive deadline alerts.', 'success');
      updateNotificationUI(true);
      return true;
    } else {
      const errData = await response.json().catch(() => ({}));
      showNotificationBanner(errData.error || 'Failed to save subscription on server', 'error');
      return false;
    }
  } catch (error) {
    console.error('[Push] Error subscribing:', error);
    showNotificationBanner('Failed to enable notifications. Please check browser permissions.', 'error');
    return false;
  }
}

// Unsubscribe
async function unsubscribeFromPushNotifications() {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      await subscription.unsubscribe();
    }

    await fetch('/push/unsubscribe', {
      method: 'POST',
      credentials: 'include'
    });

    console.log('[Push] Unsubscribed');
    showNotificationBanner('Push notifications disabled', 'info');
    updateNotificationUI(false);
    return true;
  } catch (error) {
    console.error('[Push] Error unsubscribing:', error);
    return false;
  }
}

// Check subscription status
async function checkNotificationStatus() {
  if (!isNotificationSupported()) return false;
  try {
    const response = await fetch('/push/status', { credentials: 'include' });
    if (!response.ok) return false;
    const data = await response.json();
    const isSubscribed = !!data.subscribed;
    updateNotificationUI(isSubscribed);
    return isSubscribed;
  } catch (error) {
    return false;
  }
}

// Update UI badges/buttons
function updateNotificationUI(isSubscribed) {
  const notifBtn = document.getElementById('notificationToggleBtn');
  const notifStatus = document.getElementById('notificationStatus');

  if (notifBtn) {
    notifBtn.innerHTML = isSubscribed ? '🔔 Notifications ON' : '🔕 Enable Notifications';
    notifBtn.className = isSubscribed ? 'active' : 'inactive';
  }

  if (notifStatus) {
    notifStatus.textContent = isSubscribed ? 'Active' : 'Disabled';
    notifStatus.className = isSubscribed ? 'status-active' : 'status-inactive';
  }
}

// Floating alert helper
function showNotificationBanner(message, type = 'info') {
  const banner = document.getElementById('alertBanner') || document.getElementById('npBar');
  if (!banner) return;

  const colors = {
    success: '#00c48c',
    error: '#e8601c',
    warning: '#f5a623',
    info: '#4fc3f7'
  };

  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.top = '20px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = colors[type] || colors.info;
  toast.style.color = '#080a0e';
  toast.style.fontWeight = '700';
  toast.style.fontSize = '13px';
  toast.style.padding = '12px 24px';
  toast.style.borderRadius = '30px';
  toast.style.zIndex = '9999';
  toast.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
  toast.style.animation = 'fadeIn .3s ease';
  toast.textContent = message;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .4s ease';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// Send a test notification
async function sendTestNotification() {
  try {
    const response = await fetch('/push/test', {
      method: 'POST',
      credentials: 'include'
    });

    const data = await response.json();
    if (response.ok) {
      showNotificationBanner('Test notification sent! Check your notifications bar.', 'success');
    } else {
      showNotificationBanner(data.error || 'Failed to send test notification', 'error');
    }
  } catch (error) {
    showNotificationBanner('Network error while sending test notification', 'error');
  }
}

// Initialize on page load
async function initializePushNotifications() {
  if (!isNotificationSupported()) return;
  await registerServiceWorker();
  await checkNotificationStatus();
}

window.pushNotifications = {
  initialize: initializePushNotifications,
  subscribe: subscribeToPushNotifications,
  unsubscribe: unsubscribeFromPushNotifications,
  checkStatus: checkNotificationStatus,
  sendTest: sendTestNotification,
  isSupported: isNotificationSupported
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePushNotifications);
} else {
  initializePushNotifications();
}