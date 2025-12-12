// Import storage utilities
// Note: Can't use ES6 imports in extension popups, use script tags instead

let blockedUsers = [];
let syncState = null;
let apiKey = null;

async function loadData() {
  blockedUsers = await getBlockedUsers();
  syncState = await getSyncState();
  apiKey = await getAPIKey();
  updateUI();
  updateSyncStatus();
}

function updateUI() {
  const blockedList = document.getElementById('blocked-list');
  const blockedCount = document.getElementById('blocked-count');
  const emptyMessage = document.getElementById('empty-message');

  blockedCount.textContent = blockedUsers.length;

  if (blockedUsers.length === 0) {
    blockedList.innerHTML = '';
    emptyMessage.style.display = 'block';
  } else {
    emptyMessage.style.display = 'none';
    blockedList.innerHTML = blockedUsers
      .sort()
      .map(username => {
        const syncIndicator = getSyncIndicatorHTML(username);
        return `
          <div class="blocked-user-item">
            <span class="username">${escapeHtml(username)}</span>
            ${syncIndicator}
            <button class="unblock-btn" data-username="${escapeHtml(username)}">Unblock</button>
          </div>
        `;
      })
      .join('');

    document.querySelectorAll('.unblock-btn').forEach(btn => {
      btn.addEventListener('click', unblockUser);
    });
  }
}

function getSyncIndicatorHTML(username) {
  if (!apiKey) {
    return ''; // No API key, no sync indicator
  }

  const pending = syncState?.pendingOperations || [];
  const operation = pending.find(op => op.username === username);

  if (operation) {
    const retryCount = operation.retryCount || 0;
    if (retryCount >= 3) {
      return '<span class="sync-indicator failed" title="Sync failed - max retries exceeded">⚠</span>';
    } else {
      return `<span class="sync-indicator pending" title="Sync pending - will retry">⏱</span>`;
    }
  }

  return ''; // Successfully synced, no indicator
}

function updateSyncStatus() {
  const statusText = document.getElementById('sync-status-text');
  const syncIcon = document.getElementById('sync-icon');
  const syncBtn = document.getElementById('sync-now-btn');
  const apiKeyInput = document.getElementById('api-key-input');

  if (!apiKey) {
    statusText.textContent = 'Offline mode - No API key configured';
    statusText.className = 'sync-status-text offline';
    syncBtn.disabled = true;
    apiKeyInput.value = '';
  } else {
    syncBtn.disabled = false;
    apiKeyInput.value = '••••••••'; // Show masked API key

    if (syncState?.lastSyncTime) {
      const timeSince = getTimeSince(syncState.lastSyncTime);
      if (syncState.lastSyncSuccess) {
        statusText.textContent = `Last synced: ${timeSince}`;
        statusText.className = 'sync-status-text success';
      } else {
        statusText.textContent = `Sync error: ${syncState.lastSyncError || 'Unknown error'}`;
        statusText.className = 'sync-status-text error';
      }
    } else {
      statusText.textContent = 'API configured - Never synced';
      statusText.className = 'sync-status-text warning';
    }

    // Show pending count if any
    const pendingCount = syncState?.pendingOperations?.length || 0;
    if (pendingCount > 0) {
      statusText.textContent += ` (${pendingCount} pending)`;
    }
  }
}

