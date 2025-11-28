let blockedUsers = new Set();

async function loadBlockedUsers() {
  const result = await chrome.storage.sync.get(['blockedUsers']);
  blockedUsers = new Set(result.blockedUsers || []);
}

function hideBlockedContent() {
  const userLinks = document.querySelectorAll('a.hnuser');

  userLinks.forEach(link => {
    const username = link.textContent;

    const commentRow = link.closest('tr.comtr');

    if (blockedUsers.has(username)) {
      const postRow = link.closest('tr.athing');

      if (commentRow) {
        if (!commentRow.classList.contains('blocked-comment')) {
          commentRow.classList.add('blocked-comment');

          const commentText = commentRow.querySelector('.commtext');
          if (commentText && !commentText.dataset.originalContent) {
            commentText.dataset.originalContent = commentText.innerHTML;
            commentText.innerHTML = '<span class="blocked-text">[comment from blocked user]</span>';
          }

          link.innerHTML = '<span class="blocked-username">[blocked user]</span>';
        }
      } else if (postRow) {
        postRow.style.display = 'none';
        const nextRow = postRow.nextElementSibling;
        if (nextRow && (nextRow.classList.contains('spacer') || nextRow.querySelector('.subtext'))) {
          nextRow.style.display = 'none';
        }
      }
    } else if (commentRow) {
      const blockButton = createBlockButton(username);
      if (!link.parentElement.querySelector('.block-user-btn')) {
        link.parentElement.appendChild(document.createTextNode(' '));
        link.parentElement.appendChild(blockButton);
      }
    }
  });
}

function createBlockButton(username) {
  const button = document.createElement('span');
  button.className = 'block-user-btn';
  button.textContent = '[block]';
  button.style.cursor = 'pointer';
  button.style.color = '#828282';
  button.style.fontSize = '10px';

  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (confirm(`Block user "${username}"? Their posts and comments will be hidden.`)) {
      blockedUsers.add(username);
      await chrome.storage.sync.set({
        blockedUsers: Array.from(blockedUsers)
      });
      hideBlockedContent();
    }
  });

  return button;
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.blockedUsers) {
    loadBlockedUsers().then(() => {
      location.reload();
    });
  }
});

async function init() {
  await loadBlockedUsers();
  hideBlockedContent();

  const observer = new MutationObserver(() => {
    hideBlockedContent();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

init();
