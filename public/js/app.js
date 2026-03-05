/* MaNGOSWebV5 - Client-side JavaScript */

document.addEventListener('DOMContentLoaded', function() {
  // Auto-dismiss flash messages after 5 seconds
  document.querySelectorAll('.flash-message').forEach(el => {
    setTimeout(() => {
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 500);
    }, 5000);
  });

  // Initialize Bootstrap tooltips
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipTriggerList.forEach(el => new bootstrap.Tooltip(el));

  // Fetch online count for footer
  const onlineCountEl = document.getElementById('footer-online-count');
  if (onlineCountEl) {
    fetch('/api/online-count')
      .then(r => r.json())
      .then(data => {
        onlineCountEl.textContent = data.count || 0;
      })
      .catch(() => {});
  }

  // Confirm dialogs for delete buttons
  document.querySelectorAll('[data-confirm]').forEach(el => {
    el.addEventListener('click', function(e) {
      if (!confirm(this.dataset.confirm)) {
        e.preventDefault();
      }
    });
  });

  // Character select on shop page - load characters via AJAX
  const characterSelects = document.querySelectorAll('select[name="characterName"]');
  if (characterSelects.length === 0) {
    const realmSelect = document.querySelector('select[name="realmId"]');
    if (realmSelect) {
      realmSelect.addEventListener('change', loadCharacters);
    }
  }
});

async function loadCharacters(realmId) {
  try {
    const resp = await fetch(`/api/characters?realmId=${realmId}`);
    const data = await resp.json();
    return data.characters || [];
  } catch {
    return [];
  }
}

// Copy to clipboard utility
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    // Show brief toast or update button text
  }).catch(() => {
    // Fallback
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  });
}
