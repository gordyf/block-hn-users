let blockedUsers = [];

async function loadBlockedUsers() {
  const result = await chrome.storage.sync.get(['blockedUsers']);
  blockedUsers = result.blockedUsers || [];
  updateUI();
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
      .map(username => `
        <div class="blocked-user-item">
          <span class="username">${escapeHtml(username)}</span>
          <button class="unblock-btn" data-username="${escapeHtml(username)}">Unblock</button>
        </div>
      `)
      .join('');

    document.querySelectorAll('.unblock-btn').forEach(btn => {
      btn.addEventListener('click', unblockUser);
    });
  }
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

  blockedUsers.push(username);
  await chrome.storage.sync.set({ blockedUsers });
  input.value = '';
  updateUI();
}

async function unblockUser(e) {
  const username = e.target.dataset.username;
  blockedUsers = blockedUsers.filter(u => u !== username);
  await chrome.storage.sync.set({ blockedUsers });
  updateUI();
}

async function clearAll() {
  if (confirm('Are you sure you want to unblock all users?')) {
    blockedUsers = [];
    await chrome.storage.sync.set({ blockedUsers });
    updateUI();
  }
}

function exportList() {
  if (blockedUsers.length === 0) {
    alert('No users to export');
    return;
  }

  const content = blockedUsers.sort().join('\n');
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blocked-hn-users.txt';
  a.click();
  URL.revokeObjectURL(url);
}

function importList() {
  document.getElementById('import-file').click();
}

async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const text = await file.text();
  const importedUsers = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (importedUsers.length === 0) {
    alert('No valid usernames found in file');
    return;
  }

  const combined = [...new Set([...blockedUsers, ...importedUsers])];
  const newCount = combined.length - blockedUsers.length;

  blockedUsers = combined;
  await chrome.storage.sync.set({ blockedUsers });
  updateUI();

  alert(`Import complete. Added ${newCount} new user(s). Total blocked: ${blockedUsers.length}`);

  e.target.value = '';
}

document.getElementById('add-user-btn').addEventListener('click', addUser);
document.getElementById('username-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addUser();
  }
});
document.getElementById('clear-all-btn').addEventListener('click', clearAll);
document.getElementById('export-btn').addEventListener('click', exportList);
document.getElementById('import-btn').addEventListener('click', importList);
document.getElementById('import-file').addEventListener('change', handleImport);

loadBlockedUsers();
