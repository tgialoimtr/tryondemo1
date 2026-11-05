import {
  signInWithGoogle,
  signOut,
  getUser,
  onAuthStateChange,
  addPersonImage,
  getPersonImages,
  deletePersonImage,
  addItemImage,
  getItemImages,
  deleteItemImage,
  getProfile,
  upsertProfile,
} from './supabase.js';

// ══════════════════════════════════════════════════════════════
// Image Compression
// ══════════════════════════════════════════════════════════════
/**
 * Compress an image File using a canvas.
 * Camera shots are typically 3–8 MB; this reduces them to ~200–400 KB.
 * @param {File} file - Original image file
 * @param {number} maxPx - Max width/height in pixels (default 1200)
 * @param {number} quality - JPEG quality 0–1 (default 0.85)
 * @returns {Promise<File>} Compressed file (or original if already small)
 */
async function compressImage(file, maxPx = 1200, quality = 0.8) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;

      if (width <= maxPx && height <= maxPx) {
        resolve(file);
        return;
      }

      let targetWidth = width;
      let targetHeight = height;

      if (width > height) {
        targetHeight = Math.round((height / width) * maxPx);
        targetWidth = maxPx;
      } else {
        targetWidth = Math.round((width / height) * maxPx);
        targetHeight = maxPx;
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Canvas toBlob failed'));
            return;
          }

          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });

          resolve(compressed);
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for compression'));
    };

    img.src = url;
  });
}

// ══════════════════════════════════════════════════════════════
// State
// ══════════════════════════════════════════════════════════════
let currentUser = null;
let personImages = [];
let itemImages = [];

// Default sample images (shown when no user is logged in, or first load)
const SAMPLE_PERSONS = [
  { id: 'sample-person-1', image_url: '/samples/nam.jpg', storage_path: null, is_sample: true },
];
const SAMPLE_ITEMS = [
  { id: 'sample-item-1', image_url: '/samples/ao_khoac_2.jpg', storage_path: null, is_sample: true },
];

// ══════════════════════════════════════════════════════════════
// DOM References
// ══════════════════════════════════════════════════════════════
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  // Tabs
  tabBtns: $$('.tab-btn'),
  tabPanels: $$('.tab-panel'),

  // Person section
  btnPersonGallery: $('#btn-person-gallery'),
  btnPersonCamera: $('#btn-person-camera'),
  inputPersonGallery: $('#input-person-gallery'),
  inputPersonCamera: $('#input-person-camera'),
  personGallery: $('#person-gallery'),
  personEmpty: $('#person-empty'),

  // Item section
  btnItemGallery: $('#btn-item-gallery'),
  btnItemCamera: $('#btn-item-camera'),
  inputItemGallery: $('#input-item-gallery'),
  inputItemCamera: $('#input-item-camera'),
  itemGallery: $('#item-gallery'),
  itemEmpty: $('#item-empty'),

  // Account section
  accountLoggedOut: $('#account-logged-out'),
  accountLoggedIn: $('#account-logged-in'),
  btnGoogleLogin: $('#btn-google-login'),
  btnLogout: $('#btn-logout'),
  profileAvatar: $('#profile-avatar'),
  profileName: $('#profile-name'),
  profileEmail: $('#profile-email'),
  inputShopName: $('#input-shop-name'),
  inputAddress: $('#input-address'),
  btnSaveProfile: $('#btn-save-profile'),

  // Header
  headerUser: $('#header-user'),
  headerAvatar: $('#header-avatar'),

  // Loading
  loadingOverlay: $('#loading-overlay'),

  // Toast
  toastContainer: $('#toast-container'),
};

// ══════════════════════════════════════════════════════════════
// Toast System
// ══════════════════════════════════════════════════════════════
const TOAST_ICONS = {
  success: 'check_circle',
  error: 'error',
  info: 'info',
  warning: 'warning',
};

function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="material-icons-round">${TOAST_ICONS[type]}</span>
    <span>${message}</span>
  `;
  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

// ══════════════════════════════════════════════════════════════
// Loading Overlay
// ══════════════════════════════════════════════════════════════
function showLoading() {
  els.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  els.loadingOverlay.classList.add('hidden');
}

// ══════════════════════════════════════════════════════════════
// Confirm Dialog
// ══════════════════════════════════════════════════════════════
function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="confirm-actions">
          <button class="btn-confirm-cancel">Cancel</button>
          <button class="btn-confirm-delete">Delete</button>
        </div>
      </div>
    `;

    overlay.querySelector('.btn-confirm-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });

    overlay.querySelector('.btn-confirm-delete').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });

    document.body.appendChild(overlay);
  });
}

// ══════════════════════════════════════════════════════════════
// Tab Navigation
// ══════════════════════════════════════════════════════════════
function initTabs() {
  els.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;

      // Update active button
      els.tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // Update active panel
      els.tabPanels.forEach((p) => p.classList.remove('active'));
      $(`#tab-${tabName}`).classList.add('active');
    });
  });
}

