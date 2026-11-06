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
  addTryOn,
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
let selectedPerson = null;
let selectedItems = [];
let tryOnResultUrl = '';
let isRenderingTryOn = false;
let draggedTryItemId = null;
let draggedTrySource = null;

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

  // Try On section
  tryonPersonStrip: $('#tryon-person-strip'),
  tryonItemStrip: $('#tryon-item-strip'),
  tryonPersonStage: $('#tryon-person-stage'),
  tryonSelectedItems: $('#tryon-selected-items'),
  tryonRenderBtn: $('#btn-render-tryon'),
  tryonStatus: $('#tryon-status'),

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
    selectedPerson = null;
    selectedItems = [];
    tryOnResultUrl = '';
    isRenderingTryOn = false;
    renderPersonGallery();
    renderItemGallery();
    renderTryOnSliders();
    renderTryOnStage();
  } catch (err) {
    console.error('Load user data error:', err);
    showToast('Failed to load your data', 'error');
  }
}

function getTryOnPersons() {
  return personImages.length > 0 ? personImages : SAMPLE_PERSONS;
}

function getTryOnItems() {
  return itemImages.length > 0 ? itemImages : SAMPLE_ITEMS;
}

function renderTryOnSliders() {
  const persons = getTryOnPersons();
  const items = getTryOnItems();

  els.tryonPersonStrip.innerHTML = persons
    .map(
      (person) => `
        <button
          class="tryon-thumb ${selectedPerson && selectedPerson.id === person.id ? 'selected' : ''}"
          type="button"
          data-person-id="${person.id}"
          aria-label="Select person"
        >
          <img src="${person.image_url}" alt="Person preview" loading="lazy" />
        </button>
      `
    )
    .join('');

  els.tryonItemStrip.innerHTML = items
    .map(
      (item) => `
        <button
          class="tryon-item-card"
          type="button"
          data-item-id="${item.id}"
          draggable="true"
          aria-label="Add item"
        >
          <img src="${item.image_url}" alt="Item preview" loading="lazy" />
        </button>
      `
    )
    .join('');

  els.tryonPersonStrip.querySelectorAll('.tryon-thumb').forEach((btn) => {
    btn.addEventListener('click', () => {
      const person = persons.find((img) => String(img.id) === String(btn.dataset.personId));
      if (!person) return;
      selectedPerson = person;
      tryOnResultUrl = '';
      renderTryOnStage();
      renderTryOnSliders();
    });
  });

  els.tryonItemStrip.querySelectorAll('.tryon-item-card').forEach((card) => {
    card.addEventListener('click', () => {
      const item = items.find((img) => String(img.id) === String(card.dataset.itemId));
      if (!item) return;
      addItemToSelection(item);
    });

    card.addEventListener('dragstart', (event) => {
      draggedTryItemId = card.dataset.itemId;
      draggedTrySource = 'bottom';
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/plain', card.dataset.itemId);
    });

    card.addEventListener('dragend', () => {
      draggedTryItemId = null;
      draggedTrySource = null;
    });
  });
}

function renderTryOnStage() {
  if (selectedPerson) {
    const personResultUrl = tryOnResultUrl || selectedPerson.image_url;
    els.tryonPersonStage.classList.remove('empty-stage');
    els.tryonPersonStage.innerHTML = `
      <img src="${personResultUrl}" alt="Selected person" />
      ${isRenderingTryOn ? '<div class="tryon-rendering"><span class="spinner small"></span></div>' : ''}
    `;
  } else {
    els.tryonPersonStage.classList.add('empty-stage');
    els.tryonPersonStage.innerHTML = `
      <span class="material-icons-round">person</span>
      <p>Select a person</p>
    `;
  }

  if (selectedItems.length === 0) {
    els.tryonSelectedItems.classList.add('empty-stage');
    els.tryonSelectedItems.innerHTML = `
      <span class="material-icons-round">checkroom</span>
      <p>Drag items here</p>
    `;
  } else {
    els.tryonSelectedItems.classList.remove('empty-stage');
    els.tryonSelectedItems.innerHTML = selectedItems
      .map(
        (item) => `
          <div class="tryon-selected-item" draggable="true" data-item-id="${item.id}">
            <img src="${item.image_url}" alt="Selected item" />
            <button type="button" class="tryon-remove-item" data-item-id="${item.id}" aria-label="Remove item">
              <span class="material-icons-round">close</span>
            </button>
          </div>
        `
      )
      .join('');

    els.tryonSelectedItems.querySelectorAll('.tryon-remove-item').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        removeItemFromSelection(button.dataset.itemId);
      });
    });

    els.tryonSelectedItems.querySelectorAll('.tryon-selected-item').forEach((tile) => {
      tile.addEventListener('dragstart', (event) => {
        draggedTryItemId = tile.dataset.itemId;
        draggedTrySource = 'selected';
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', tile.dataset.itemId);
      });

      tile.addEventListener('dragend', () => {
        draggedTryItemId = null;
        draggedTrySource = null;
      });
    });
  }

  const canRender = Boolean(selectedPerson) && selectedItems.length > 0 && !isRenderingTryOn;
  els.tryonRenderBtn.disabled = !canRender;
  els.tryonRenderBtn.classList.toggle('disabled', !canRender);
  els.tryonRenderBtn.innerHTML = `
    <span class="material-icons-round">${isRenderingTryOn ? 'hourglass_top' : 'auto_awesome'}</span>
    <span>${isRenderingTryOn ? 'Rendering...' : 'Render'}</span>
  `;

  if (!selectedPerson || selectedItems.length === 0) {
    els.tryonStatus.textContent = 'Choose a person and at least one item';
    return;
  }

  if (isRenderingTryOn) {
    els.tryonStatus.textContent = 'Creating your try-on preview...';
    return;
  }

  els.tryonStatus.textContent = `${selectedItems.length} item${selectedItems.length > 1 ? 's' : ''} ready to render`;
}