function getTimeSince(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function addUser() {
  const input = document.getElementById('username-input');
  const username = input.value.trim();

  if (!username) {
    alert('Please enter a username');
    return;
  }

  if (blockedUsers.includes(username)) {
    alert('User is already blocked');
    input.value = '';
    return;
  }

  // 1. Optimistic update - update local cache immediately
  blockedUsers.push(username);
  await setBlockedUsers(blockedUsers);
  input.value = '';
  updateUI();

  // 2. Sync to API if configured
  if (apiKey) {
    try {
      const api = new HNBlockAPI(apiKey);
      await api.blockUser(username);

      // Success - update sync state
      await updateSyncState({
        lastSyncTime: Date.now(),
        lastSyncSuccess: true,
        lastSyncError: null
      });

      syncState = await getSyncState();
      updateSyncStatus();
    } catch (error) {
      console.error('Failed to sync block operation:', error);

      // Check if error is retryable
      const api = new HNBlockAPI(apiKey);
      if (api.isRetryableError(error)) {
        // Queue for retry
        await addPendingOperation({
          type: 'block',
          username,
          timestamp: Date.now(),
          retryCount: 0
        });

        syncState = await getSyncState();
        updateUI();
        updateSyncStatus();
      } else if (api.isAuthError(error)) {
        // Auth error - show message
        alert(`Failed to sync: Invalid API key. User blocked locally.`);
      } else {
        // Other error
        alert(`Failed to sync: ${error.message}. User blocked locally.`);
      }
    }
  }
}

async function unblockUser(e) {
  const username = e.target.dataset.username;
  const originalList = [...blockedUsers];

  // 1. Optimistic update - remove immediately
  blockedUsers = blockedUsers.filter(u => u !== username);
  await setBlockedUsers(blockedUsers);
  updateUI();

  // 2. Sync to API if configured
  if (apiKey) {
    try {
      const api = new HNBlockAPI(apiKey);
      await api.unblockUser(username);

      // Success - update sync state and remove from pending
      await removePendingOperation(username, 'unblock');
      await updateSyncState({
        lastSyncTime: Date.now(),
        lastSyncSuccess: true,
        lastSyncError: null
      });

      syncState = await getSyncState();
      updateSyncStatus();
    } catch (error) {
      console.error('Failed to sync unblock operation:', error);

      const api = new HNBlockAPI(apiKey);
      if (api.isRetryableError(error)) {
        // Queue for retry, keep UI optimistic
        await addPendingOperation({
          type: 'unblock',
          username,
          timestamp: Date.now(),
          retryCount: 0
        });

        syncState = await getSyncState();
        updateSyncStatus();
      } else if (api.isAuthError(error)) {
        // Auth error - rollback
        blockedUsers = originalList;
        await setBlockedUsers(originalList);
        updateUI();
        alert('Failed to sync: Invalid API key');
      } else {
        // Non-retryable error - rollback
        blockedUsers = originalList;
        await setBlockedUsers(originalList);
        updateUI();
        alert(`Failed to unblock ${username}: ${error.message}`);
      }
    }
  }
}

async function clearAll() {
  if (!confirm('Are you sure you want to unblock all users?')) {
    return;
  }

  // Store original list for potential rollback
  const originalList = [...blockedUsers];

  // Clear locally
  blockedUsers = [];
  await setBlockedUsers(blockedUsers);
  updateUI();

  // If API configured, queue unblock operations for each user
  if (apiKey) {
    for (const username of originalList) {
      await addPendingOperation({
        type: 'unblock',
        username,
        timestamp: Date.now(),
        retryCount: 0
      });
    }

    syncState = await getSyncState();
    updateSyncStatus();

    // Trigger manual sync to process all unblocks immediately
    syncNow();
  }
}

async function saveAPIKey() {
  const input = document.getElementById('api-key-input');
  const key = input.value.trim();

  if (!key) {
    alert('Please enter an API key');
    return;
  }

  // Don't re-save if already configured (input shows masked value)
  if (key === '••••••••' && apiKey) {
    return;
  }

  // Save API key
  await setAPIKey(key);
  apiKey = key;

  // Test connection
  const api = new HNBlockAPI(key);
  const connectionTest = await api.checkConnection();

  if (connectionTest.success) {
    // Perform initial sync
    const syncBtn = document.getElementById('sync-now-btn');
    syncBtn.disabled = true;
    const syncIcon = document.getElementById('sync-icon');
    syncIcon.classList.add('spinning');
    document.getElementById('sync-status-text').textContent = 'Performing initial sync...';

    try {
      const result = await chrome.runtime.sendMessage({ type: 'initial-sync' });

      if (result.success) {
        alert(`API key saved! Synced ${result.totalUsers} users (uploaded ${result.uploaded}, downloaded ${result.downloaded})`);
        // Reload data to reflect changes
        await loadData();
      } else {
        alert(`API key saved but sync failed: ${result.error}`);
      }
    } catch (error) {
      alert(`API key saved but sync failed: ${error.message}`);
    } finally {
      syncIcon.classList.remove('spinning');
      syncBtn.disabled = false;
    }
  } else {
    if (connectionTest.isAuthError) {
      alert('Invalid API key. Please check your key and try again.');
      await clearAPIKey();
      apiKey = null;
      updateSyncStatus();
    } else {
      alert(`API key saved but connection test failed: ${connectionTest.error}\n\nThe key has been saved and will be used when connection is available.`);
      updateSyncStatus();
    }
  }
}

async function clearAPIKeyHandler() {
  if (!confirm('Clear API key? Extension will work in offline mode only.')) {
    return;
  }

  await clearAPIKey();
  apiKey = null;
  updateSyncStatus();
  updateUI();

  // Clear sync state
  await updateSyncState({
    lastSyncTime: null,
    lastSyncSuccess: null,
    lastSyncError: null,
    pendingOperations: []
  });
}

async function syncNow() {
  if (!apiKey) {
    alert('No API key configured');
    return;
  }

  const syncBtn = document.getElementById('sync-now-btn');
  const syncIcon = document.getElementById('sync-icon');
  const statusText = document.getElementById('sync-status-text');

  syncBtn.disabled = true;
  syncIcon.classList.add('spinning');
  statusText.textContent = 'Syncing...';

  try {
    const result = await chrome.runtime.sendMessage({ type: 'manual-sync' });

    if (result.dailySync.success) {
      // Reload blocked users from storage (may have changed from API)
      blockedUsers = await getBlockedUsers();
      syncState = await getSyncState();

      updateUI();
      updateSyncStatus();

      const uploadMsg = result.dailySync.uploaded > 0
        ? ` Uploaded ${result.dailySync.uploaded} local users.`
        : '';
      const downloadMsg = result.dailySync.downloaded > 0
        ? ` Downloaded ${result.dailySync.downloaded} remote users.`
        : '';
      const pendingMsg = result.pendingProcessed > 0
        ? ` Processed ${result.pendingProcessed} pending operations.`
        : '';

      alert(`Sync complete! ${result.dailySync.userCount} total users.${uploadMsg}${downloadMsg}${pendingMsg}`);
    } else {
      alert(`Sync failed: ${result.dailySync.error || result.dailySync.reason}`);
      syncState = await getSyncState();
      updateSyncStatus();
    }
  } catch (error) {
    alert(`Sync failed: ${error.message}`);
    syncState = await getSyncState();
    updateSyncStatus();
  } finally {
    syncIcon.classList.remove('spinning');
    syncBtn.disabled = false;
  }
}

// Event listeners
document.getElementById('add-user-btn').addEventListener('click', addUser);
document.getElementById('username-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addUser();
  }
});
document.getElementById('clear-all-btn').addEventListener('click', clearAll);
document.getElementById('save-api-key-btn').addEventListener('click', saveAPIKey);
document.getElementById('clear-api-key-btn').addEventListener('click', clearAPIKeyHandler);
document.getElementById('sync-now-btn').addEventListener('click', syncNow);

// Also allow Enter key in API key input to save
document.getElementById('api-key-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    saveAPIKey();
  }
});

// Listen for storage changes (from background or content script)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    if (changes.blockedUsers) {
      loadData();
    } else if (changes.syncState) {
      syncState = changes.syncState.newValue;
      updateSyncStatus();
      updateUI();
    }
  }
});

// Load initial data
loadData();
