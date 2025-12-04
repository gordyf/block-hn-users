// Storage abstraction layer for chrome.storage.sync operations

async function getBlockedUsers() {
  const result = await chrome.storage.sync.get(['blockedUsers']);
  return result.blockedUsers || [];
}

async function setBlockedUsers(users) {
  await chrome.storage.sync.set({ blockedUsers: users });
}

async function addBlockedUser(username) {
  const users = await getBlockedUsers();
  if (!users.includes(username)) {
    users.push(username);
    await setBlockedUsers(users);
  }
  return users;
}

async function removeBlockedUser(username) {
  const users = await getBlockedUsers();
  const filtered = users.filter(u => u !== username);
  await setBlockedUsers(filtered);
  return filtered;
}

// API Key management
async function getAPIKey() {
  const result = await chrome.storage.sync.get(['apiKey']);
  return result.apiKey || null;
}

async function setAPIKey(key) {
  await chrome.storage.sync.set({ apiKey: key });
}

async function clearAPIKey() {
  await chrome.storage.sync.remove(['apiKey']);
}

// Sync state management
async function getSyncState() {
  const result = await chrome.storage.sync.get(['syncState']);
  return result.syncState || {
    lastSyncTime: null,
    lastSyncSuccess: null,
    lastSyncError: null,
    pendingOperations: []
  };
}

async function updateSyncState(updates) {
  const currentState = await getSyncState();
  const newState = { ...currentState, ...updates };
  await chrome.storage.sync.set({ syncState: newState });
  return newState;
}

// Pending operations queue management
async function addPendingOperation(operation) {
  const syncState = await getSyncState();
  const operations = syncState.pendingOperations || [];

  // Check if operation already exists (prevent duplicates)
  const exists = operations.some(
    op => op.username === operation.username && op.type === operation.type
  );

  if (!exists) {
    operations.push({
      ...operation,
      nextRetryTime: operation.nextRetryTime || Date.now()
    });
    await updateSyncState({ pendingOperations: operations });
  }

  return operations;
}

async function removePendingOperation(username, type) {
  const syncState = await getSyncState();
  const operations = syncState.pendingOperations || [];
  const filtered = operations.filter(
    op => !(op.username === username && op.type === type)
  );
  await updateSyncState({ pendingOperations: filtered });
  return filtered;
}

async function getPendingOperations() {
  const syncState = await getSyncState();
  return syncState.pendingOperations || [];
}

async function updatePendingOperation(username, type, updates) {
  const syncState = await getSyncState();
  const operations = syncState.pendingOperations || [];
  const index = operations.findIndex(
    op => op.username === username && op.type === type
  );

  if (index !== -1) {
    operations[index] = { ...operations[index], ...updates };
    await updateSyncState({ pendingOperations: operations });
  }

  return operations;
}

// Clear all sync-related data (useful for debugging or reset)
async function clearSyncData() {
  await chrome.storage.sync.remove(['syncState']);
}