// ══════════════════════════════════════════════════════════════
// Person Images
// ══════════════════════════════════════════════════════════════
function renderPersonGallery() {
  const images = personImages.length > 0 ? personImages : SAMPLE_PERSONS;
  const showSamples = personImages.length === 0;

  if (images.length === 0) {
    els.personGallery.innerHTML = '';
    els.personEmpty.classList.add('visible');
    return;
  }

  els.personEmpty.classList.remove('visible');
  els.personGallery.innerHTML = images
    .map(
      (img, i) => `
    <div class="gallery-card" style="animation-delay: ${i * 0.06}s" data-id="${img.id}">
      <img src="${img.image_url}" alt="Person" loading="lazy" />
      <div class="card-actions">
        <button class="btn-action btn-find-clothes" data-id="${img.id}" title="Find Clothes">
          <span class="material-icons-round">search</span>
        </button>
        <button class="btn-action btn-delete" data-id="${img.id}" data-path="${img.storage_path || ''}" data-sample="${img.is_sample || false}" title="Delete">
          <span class="material-icons-round">delete</span>
        </button>
      </div>
    </div>
  `
    )
    .join('');

  // Bind Find Clothes buttons
  els.personGallery.querySelectorAll('.btn-find-clothes').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showToast('🔍 AI Try-On feature coming soon!', 'info');
    });
  });

  // Bind Delete buttons
  els.personGallery.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const path = btn.dataset.path;
      const isSample = btn.dataset.sample === 'true';

      if (isSample) {
        showToast('Cannot delete sample images', 'warning');
        return;
      }

      const confirmed = await showConfirm(
        'Delete Image',
        'Are you sure you want to delete this person image?'
      );

      if (!confirmed) return;

      try {
        showLoading();
        await deletePersonImage(id, path);
        personImages = personImages.filter((img) => img.id !== id);
        renderPersonGallery();
        showToast('Image deleted', 'success');
      } catch (err) {
        console.error('Delete person image error:', err);
        showToast('Failed to delete image', 'error');
      } finally {
        hideLoading();
      }
    });
  });
}

async function handlePersonFileSelected(file) {
  if (!file) return;

  if (!currentUser) {
    // If not logged in, show preview with local URL
    const localUrl = URL.createObjectURL(file);
    personImages.push({
      id: `local-${Date.now()}`,
      image_url: localUrl,
      storage_path: null,
      is_sample: false,
      is_local: true,
    });
    renderPersonGallery();
    showToast('Image added locally. Sign in to sync.', 'info');
    return;
  }

  try {
    showLoading();
    const compressed = await compressImage(file);
    const data = await addPersonImage(currentUser.id, compressed);
    personImages.unshift(data);
    renderPersonGallery();
    showToast('Person image added!', 'success');
  } catch (err) {
    console.error('Add person image error:', err);
    showToast('Failed to add image: ' + (err.message || 'Unknown error'), 'error');
  } finally {
    hideLoading();
  }
}

function initPersonSection() {
  els.btnPersonGallery.addEventListener('click', () => {
    els.inputPersonGallery.click();
  });

  els.btnPersonCamera.addEventListener('click', () => {
    els.inputPersonCamera.click();
  });

  els.inputPersonGallery.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // reset before async op so re-select works
    if (file) handlePersonFileSelected(file);
  });

  els.inputPersonCamera.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handlePersonFileSelected(file);
  });

  renderPersonGallery();
}

// ══════════════════════════════════════════════════════════════
// Item Images
// ══════════════════════════════════════════════════════════════
function renderItemGallery() {
  const images = itemImages.length > 0 ? itemImages : SAMPLE_ITEMS;

  if (images.length === 0) {
    els.itemGallery.innerHTML = '';
    els.itemEmpty.classList.add('visible');
    return;
  }

  els.itemEmpty.classList.remove('visible');
  els.itemGallery.innerHTML = images
    .map(
      (img, i) => `
    <div class="gallery-card" style="animation-delay: ${i * 0.06}s" data-id="${img.id}">
      <img src="${img.image_url}" alt="Item" loading="lazy" />
      <div class="card-actions">
        <button class="btn-action btn-delete btn-delete-only" data-id="${img.id}" data-path="${img.storage_path || ''}" data-sample="${img.is_sample || false}" title="Delete">
          <span class="material-icons-round">delete</span>
        </button>
      </div>
    </div>
  `
    )
    .join('');

  // Bind Delete buttons
  els.itemGallery.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const path = btn.dataset.path;
      const isSample = btn.dataset.sample === 'true';

      if (isSample) {
        showToast('Cannot delete sample images', 'warning');
        return;
      }

      const confirmed = await showConfirm(
        'Delete Item',
        'Are you sure you want to delete this item?'
      );

      if (!confirmed) return;

      try {
        showLoading();
        await deleteItemImage(id, path);
        itemImages = itemImages.filter((img) => img.id !== id);
        renderItemGallery();
        showToast('Item deleted', 'success');
      } catch (err) {
        console.error('Delete item image error:', err);
        showToast('Failed to delete item', 'error');
      } finally {
        hideLoading();
      }
    });
  });
}