function addItemToSelection(item) {
  if (!item) return;
  const exists = selectedItems.some((selectedItem) => String(selectedItem.id) === String(item.id));
  if (exists) return;

  selectedItems.push(item);
  tryOnResultUrl = '';
  renderTryOnStage();
  renderTryOnSliders();
}

function removeItemFromSelection(itemId) {
  selectedItems = selectedItems.filter((item) => String(item.id) !== String(itemId));
  tryOnResultUrl = '';
  renderTryOnStage();
  renderTryOnSliders();
}

function bindTryOnDropZones() {
  const addToSelectionFromDrop = (event) => {
    event.preventDefault();
    const itemId = event.dataTransfer.getData('text/plain') || draggedTryItemId;
    if (!itemId) return;

    const list = [...getTryOnItems()];
    const draggedItem = list.find((item) => String(item.id) === String(itemId));

    if (draggedItem) {
      if (draggedTrySource === 'selected') {
        removeItemFromSelection(itemId);
      } else {
        addItemToSelection(draggedItem);
      }
    }

    draggedTryItemId = null;
    draggedTrySource = null;
  };

  els.tryonSelectedItems.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  els.tryonSelectedItems.addEventListener('drop', addToSelectionFromDrop);

  els.tryonItemStrip.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  els.tryonItemStrip.addEventListener('drop', (event) => {
    event.preventDefault();
    if (draggedTrySource !== 'selected') return;
    const itemId = event.dataTransfer.getData('text/plain') || draggedTryItemId;
    if (itemId) removeItemFromSelection(itemId);
    draggedTryItemId = null;
    draggedTrySource = null;
  });
}

async function renderTryOnWithGemini() {
  if (!selectedPerson || selectedItems.length === 0) {
    showToast('Choose a person and at least one item before rendering', 'warning');
    return;
  }

  isRenderingTryOn = true;
  tryOnResultUrl = '';
  renderTryOnStage();

  const prompt = `Create a realistic virtual try-on result. Use the person from the reference image as the base. Dress them with these clothing and accessory items: ${selectedItems.map((item) => item.id || 'item').join(', ')}. Keep the outfit natural, fit the body shape, preserve the person's face and pose, maintain consistent lighting, and output a polished product-shot style result.`;

  try {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    if (!apiKey) {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      tryOnResultUrl = selectedPerson.image_url;
      showToast('Gemini API key not configured. Demo preview loaded instead.', 'info');
    } else {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [{
                text: prompt,
              }],
            }],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to render via Gemini');
      }

      const payload = await response.json();
      const imagePart = payload?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data);
      if (imagePart?.inlineData?.data) {
        tryOnResultUrl = `data:image/png;base64,${imagePart.inlineData.data}`;
      } else {
        tryOnResultUrl = selectedPerson.image_url;
      }

      if (currentUser) {
        await addTryOn(currentUser.id, {
          person_image_id: selectedPerson.id,
          person_image_url: selectedPerson.image_url,
          item_ids: selectedItems.map((item) => item.id),
          item_images: selectedItems.map((item) => ({ id: item.id, image_url: item.image_url })),
          result_image_url: tryOnResultUrl,
        });
      }
    }

    showToast('Try-on preview ready', 'success');
  } catch (err) {
    console.error('Try-on render error:', err);
    tryOnResultUrl = selectedPerson.image_url;
    showToast('Render failed. Using the original preview instead.', 'error');
  } finally {
    isRenderingTryOn = false;
    renderTryOnStage();
  }
}

function initTryOnSection() {
  renderTryOnSliders();
  renderTryOnStage();
  bindTryOnDropZones();

  els.tryonRenderBtn.addEventListener('click', () => {
    renderTryOnWithGemini();
  });
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
      selectedPerson = null;
      selectedItems = [];
      tryOnResultUrl = '';
      isRenderingTryOn = false;
      updateAccountUI(null);
      renderPersonGallery();
      renderItemGallery();
      renderTryOnSliders();
      renderTryOnStage();
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
  initTryOnSection();
  initAccountSection();
  initAuth();
}

// Start the app — module scripts are always deferred so DOMContentLoaded fires reliably
document.addEventListener('DOMContentLoaded', init);
