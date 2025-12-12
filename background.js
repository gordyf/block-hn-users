// Import storage utilities (note: importScripts is used in service workers)
importScripts('storage.js', 'api.js');

// Alarm names
const DAILY_SYNC_ALARM = 'daily-sync';
const RETRY_SYNC_ALARM = 'retry-sync';

// Retry intervals in milliseconds
const RETRY_INTERVALS = [
  60 * 60 * 1000,      // 1 hour
  4 * 60 * 60 * 1000,  // 4 hours
  12 * 60 * 60 * 1000  // 12 hours
];

// Setup alarms on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[HN Block] Extension installed/updated');

  // Create daily sync alarm (every 24 hours)
  chrome.alarms.create(DAILY_SYNC_ALARM, {
    delayInMinutes: 1, // First sync after 1 minute
    periodInMinutes: 24 * 60 // Then every 24 hours
  });

  // Create retry alarm (check every 30 minutes)
  chrome.alarms.create(RETRY_SYNC_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: 30
  });
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === DAILY_SYNC_ALARM) {
    await performDailySync();
  } else if (alarm.name === RETRY_SYNC_ALARM) {
    await processRetryQueue();
  }
});

// Daily sync: Fetch full list from API and merge with local cache (union)
async function performDailySync() {
  console.log('[HN Block] Starting daily sync...');

  const apiKey = await getAPIKey();
  if (!apiKey) {
    console.log('[HN Block] No API key configured, skipping sync');
    return { success: false, reason: 'no_api_key' };
  }

  try {
    const api = new HNBlockAPI(apiKey);
    const apiUsers = await api.getBlockedUsers();

    // Extract usernames from API response
    const apiUsernames = apiUsers.map(user => user.username);

    // Get current local users
    const localUsers = await getBlockedUsers();

    // Take the union of local and remote users (don't remove locally blocked users!)
    const apiSet = new Set(apiUsernames);
    const localSet = new Set(localUsers);

    // Users in local but not in API - upload them
    const toUpload = localUsers.filter(u => !apiSet.has(u));

    // Users in API but not in local - download them
    const toDownload = apiUsernames.filter(u => !localSet.has(u));

    // Create merged list (union)
    const merged = [...localUsers, ...toDownload];

    // Upload local-only users to API using bulk endpoint
    let uploadedCount = 0;
    let uploadFailed = 0;

    if (toUpload.length > 0) {
      try {
        const bulkResult = await api.bulkBlockUsers(toUpload);
        uploadedCount = bulkResult.successful || 0;

        // Queue failed users for retry
        if (bulkResult.results) {
          for (const result of bulkResult.results) {
            if (!result.success && result.message !== 'User is already blocked') {
              uploadFailed++;
              await addPendingOperation({
                type: 'block',
                username: result.username,
                timestamp: Date.now(),
                retryCount: 0
              });
            }
          }
        }
      } catch (error) {
        console.error('[HN Block] Failed to bulk upload users:', error);
        uploadFailed = toUpload.length;

        // Queue all users for individual retry
        for (const username of toUpload) {
          await addPendingOperation({
            type: 'block',
            username,
            timestamp: Date.now(),
            retryCount: 0
          });
        }
      }
    }

    // Update local cache with merged list
    await setBlockedUsers(merged);

    // Update sync state
    await updateSyncState({
      lastSyncTime: Date.now(),
      lastSyncSuccess: uploadFailed === 0,
      lastSyncError: uploadFailed > 0 ? `Failed to upload ${uploadFailed} users` : null
    });

    // Clear pending operations that are now synced
    await clearSyncedOperations(merged);

    console.log(`[HN Block] Daily sync complete: ${merged.length} users (uploaded ${uploadedCount}, downloaded ${toDownload.length}, failed ${uploadFailed})`);
    return { success: true, userCount: merged.length, uploaded: uploadedCount, downloaded: toDownload.length, uploadFailed };
  } catch (error) {
    console.error('[HN Block] Daily sync failed:', error);

    await updateSyncState({
      lastSyncSuccess: false,
      lastSyncError: error.message
    });

    return { success: false, error: error.message };
  }
}

// Clear pending operations that match the current API state
async function clearSyncedOperations(currentUsernames) {
  const pending = await getPendingOperations();
  const usernameSet = new Set(currentUsernames);

  const stillPending = pending.filter(op => {
    if (op.type === 'block' && usernameSet.has(op.username)) {
      // Block operation succeeded - user is in API
      return false;
    } else if (op.type === 'unblock' && !usernameSet.has(op.username)) {
      // Unblock operation succeeded - user not in API
      return false;
    }
    return true; // Keep pending
  });

  if (stillPending.length !== pending.length) {
    await updateSyncState({ pendingOperations: stillPending });
    console.log(`[HN Block] Cleared ${pending.length - stillPending.length} synced operations`);
  }
}

// Process retry queue for failed operations
async function processRetryQueue() {
  const apiKey = await getAPIKey();
  if (!apiKey) {
    return; // No API key, nothing to retry
  }

  const pending = await getPendingOperations();
  const now = Date.now();

  for (const operation of pending) {
    // Check if it's time to retry
    if (operation.nextRetryTime && operation.nextRetryTime > now) {
      continue; // Not yet time to retry
    }

    // Check if we've exceeded max retries
    if (operation.retryCount >= RETRY_INTERVALS.length) {
      console.log(`[HN Block] Max retries exceeded for ${operation.type} ${operation.username}`);
      continue; // Give up
    }

    await retryOperation(operation);
  }
}