async function handleItemFileSelected(file) {
  if (!file) return;

  if (!currentUser) {
    const localUrl = URL.createObjectURL(file);
    itemImages.push({
      id: `local-${Date.now()}`,
      image_url: localUrl,
      storage_path: null,
      is_sample: false,
      is_local: true,
    });
    renderItemGallery();
    showToast('Item added locally. Sign in to sync.', 'info');
    return;
  }

  try {
    showLoading();
    const compressed = await compressImage(file);
    const data = await addItemImage(currentUser.id, compressed);
    itemImages.unshift(data);
    renderItemGallery();
    showToast('Item added!', 'success');
  } catch (err) {
    console.error('Add item image error:', err);
    showToast('Failed to add item: ' + (err.message || 'Unknown error'), 'error');
  } finally {
    hideLoading();
  }
}

function initItemSection() {
  els.btnItemGallery.addEventListener('click', () => {
    els.inputItemGallery.click();
  });

  els.btnItemCamera.addEventListener('click', () => {
    els.inputItemCamera.click();
  });

  els.inputItemGallery.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // reset before async op so re-select works
    if (file) handleItemFileSelected(file);
  });

  els.inputItemCamera.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handleItemFileSelected(file);
  });

  renderItemGallery();
}

// ══════════════════════════════════════════════════════════════
// Account Section
// ══════════════════════════════════════════════════════════════
function updateAccountUI(user) {
  if (user) {
    els.accountLoggedOut.classList.add('hidden');
    els.accountLoggedIn.classList.remove('hidden');
    els.headerUser.classList.remove('hidden');

    const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
    const fullName = user.user_metadata?.full_name || user.user_metadata?.name || 'User';
    const email = user.email || '';

    els.profileAvatar.src = avatarUrl;
    els.profileName.textContent = fullName;
    els.profileEmail.textContent = email;
    els.headerAvatar.src = avatarUrl;
  } else {
    els.accountLoggedOut.classList.remove('hidden');
    els.accountLoggedIn.classList.add('hidden');
    els.headerUser.classList.add('hidden');
  }
}

async function loadUserData(user) {
  if (!user) return;

  try {
    // Load profile
    const profile = await getProfile(user.id);
    if (profile) {
      els.inputShopName.value = profile.shop_name || '';
      els.inputAddress.value = profile.address || '';
    }

    // Load images
    const [persons, items] = await Promise.all([
      getPersonImages(user.id),
      getItemImages(user.id),
    ]);

    personImages = persons;
    itemImages = items;
    renderPersonGallery();
    renderItemGallery();
  } catch (err) {
    console.error('Load user data error:', err);
    showToast('Failed to load your data', 'error');
  }
}

function initAccountSection() {
  // Google login
  els.btnGoogleLogin.addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error('Google login error:', err);
      showToast('Login failed: ' + (err.message || 'Unknown error'), 'error');
    }
  });

  // Logout
  els.btnLogout.addEventListener('click', async () => {
    try {
      await signOut();
      currentUser = null;
      personImages = [];
      itemImages = [];
      updateAccountUI(null);
      renderPersonGallery();
      renderItemGallery();
      els.inputShopName.value = '';
      els.inputAddress.value = '';
      showToast('Signed out successfully', 'success');
    } catch (err) {
      console.error('Logout error:', err);
      showToast('Logout failed', 'error');
    }
  });

  // Save profile
  els.btnSaveProfile.addEventListener('click', async () => {
    if (!currentUser) {
      showToast('Please sign in first', 'warning');
      return;
    }

    const shopName = els.inputShopName.value.trim();
    const address = els.inputAddress.value.trim();

    try {
      showLoading();
      await upsertProfile(currentUser.id, shopName, address);
      showToast('Profile saved!', 'success');
    } catch (err) {
      console.error('Save profile error:', err);
      showToast('Failed to save profile', 'error');
    } finally {
      hideLoading();
    }
  });

  // Click header avatar -> go to account tab
  els.headerAvatar.addEventListener('click', () => {
    els.tabBtns.forEach((b) => b.classList.remove('active'));
    $('#tab-btn-account').classList.add('active');
    els.tabPanels.forEach((p) => p.classList.remove('active'));
    $('#tab-account').classList.add('active');
  });
}

// ══════════════════════════════════════════════════════════════
// Auth State Management
// ══════════════════════════════════════════════════════════════
async function initAuth() {
  // Listen for auth state changes
  onAuthStateChange(async (user) => {
    currentUser = user;
    updateAccountUI(user);

    if (user) {
      await loadUserData(user);
    }
  });

  // Check for existing session
  try {
    const user = await getUser();
    if (user) {
      currentUser = user;
      updateAccountUI(user);
      await loadUserData(user);
    }
  } catch (err) {
    console.error('Init auth error:', err);
  }
}

// ══════════════════════════════════════════════════════════════
// Initialize App
// ══════════════════════════════════════════════════════════════
function init() {
  initTabs();
  initPersonSection();
  initItemSection();
  initAccountSection();
  initAuth();
}

// Start the app — module scripts are always deferred so DOMContentLoaded fires reliably
document.addEventListener('DOMContentLoaded', init);