// Retry a single operation
async function retryOperation(operation) {
  const apiKey = await getAPIKey();
  const api = new HNBlockAPI(apiKey);

  console.log(`[HN Block] Retrying ${operation.type} for ${operation.username} (attempt ${operation.retryCount + 1})`);

  try {
    if (operation.type === 'block') {
      await api.blockUser(operation.username);
    } else if (operation.type === 'unblock') {
      await api.unblockUser(operation.username);
    }

    // Success - remove from pending
    await removePendingOperation(operation.username, operation.type);
    await updateSyncState({
      lastSyncTime: Date.now(),
      lastSyncSuccess: true,
      lastSyncError: null
    });

    console.log(`[HN Block] Retry succeeded for ${operation.type} ${operation.username}`);
  } catch (error) {
    console.error(`[HN Block] Retry failed for ${operation.type} ${operation.username}:`, error);

    // Check if error is retryable
    if (api.isRetryableError(error)) {
      // Calculate next retry time
      const retryCount = operation.retryCount + 1;
      const nextRetryTime = Date.now() + RETRY_INTERVALS[retryCount - 1];

      await updatePendingOperation(operation.username, operation.type, {
        retryCount,
        nextRetryTime,
        lastError: error.message
      });

      console.log(`[HN Block] Scheduled retry ${retryCount} for ${operation.type} ${operation.username}`);
    } else {
      // Non-retryable error (e.g., 401 Unauthorized)
      console.log(`[HN Block] Non-retryable error for ${operation.type} ${operation.username}, removing from queue`);
      await removePendingOperation(operation.username, operation.type);

      await updateSyncState({
        lastSyncError: error.message
      });
    }
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'manual-sync') {
    handleManualSync().then(sendResponse);
    return true; // Keep channel open for async response
  } else if (message.type === 'initial-sync') {
    handleInitialSync().then(sendResponse);
    return true;
  }
});

// Manual sync triggered by user
async function handleManualSync() {
  console.log('[HN Block] Manual sync requested');

  // First, perform daily sync
  const syncResult = await performDailySync();

  // Then, process all pending operations (ignore retry timers)
  const pending = await getPendingOperations();
  const results = {
    dailySync: syncResult,
    pendingProcessed: 0,
    pendingFailed: 0
  };

  if (syncResult.success) {
    // Process all pending operations immediately
    const apiKey = await getAPIKey();
    if (apiKey) {
      for (const operation of pending) {
        try {
          await retryOperation(operation);
          results.pendingProcessed++;
        } catch (error) {
          results.pendingFailed++;
        }
      }
    }
  }

  return results;
}

// Initial sync when API key is first configured
async function handleInitialSync() {
  console.log('[HN Block] Initial sync requested');

  const apiKey = await getAPIKey();
  if (!apiKey) {
    return { success: false, reason: 'no_api_key' };
  }

  try {
    const api = new HNBlockAPI(apiKey);

    // Get current local users
    const localUsers = await getBlockedUsers();

    // Get current API users
    const apiUsers = await api.getBlockedUsers();
    const apiUsernames = new Set(apiUsers.map(u => u.username));

    // Upload local users not in API using bulk endpoint
    const toUpload = localUsers.filter(u => !apiUsernames.has(u));
    let uploaded = 0;
    let uploadFailed = 0;

    if (toUpload.length > 0) {
      try {
        const bulkResult = await api.bulkBlockUsers(toUpload);
        uploaded = bulkResult.successful || 0;

        // Queue failed users for retry
        if (bulkResult.results) {
          for (const result of bulkResult.results) {
            if (!result.success && result.message !== 'User is already blocked') {
              uploadFailed++;
              await addPendingOperation({
                type: 'block',
                username: result.username,
                timestamp: Date.now(),
                retryCount: 0
              });
            }
          }
        }
      } catch (error) {
        console.error('[HN Block] Failed to bulk upload users:', error);
        uploadFailed = toUpload.length;

        // Queue all users for individual retry
        for (const username of toUpload) {
          await addPendingOperation({
            type: 'block',
            username,
            timestamp: Date.now(),
            retryCount: 0
          });
        }
      }
    }

    // Merge API users with local
    const localSet = new Set(localUsers);
    const toDownload = apiUsers.filter(u => !localSet.has(u.username)).map(u => u.username);
    const merged = [...localUsers, ...toDownload];

    // Update local cache
    await setBlockedUsers(merged);

    // Update sync state
    await updateSyncState({
      lastSyncTime: Date.now(),
      lastSyncSuccess: uploadFailed === 0,
      lastSyncError: uploadFailed > 0 ? `Failed to upload ${uploadFailed} users` : null
    });

    console.log(`[HN Block] Initial sync complete: ${uploaded} uploaded, ${toDownload.length} downloaded`);

    return {
      success: true,
      uploaded,
      downloaded: toDownload.length,
      uploadFailed,
      totalUsers: merged.length
    };
  } catch (error) {
    console.error('[HN Block] Initial sync failed:', error);

    await updateSyncState({
      lastSyncSuccess: false,
      lastSyncError: error.message
    });

    return { success: false, error: error.message };
  }
}

// Log service worker lifecycle
console.log('[HN Block] Service worker loaded');
