/**
 * Treasure Trail — Main Application
 *
 * A local-only GPS treasure hunt Progressive Web App.
 * All hunt data, progress, and settings are stored in
 * the browser's localStorage — never uploaded anywhere.
 *
 * @see README.md for full documentation.
 */

(function () {
	'use strict';

	// === Service Worker Registration ===

	if ('serviceWorker' in navigator) {
		window.addEventListener('load', function () {
			navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function (registration) {
				console.log('Service Worker registered with scope:', registration.scope);
			}).catch(function (error) {
				console.error('Service Worker registration failed:', error);
			});
		});
	}

	// === Storage Keys ===

	var HUNTS_KEY = 'treasureTrail.hunts';
	var ACTIVE_HUNT_KEY = 'treasureTrail.activeHuntId';
	var PROGRESS_KEY_PREFIX = 'treasureTrail.progress.';
	var SETTINGS_KEY = 'treasureTrail.settings';

	// === In-Memory Fallback (if localStorage unavailable) ===

	var memoryStore = {};
	var storageAvailable = true;

	function storageTest() {
		try {
			var testKey = '__treasureTrail_test__';
			localStorage.setItem(testKey, '1');
			localStorage.removeItem(testKey);
			return true;
		} catch (e) {
			return false;
		}
	}

	storageAvailable = storageTest();
	if (!storageAvailable) {
		console.warn('Treasure Trail: localStorage is not available. Data will not persist across sessions. Using in-memory fallback.');
	}

	function storageGet(key, defaultValue) {
		defaultValue = (defaultValue === undefined) ? null : defaultValue;
		if (!storageAvailable) {
			return memoryStore.hasOwnProperty(key) ? memoryStore[key] : defaultValue;
		}
		try {
			var raw = localStorage.getItem(key);
			if (raw === null) {
				return defaultValue;
			}
			return JSON.parse(raw);
		} catch (e) {
			console.error('Treasure Trail: Failed to parse stored data for key "' + key + '".', e);
			return defaultValue;
		}
	}

	function storageSet(key, value) {
		if (!storageAvailable) {
			memoryStore[key] = value;
			return true;
		}
		try {
			localStorage.setItem(key, JSON.stringify(value));
			return true;
		} catch (e) {
			console.error('Treasure Trail: Failed to save data for key "' + key + '". Storage may be full.', e);
			return false;
		}
	}

	function storageRemove(key) {
		if (!storageAvailable) {
			delete memoryStore[key];
			return;
		}
		try {
			localStorage.removeItem(key);
		} catch (e) {
			console.error('Treasure Trail: Failed to remove key "' + key + '".', e);
		}
	}

	// === ID Generation ===

	function generateId() {
		return 'tt-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
	}

	// === Validation ===

	function isValidLat(lat) {
		return typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90;
	}

	function isValidLng(lng) {
		return typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180;
	}

	function isValidCoords(lat, lng) {
		return isValidLat(lat) && isValidLng(lng);
	}

	function validateTreasure(treasure) {
		var errors = [];
		if (!treasure.title || typeof treasure.title !== 'string' || treasure.title.trim() === '') {
			errors.push('Treasure title is required.');
		}
		if (!isValidCoords(treasure.lat, treasure.lng)) {
			errors.push('Treasure must have valid latitude (-90 to 90) and longitude (-180 to 180).');
		}
		return errors;
	}

	function validateHunt(hunt) {
		var errors = [];
		if (!hunt.title || typeof hunt.title !== 'string' || hunt.title.trim() === '') {
			errors.push('Hunt title is required.');
		}
		if (!hunt.treasures || !Array.isArray(hunt.treasures)) {
			errors.push('Hunt must have a treasures array.');
		} else {
			hunt.treasures.forEach(function (t, i) {
				var tErrors = validateTreasure(t);
				tErrors.forEach(function (err) {
					errors.push('Treasure #' + (i + 1) + ': ' + err);
				});
			});
		}
		if (hunt.mode && hunt.mode !== 'anyOrder' && hunt.mode !== 'orderedTrail') {
			errors.push('Hunt mode must be "anyOrder" or "orderedTrail".');
		}
		return errors;
	}

	// === Default Settings ===

	var DEFAULT_SETTINGS = {
		soundEnabled: false,
		vibrationEnabled: true,
		strictAccuracy: false,
		maxAccuracyMeters: 50,
		units: 'meters',
		builderPinEnabled: false,
		builderPin: '',
		theme: 'adventure'
	};

	// === TreasureApp Namespace ===

	window.TreasureApp = {

		// -- Hunts --

		hunts: {
			/**
			 * Load all hunts from storage.
			 * @returns {Array} Array of hunt objects.
			 */
			load: function () {
				return storageGet(HUNTS_KEY, []);
			},

			/**
			 * Save all hunts to storage.
			 * @param {Array} hunts - Array of hunt objects.
			 */
			save: function (hunts) {
				return storageSet(HUNTS_KEY, hunts);
			},

			/**
			 * Get a single hunt by ID.
			 * @param {string} huntId
			 * @returns {Object|null}
			 */
			get: function (huntId) {
				var hunts = this.load();
				for (var i = 0; i < hunts.length; i++) {
					if (hunts[i].id === huntId) {
						return hunts[i];
					}
				}
				return null;
			},

			/**
			 * Add or update a hunt (by ID).
			 * @param {Object} hunt
			 * @returns {boolean}
			 */
			upsert: function (hunt) {
				var hunts = this.load();
				var found = false;
				for (var i = 0; i < hunts.length; i++) {
					if (hunts[i].id === hunt.id) {
						hunts[i] = hunt;
						found = true;
						break;
					}
				}
				if (!found) {
					hunts.push(hunt);
				}
				return this.save(hunts);
			},

			/**
			 * Delete a hunt by ID. Also cleans up progress and active hunt.
			 * @param {string} huntId
			 */
			delete: function (huntId) {
				var hunts = this.load();
				hunts = hunts.filter(function (h) {
					return h.id !== huntId;
				});
				this.save(hunts);
				storageRemove(PROGRESS_KEY_PREFIX + huntId);
				if (TreasureApp.activeHunt.get() === huntId) {
					TreasureApp.activeHunt.clear();
				}
			},

			/**
			 * Create a new hunt object with defaults.
			 * @returns {Object}
			 */
			create: function () {
				var now = new Date().toISOString();
				return {
					version: 1,
					id: generateId(),
					title: '',
					description: '',
					mode: 'anyOrder',
					showExactMarkers: true,
					defaultRadiusMeters: 25,
					finalReward: '',
					createdAt: now,
					updatedAt: now,
					treasures: []
				};
			}
		},

		// -- Active Hunt --

		activeHunt: {
			/**
			 * Get the currently active hunt ID.
			 * @returns {string|null}
			 */
			get: function () {
				return storageGet(ACTIVE_HUNT_KEY, null);
			},

			/**
			 * Set the active hunt ID.
			 * @param {string} huntId
			 */
			set: function (huntId) {
				storageSet(ACTIVE_HUNT_KEY, huntId);
			},

			/**
			 * Clear the active hunt.
			 */
			clear: function () {
				storageRemove(ACTIVE_HUNT_KEY);
			}
		},

		// -- Progress --

		progress: {
			/**
			 * Load progress for a specific hunt.
			 * @param {string} huntId
			 * @returns {Object}
			 */
			load: function (huntId) {
				var key = PROGRESS_KEY_PREFIX + huntId;
				var defaults = {
					huntId: huntId,
					foundTreasureIds: [],
					startedAt: null,
					completedAt: null,
					lastKnownPosition: {
						lat: null,
						lng: null,
						accuracy: null,
						timestamp: null
					}
				};
				var stored = storageGet(key, {});
				// Merge stored keys with defaults
				var result = {};
				var k;
				for (k in defaults) {
					if (defaults.hasOwnProperty(k)) {
						result[k] = stored.hasOwnProperty(k) ? stored[k] : defaults[k];
					}
				}
				return result;
			},

			/**
			 * Save progress for a specific hunt.
			 * @param {string} huntId
			 * @param {Object} progress
			 */
			save: function (huntId, progress) {
				var key = PROGRESS_KEY_PREFIX + huntId;
				return storageSet(key, progress);
			},

			/**
			 * Delete progress for a hunt.
			 * @param {string} huntId
			 */
			delete: function (huntId) {
				storageRemove(PROGRESS_KEY_PREFIX + huntId);
			}
		},

		// -- Settings --

		settings: {
			/**
			 * Load settings, merging with defaults.
			 * @returns {Object}
			 */
			load: function () {
				var stored = storageGet(SETTINGS_KEY, {});
				var merged = {};
				var k;
				for (k in DEFAULT_SETTINGS) {
					if (DEFAULT_SETTINGS.hasOwnProperty(k)) {
						merged[k] = stored.hasOwnProperty(k) ? stored[k] : DEFAULT_SETTINGS[k];
					}
				}
				return merged;
			},

			/**
			 * Save settings.
			 * @param {Object} settings
			 */
			save: function (settings) {
				return storageSet(SETTINGS_KEY, settings);
			}
		},

		// -- Utilities --

		/**
		 * Generate a unique ID.
		 * @returns {string}
		 */
		generateId: generateId,

		/**
		 * Validate a hunt object, returning array of error strings.
		 * @param {Object} hunt
		 * @returns {Array}
		 */
		validateHunt: validateHunt,

		/**
		 * Validate a single treasure object.
		 * @param {Object} treasure
		 * @returns {Array}
		 */
		validateTreasure: validateTreasure,

		/**
		 * Check if coordinates are valid.
		 * @param {number} lat
		 * @param {number} lng
		 * @returns {boolean}
		 */
		isValidCoords: isValidCoords,

		/**
		 * Check if localStorage is available.
		 * @returns {boolean}
		 */
		isStorageAvailable: function () {
			return storageAvailable;
		},

		/**
		 * Reset all stored data (for debugging).
		 */
		resetAll: function () {
			var keysToRemove = [];
			var i;
			try {
				if (storageAvailable) {
					for (i = 0; i < localStorage.length; i++) {
						var key = localStorage.key(i);
						if (key.indexOf('treasureTrail.') === 0) {
							keysToRemove.push(key);
						}
					}
				}
			} catch (e) {}
			if (storageAvailable) {
				for (i = 0; i < keysToRemove.length; i++) {
					try {
						localStorage.removeItem(keysToRemove[i]);
					} catch (e) {}
				}
			}
			memoryStore = {};
		},

		// === Haversine Distance ===

		/**
		 * Calculate distance between two points in meters using the Haversine formula.
		 * @param {number} lat1
		 * @param {number} lng1
		 * @param {number} lat2
		 * @param {number} lng2
		 * @returns {number} Distance in meters.
		 */
		distanceMeters: function (lat1, lng1, lat2, lng2) {
			var R = 6371000; // Earth radius in meters
			var dLat = (lat2 - lat1) * Math.PI / 180;
			var dLng = (lng2 - lng1) * Math.PI / 180;
			var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
				Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
				Math.sin(dLng / 2) * Math.sin(dLng / 2);
			var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
			return R * c;
		},

		/**
		 * Convert meters to display string based on settings.
		 * @param {number} meters
		 * @param {string} units - 'meters' or 'feet'
		 * @returns {string}
		 */
		formatDistance: function (meters, units) {
			if (units === 'feet') {
				var feet = meters * 3.28084;
				if (feet < 10) {
					return Math.round(feet) + ' ft';
				}
				return Math.round(feet) + ' ft';
			}
			if (meters < 10) {
				return Math.round(meters) + ' m';
			}
			if (meters >= 1000) {
				return (meters / 1000).toFixed(1) + ' km';
			}
			return Math.round(meters) + ' m';
		}
	};

	console.log('Treasure Trail loaded. Storage available:', storageAvailable);

	// === View Manager ===

	var currentView = 'home';

	/**
	 * Show a specific view and hide all others.
	 * @param {string} viewName - The view ID suffix (e.g., 'home', 'builder', 'player')
	 */
	window.TreasureApp.showView = function (viewName) {
		var views = document.querySelectorAll('.view');
		for (var i = 0; i < views.length; i++) {
			views[i].classList.remove('active');
		}
		var target = document.getElementById('view-' + viewName);
		if (target) {
			target.classList.add('active');
			// Cleanup previous view
			if (currentView === 'player' && viewName !== 'player') {
				stopGPSWatch();
				destroyPlayerMap();
			}
			currentView = viewName;
			// View-specific lifecycle
			if (viewName === 'home') {
				refreshHomeView();
				hideBuilderMap();
			}
			if (viewName === 'builder') {
				showBuilderMap();
				renderBuilder();
			}
			if (viewName !== 'builder') {
				hideBuilderMap();
			}
			if (viewName === 'settings') {
				renderSettingsView();
			}
			if (viewName === 'debug') {
				renderDebugView();
			}
		}
	};

	/**
	 * Get the current view name.
	 * @returns {string}
	 */
	window.TreasureApp.getCurrentView = function () {
		return currentView;
	};

	// === Back Button Handling ===

	document.addEventListener('click', function (e) {
		var backBtn = e.target.closest('[data-view]');
		if (backBtn) {
			var targetView = backBtn.getAttribute('data-view');
			if (targetView) {
				window.TreasureApp.showView(targetView);
			}
		}
	});

	// === Home Screen ===

	/**
	 * Update GPS status indicator.
	 */
	function updateGPSIndicator() {
		var el = document.getElementById('gps-status');
		if (!el) return;

		if (!navigator.geolocation) {
			el.textContent = '🛰️ GPS: Not supported on this device.';
			el.style.color = 'var(--danger)';
			return;
		}

		if (navigator.permissions && navigator.permissions.query) {
			navigator.permissions.query({ name: 'geolocation' }).then(function (result) {
				if (result.state === 'granted') {
					el.textContent = '🛰️ GPS: Ready ✓';
					el.style.color = 'var(--accent)';
				} else if (result.state === 'denied') {
					el.textContent = '🛰️ GPS: Permission denied ✗';
					el.style.color = 'var(--danger)';
				} else {
					el.textContent = '🛰️ GPS: Permission needed';
					el.style.color = 'var(--gold)';
				}
				result.addEventListener('change', function () {
					updateGPSIndicator();
				});
			}).catch(function () {
				el.textContent = '🛰️ GPS: Status unknown (check browser settings)';
				el.style.color = 'var(--muted)';
			});
		} else {
			el.textContent = '🛰️ GPS: Supported — will prompt when needed';
			el.style.color = 'var(--accent)';
		}
	}

	/**
	 * Refresh the home view — update button states based on data.
	 */
	function refreshHomeView() {
		var activeHuntId = window.TreasureApp.activeHunt.get();
		var startBtn = document.getElementById('btn-start-hunt');
		if (startBtn) {
			if (activeHuntId) {
				var hunt = window.TreasureApp.hunts.get(activeHuntId);
				if (hunt && hunt.treasures && hunt.treasures.length > 0) {
					startBtn.disabled = false;
					startBtn.textContent = '▶ Start Hunt: ' + hunt.title;
				} else {
					startBtn.disabled = true;
					startBtn.textContent = '▶ Start Hunt (no treasures)';
				}
			} else {
				startBtn.disabled = true;
				startBtn.textContent = '▶ Start Hunt (no active hunt)';
			}
		}
		updateGPSIndicator();
	}

	// === Home Screen Button Wiring ===

	document.getElementById('btn-start-hunt').addEventListener('click', function () {
		var activeHuntId = window.TreasureApp.activeHunt.get();
		if (activeHuntId) {
			startPlayerHunt();
		}
	});

	document.getElementById('btn-build-hunt').addEventListener('click', function () {
		window.TreasureApp.showView('builder');
		renderBuilder();
	});

	document.getElementById('btn-load-sample').addEventListener('click', function () {
		loadSampleHunt();
	});

	document.getElementById('btn-import-hunt').addEventListener('click', function () {
		triggerImportHunt();
	});

	document.getElementById('btn-privacy').addEventListener('click', function () {
		window.TreasureApp.showView('settings');
		// Phase 09 will implement settings content
	});

	// === Initialization ===

	updateGPSIndicator();
	refreshHomeView();

	// ====================================================================
	// BUILDER VIEW (Phase 05)
	// ====================================================================

	var builderState = {
		editingHuntId: null,
		editingTreasureId: null,
		pinVerified: false
	};

	/**
	 * Main builder render — determines which sub-view to show.
	 */
	function renderBuilder() {
		var container = document.getElementById('builder-content');
		if (!container) return;

		// Check builder PIN
		var settings = window.TreasureApp.settings.load();
		if (settings.builderPinEnabled && settings.builderPin && !builderState.pinVerified) {
			renderPinPrompt(container);
			return;
		}

		if (builderState.editingHuntId) {
			renderTreasureList(container);
		} else if (builderState.editingTreasureId) {
			// Editing a treasure within a hunt
			renderTreasureForm(container);
		} else {
			renderHuntList(container);
		}
	}

	/**
	 * Render the PIN prompt.
	 */
	function renderPinPrompt(container) {
		var settings = window.TreasureApp.settings.load();
		container.innerHTML = '<div class="card">' +
			'<h3>🔐 Builder PIN Required</h3>' +
			'<p style="color:var(--muted);margin:0.75rem 0;">Enter the builder PIN to access hunt editing.</p>' +
			'<div class="form-group">' +
			'<input type="password" id="builder-pin-input" placeholder="Enter PIN" maxlength="20">' +
			'</div>' +
			'<div id="pin-error" class="alert alert-error" style="display:none;"></div>' +
			'<button class="btn btn-primary" id="btn-pin-submit">Unlock</button>' +
			'<button class="btn btn-outline" id="btn-pin-cancel" style="margin-top:0.5rem;">Back to Home</button>' +
			'<p style="font-size:0.75rem;color:var(--danger);margin-top:1rem;">⚠️ The builder PIN is stored as plain text and is not secure. It provides only a lightweight guard against accidental edits.</p>' +
			'</div>';

		document.getElementById('btn-pin-submit').addEventListener('click', function () {
			var input = document.getElementById('builder-pin-input');
			var errEl = document.getElementById('pin-error');
			if (input.value === settings.builderPin) {
				builderState.pinVerified = true;
				renderBuilder();
			} else {
				errEl.textContent = 'Incorrect PIN.';
				errEl.style.display = 'block';
			}
		});

		document.getElementById('btn-pin-cancel').addEventListener('click', function () {
			window.TreasureApp.showView('home');
		});
	}

	/**
	 * Render the hunt list — shows all existing hunts and a "Create New" button.
	 */
	function renderHuntList(container) {
		var hunts = window.TreasureApp.hunts.load();

		var html = '<button class="btn btn-primary btn-large" id="btn-create-hunt">➕ Create New Hunt</button>';

		if (hunts.length === 0) {
			html += '<p class="placeholder-text">No hunts yet. Create your first treasure hunt!</p>';
		} else {
			html += '<div style="margin-top:1rem;">';
			for (var i = 0; i < hunts.length; i++) {
				var h = hunts[i];
				var treasureCount = h.treasures ? h.treasures.length : 0;
				var isActive = window.TreasureApp.activeHunt.get() === h.id;
				html += '<div class="card">' +
					'<div class="card-header">' +
					'<div>' +
					'<div class="card-title">' + escapeHtml(h.title || 'Untitled Hunt') + '</div>' +
					'<div class="card-subtitle">' + treasureCount + ' treasure(s) · Mode: ' + (h.mode === 'orderedTrail' ? 'Ordered' : 'Any Order') + '</div>' +
					'</div>' +
					'<div class="card-actions">' +
					(isActive ? '<span style="color:var(--accent);font-size:0.8rem;">Active</span> ' : '') +
					'<button class="btn btn-small btn-outline btn-edit-hunt" data-id="' + h.id + '">✏️</button>' +
					'<button class="btn btn-small btn-outline btn-activate-hunt" data-id="' + h.id + '" title="Set as active hunt">▶</button>' +
					'<button class="btn btn-small btn-danger btn-delete-hunt" data-id="' + h.id + '">🗑</button>' +
					'</div>' +
					'</div>' +
					'<button class="btn btn-small btn-outline btn-open-treasures" data-id="' + h.id + '" style="margin-top:0.5rem;">📋 Edit Treasures</button>' +
					'</div>';
			}
			html += '</div>';
		}

		html += '<div style="margin-top:1.5rem;">' +
			'<button class="btn btn-outline" id="btn-builder-settings">⚙️ Builder Settings</button>' +
			'</div>';

		container.innerHTML = html;

		// Event: Create New Hunt
		document.getElementById('btn-create-hunt').addEventListener('click', function () {
			var newHunt = window.TreasureApp.hunts.create();
			builderState.editingHuntId = newHunt.id;
			window.TreasureApp.hunts.upsert(newHunt);
			renderHuntForm(container);
		});

		// Event: Edit Hunt
		bindElements('.btn-edit-hunt', 'click', function (e) {
			var huntId = e.target.getAttribute('data-id');
			builderState.editingHuntId = huntId;
			renderHuntForm(container);
		});

		// Event: Set Active Hunt
		bindElements('.btn-activate-hunt', 'click', function (e) {
			var huntId = e.target.getAttribute('data-id');
			window.TreasureApp.activeHunt.set(huntId);
			renderHuntList(container);
		});

		// Event: Delete Hunt
		bindElements('.btn-delete-hunt', 'click', function (e) {
			var huntId = e.target.getAttribute('data-id');
			if (confirm('Delete this hunt and all its treasures? This cannot be undone.')) {
				window.TreasureApp.hunts.delete(huntId);
				renderHuntList(container);
			}
		});

		// Event: Open Treasures
		bindElements('.btn-open-treasures', 'click', function (e) {
			var huntId = e.target.getAttribute('data-id');
			builderState.editingHuntId = huntId;
			renderTreasureList(container);
		});

		// Event: Builder Settings
		var btnSettings = document.getElementById('btn-builder-settings');
		if (btnSettings) {
			btnSettings.addEventListener('click', function () {
				renderBuilderSettings(container);
			});
		}
	}

	/**
	 * Render the hunt create/edit form.
	 */
	function renderHuntForm(container) {
		var hunt = window.TreasureApp.hunts.get(builderState.editingHuntId);
		if (!hunt) {
			builderState.editingHuntId = null;
			renderHuntList(container);
			return;
		}

		var isNew = !hunt.title;
		var html = '<h3>' + (isNew ? 'Create New Hunt' : 'Edit Hunt') + '</h3>' +
			'<div class="form-group">' +
			'<label for="hunt-title">Title *</label>' +
			'<input type="text" id="hunt-title" value="' + escapeAttr(hunt.title) + '" placeholder="e.g., Saturday Park Adventure" maxlength="100">' +
			'</div>' +
			'<div class="form-group">' +
			'<label for="hunt-desc">Description</label>' +
			'<textarea id="hunt-desc" placeholder="Describe the adventure...">' + escapeHtml(hunt.description || '') + '</textarea>' +
			'</div>' +
			'<div class="form-group">' +
			'<label for="hunt-mode">Hunt Mode</label>' +
			'<select id="hunt-mode">' +
			'<option value="anyOrder"' + (hunt.mode === 'anyOrder' ? ' selected' : '') + '>Any Order — treasures can be found in any sequence</option>' +
			'<option value="orderedTrail"' + (hunt.mode === 'orderedTrail' ? ' selected' : '') + '>Ordered Trail — must find treasures in order</option>' +
			'</select>' +
			'</div>' +
			'<div class="toggle-group">' +
			'<label><input type="checkbox" id="hunt-show-markers"' + (hunt.showExactMarkers ? ' checked' : '') + '> Show exact treasure markers on player map</label>' +
			'</div>' +
			'<div class="form-group">' +
			'<label for="hunt-radius">Default Unlock Radius (meters)</label>' +
			'<input type="number" id="hunt-radius" value="' + (hunt.defaultRadiusMeters || 25) + '" min="1" max="1000" step="1">' +
			'</div>' +
			'<div class="form-group">' +
			'<label for="hunt-reward">Final Reward Text</label>' +
			'<textarea id="hunt-reward" placeholder="e.g., You unlocked You-Pick Dinner Night! 🍕">' + escapeHtml(hunt.finalReward || '') + '</textarea>' +
			'</div>' +
			'<div class="alert alert-warning" style="font-size:0.8rem;">⚠️ This hunt is stored only on this device. Export it if you want to back it up or share it.</div>' +
			'<div style="display:flex;gap:0.75rem;flex-wrap:wrap;">' +
			'<button class="btn btn-primary" id="btn-save-hunt">💾 Save Hunt</button>' +
			'<button class="btn btn-outline" id="btn-cancel-hunt">Cancel</button>' +
			'</div>';

		container.innerHTML = html;

		document.getElementById('btn-save-hunt').addEventListener('click', function () {
			hunt.title = document.getElementById('hunt-title').value.trim();
			hunt.description = document.getElementById('hunt-desc').value.trim();
			hunt.mode = document.getElementById('hunt-mode').value;
			hunt.showExactMarkers = document.getElementById('hunt-show-markers').checked;
			hunt.defaultRadiusMeters = parseInt(document.getElementById('hunt-radius').value, 10) || 25;
			hunt.finalReward = document.getElementById('hunt-reward').value.trim();
			hunt.updatedAt = new Date().toISOString();

			var errors = window.TreasureApp.validateHunt(hunt);
			if (errors.length > 0) {
				alert('Please fix the following errors:\n\n' + errors.join('\n'));
				return;
			}

			window.TreasureApp.hunts.upsert(hunt);
			builderState.editingHuntId = null;
			renderHuntList(container);
		});

		document.getElementById('btn-cancel-hunt').addEventListener('click', function () {
			// If new hunt with no title, delete it
			if (!hunt.title && hunt.treasures.length === 0) {
				window.TreasureApp.hunts.delete(hunt.id);
			}
			builderState.editingHuntId = null;
			renderHuntList(container);
		});
	}

	/**
	 * Render the treasure list for the current hunt.
	 */
	function renderTreasureList(container) {
		var hunt = window.TreasureApp.hunts.get(builderState.editingHuntId);
		if (!hunt) {
			builderState.editingHuntId = null;
			renderHuntList(container);
			return;
		}

		var treasures = hunt.treasures || [];
		var html = '<div class="view-header" style="border-bottom:none;padding:0;margin-bottom:0.75rem;">' +
			'<button class="btn btn-back" id="btn-back-to-hunts">← Hunts</button>' +
			'<h3 style="flex:1;">' + escapeHtml(hunt.title) + '</h3>' +
			'</div>' +
			'<button class="btn btn-primary btn-large" id="btn-add-treasure" style="margin-bottom:1rem;">📍 Add Treasure</button>';

		if (treasures.length === 0) {
			html += '<p class="placeholder-text">No treasures yet. Add your first hidden treasure!</p>';
		} else {
			html += '<ul class="treasure-list">';
			for (var i = 0; i < treasures.length; i++) {
				var t = treasures[i];
				html += '<li class="treasure-item">' +
					'<div class="treasure-item-header">' +
					'<div class="treasure-item-title">' +
					'<span class="treasure-icon">' + (t.icon || '📍') + '</span>' +
					'<span>' + escapeHtml(t.title || 'Untitled Treasure') + '</span>' +
					'</div>' +
					'<div class="card-actions">' +
					(i > 0 ? '<button class="btn btn-small btn-outline btn-move-up" data-idx="' + i + '">↑</button>' : '') +
					(i < treasures.length - 1 ? '<button class="btn btn-small btn-outline btn-move-down" data-idx="' + i + '">↓</button>' : '') +
					'<button class="btn btn-small btn-outline btn-edit-treasure" data-id="' + t.id + '">✏️</button>' +
					'<button class="btn btn-small btn-outline btn-dup-treasure" data-id="' + t.id + '">📋</button>' +
					'<button class="btn btn-small btn-danger btn-del-treasure" data-id="' + t.id + '">🗑</button>' +
					'</div>' +
					'</div>' +
					'<div class="treasure-coords">' + t.lat.toFixed(6) + ', ' + t.lng.toFixed(6) + ' · Radius: ' + (t.radiusMeters || hunt.defaultRadiusMeters || 25) + 'm</div>' +
					'</li>';
			}
			html += '</ul>';
		}

		html += '<div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1rem;">' +
			'<button class="btn btn-outline" id="btn-edit-hunt-details">⚙️ Edit Hunt Details</button>' +
			'<button class="btn btn-danger btn-small" id="btn-reset-progress">🔄 Reset Progress</button>' +
			'</div>';

		container.innerHTML = html;

		// Render map markers in builder map
		showBuilderMap();
		setTimeout(function () {
			renderBuilderMapMarkers(hunt, function (treasureId) {
				builderState.editingTreasureId = treasureId;
				renderTreasureForm(container);
			});
			setupBuilderMapClick(function (latlng) {
				builderState.editingTreasureId = null;
				renderTreasureForm(container);
				setTimeout(function () {
					var latEl = document.getElementById('treasure-lat');
					var lngEl = document.getElementById('treasure-lng');
					if (latEl && lngEl) {
						latEl.value = parseFloat(latlng.lat.toFixed(6));
						lngEl.value = parseFloat(latlng.lng.toFixed(6));
					}
				}, 200);
			});
		}, 200);

		// Back to hunts
		document.getElementById('btn-back-to-hunts').addEventListener('click', function () {
			builderState.editingHuntId = null;
			renderHuntList(container);
		});

		// Add treasure
		document.getElementById('btn-add-treasure').addEventListener('click', function () {
			builderState.editingTreasureId = null; // null = new
			renderTreasureForm(container);
		});

		// Edit treasure
		bindElements('.btn-edit-treasure', 'click', function (e) {
			builderState.editingTreasureId = e.target.getAttribute('data-id');
			renderTreasureForm(container);
		});

		// Duplicate treasure
		bindElements('.btn-dup-treasure', 'click', function (e) {
			var tId = e.target.getAttribute('data-id');
			var treasure = findTreasureById(hunt, tId);
			if (treasure) {
				var dup = JSON.parse(JSON.stringify(treasure));
				dup.id = generateId();
				dup.title = (dup.title || 'Treasure') + ' (copy)';
				hunt.treasures.push(dup);
				hunt.updatedAt = new Date().toISOString();
				window.TreasureApp.hunts.upsert(hunt);
				renderTreasureList(container);
			}
		});

		// Delete treasure
		bindElements('.btn-del-treasure', 'click', function (e) {
			var tId = e.target.getAttribute('data-id');
			if (confirm('Delete this treasure?')) {
				hunt.treasures = hunt.treasures.filter(function (t) { return t.id !== tId; });
				hunt.updatedAt = new Date().toISOString();
				window.TreasureApp.hunts.upsert(hunt);
				renderTreasureList(container);
			}
		});

		// Move up
		bindElements('.btn-move-up', 'click', function (e) {
			var idx = parseInt(e.target.getAttribute('data-idx'), 10);
			if (idx > 0) {
				var tmp = hunt.treasures[idx];
				hunt.treasures[idx] = hunt.treasures[idx - 1];
				hunt.treasures[idx - 1] = tmp;
				hunt.updatedAt = new Date().toISOString();
				window.TreasureApp.hunts.upsert(hunt);
				renderTreasureList(container);
			}
		});

		// Move down
		bindElements('.btn-move-down', 'click', function (e) {
			var idx = parseInt(e.target.getAttribute('data-idx'), 10);
			if (idx < hunt.treasures.length - 1) {
				var tmp = hunt.treasures[idx];
				hunt.treasures[idx] = hunt.treasures[idx + 1];
				hunt.treasures[idx + 1] = tmp;
				hunt.updatedAt = new Date().toISOString();
				window.TreasureApp.hunts.upsert(hunt);
				renderTreasureList(container);
			}
		});

		// Edit hunt details
		document.getElementById('btn-edit-hunt-details').addEventListener('click', function () {
			renderHuntForm(container);
		});

		// Reset progress
		document.getElementById('btn-reset-progress').addEventListener('click', function () {
			if (confirm('Reset all progress for this hunt? Found treasures will be unfound.')) {
				window.TreasureApp.progress.delete(hunt.id);
				alert('Progress reset.');
			}
		});
	}

	/**
	 * Render the treasure add/edit form.
	 */
	function renderTreasureForm(container) {
		var hunt = window.TreasureApp.hunts.get(builderState.editingHuntId);
		if (!hunt) return;

		var treasure = null;
		var isNew = true;
		if (builderState.editingTreasureId) {
			treasure = findTreasureById(hunt, builderState.editingTreasureId);
			isNew = !treasure;
		}

		if (!treasure) {
			treasure = {
				id: generateId(),
				title: '',
				icon: '📍',
				lat: 0,
				lng: 0,
				radiusMeters: hunt.defaultRadiusMeters || 25,
				clue: '',
				hint: '',
				foundMessage: '',
				rewardText: '',
				privateNotes: ''
			};
		}

		var html = '<h3>' + (isNew ? 'Add Treasure' : 'Edit Treasure') + '</h3>' +
			'<div class="form-group">' +
			'<label for="treasure-title">Title *</label>' +
			'<input type="text" id="treasure-title" value="' + escapeAttr(treasure.title) + '" placeholder="e.g., The Big Tree" maxlength="100">' +
			'</div>' +
			'<div class="form-group">' +
			'<label for="treasure-icon">Icon (emoji)</label>' +
			'<input type="text" id="treasure-icon" value="' + escapeAttr(treasure.icon || '📍') + '" placeholder="📍" maxlength="10">' +
			'</div>' +
			'<p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem;">📍 Click on the map to set the treasure location, or enter coordinates below.</p>' +
			'<div id="treasure-form-map" class="map-container" style="height:250px;margin-bottom:0.75rem;"></div>' +
			'<button class="btn btn-outline btn-small" id="btn-use-my-location-form" style="margin-bottom:0.75rem;">📍 Use My Current Location</button>' +
			'<div class="form-row">' +
			'<div class="form-group">' +
			'<label for="treasure-lat">Latitude *</label>' +
			'<input type="number" id="treasure-lat" value="' + treasure.lat + '" step="any" placeholder="42.123456">' +
			'</div>' +
			'<div class="form-group">' +
			'<label for="treasure-lng">Longitude *</label>' +
			'<input type="number" id="treasure-lng" value="' + treasure.lng + '" step="any" placeholder="-83.123456">' +
			'</div>' +
			'</div>' +
			'<div class="form-group">' +
			'<label for="treasure-radius">Unlock Radius (meters)</label>' +
			'<input type="number" id="treasure-radius" value="' + (treasure.radiusMeters || hunt.defaultRadiusMeters || 25) + '" min="1" max="10000" step="1">' +
			'</div>' +
			'<div class="form-group">' +
			'<label for="treasure-clue">Clue</label>' +
			'<textarea id="treasure-clue" placeholder="Clue shown to the player...">' + escapeHtml(treasure.clue || '') + '</textarea>' +
			'</div>' +
			'<div class="form-group">' +
			'<label for="treasure-hint">Hint (revealed on request)</label>' +
			'<textarea id="treasure-hint" placeholder="Additional hint...">' + escapeHtml(treasure.hint || '') + '</textarea>' +
			'</div>' +
			'<div class="form-group">' +
			'<label for="treasure-found-msg">Found Message</label>' +
			'<input type="text" id="treasure-found-msg" value="' + escapeAttr(treasure.foundMessage || '') + '" placeholder="You found it! 🎉">' +
			'</div>' +
			'<div class="form-group">' +
			'<label for="treasure-reward">Reward Text</label>' +
			'<input type="text" id="treasure-reward" value="' + escapeAttr(treasure.rewardText || '') + '" placeholder="e.g., Golden Coin collected!">' +
			'</div>' +
			'<div class="form-group">' +
			'<label for="treasure-notes">Private Notes (only visible in builder)</label>' +
			'<textarea id="treasure-notes" placeholder="Notes for yourself...">' + escapeHtml(treasure.privateNotes || '') + '</textarea>' +
			'</div>' +
			'<div style="display:flex;gap:0.75rem;flex-wrap:wrap;">' +
			'<button class="btn btn-primary" id="btn-save-treasure">💾 Save Treasure</button>' +
			'<button class="btn btn-outline" id="btn-cancel-treasure">Cancel</button>' +
			'</div>';

		container.innerHTML = html;

		// Initialize mini-map for treasure form
		var treasureMap = null;
		var treasureMarker = null;
		var treasureCircle = null;

		function initTreasureFormMap(lat, lng) {
			var mapDiv = document.getElementById('treasure-form-map');
			if (!mapDiv || typeof L === 'undefined') return;
			if (treasureMap) {
				treasureMap.remove();
			}
			treasureMap = L.map('treasure-form-map', {
				center: [lat, lng],
				zoom: 15,
				zoomControl: true
			});
			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				attribution: '&copy; OSM',
				maxZoom: 19
			}).addTo(treasureMap);

			// Existing marker
			updateTreasureFormMarker(lat, lng);

			// Click to place
			treasureMap.on('click', function (e) {
				var newLat = parseFloat(e.latlng.lat.toFixed(6));
				var newLng = parseFloat(e.latlng.lng.toFixed(6));
				document.getElementById('treasure-lat').value = newLat;
				document.getElementById('treasure-lng').value = newLng;
				updateTreasureFormMarker(newLat, newLng);
			});

			setTimeout(function () { treasureMap.invalidateSize(); }, 200);
		}

		function updateTreasureFormMarker(lat, lng) {
			if (treasureMarker) treasureMap.removeLayer(treasureMarker);
			if (treasureCircle) treasureMap.removeLayer(treasureCircle);
			var radius = parseInt(document.getElementById('treasure-radius').value, 10) || 25;
			treasureMarker = L.marker([lat, lng], { draggable: true }).addTo(treasureMap);
			treasureMarker.on('dragend', function (ev) {
				var ll = ev.target.getLatLng();
				document.getElementById('treasure-lat').value = parseFloat(ll.lat.toFixed(6));
				document.getElementById('treasure-lng').value = parseFloat(ll.lng.toFixed(6));
				if (treasureCircle) {
					treasureCircle.setLatLng(ll);
				}
			});
			treasureCircle = L.circle([lat, lng], {
				radius: radius,
				color: '#f4c542',
				fillColor: '#f4c542',
				fillOpacity: 0.15,
				weight: 1
			}).addTo(treasureMap);
		}

		// Initialize map after a short delay to ensure DOM is ready
		setTimeout(function () {
			initTreasureFormMap(treasure.lat, treasure.lng);
		}, 150);

		// Update circle when radius changes
		document.getElementById('treasure-radius').addEventListener('input', function () {
			var lat = parseFloat(document.getElementById('treasure-lat').value) || 0;
			var lng = parseFloat(document.getElementById('treasure-lng').value) || 0;
			if (treasureCircle && treasureMap) {
				treasureCircle.setRadius(parseInt(this.value, 10) || 25);
			}
		});

		// Use My Location button
		document.getElementById('btn-use-my-location-form').addEventListener('click', function () {
			if (!navigator.geolocation) {
				alert('Geolocation is not supported on this device.');
				return;
			}
			navigator.geolocation.getCurrentPosition(function (pos) {
				var lat = parseFloat(pos.coords.latitude.toFixed(6));
				var lng = parseFloat(pos.coords.longitude.toFixed(6));
				document.getElementById('treasure-lat').value = lat;
				document.getElementById('treasure-lng').value = lng;
				if (treasureMap) {
					treasureMap.setView([lat, lng], 17);
					updateTreasureFormMarker(lat, lng);
				}
				alert('Location captured! Accuracy: ' + Math.round(pos.coords.accuracy) + 'm');
			}, function (err) {
				alert('Could not get location: ' + err.message);
			}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
		});

		// Save
		document.getElementById('btn-save-treasure').addEventListener('click', function () {
			var t = {
				id: treasure.id,
				title: document.getElementById('treasure-title').value.trim(),
				icon: document.getElementById('treasure-icon').value.trim() || '📍',
				lat: parseFloat(document.getElementById('treasure-lat').value),
				lng: parseFloat(document.getElementById('treasure-lng').value),
				radiusMeters: parseInt(document.getElementById('treasure-radius').value, 10) || hunt.defaultRadiusMeters || 25,
				clue: document.getElementById('treasure-clue').value.trim(),
				hint: document.getElementById('treasure-hint').value.trim(),
				foundMessage: document.getElementById('treasure-found-msg').value.trim(),
				rewardText: document.getElementById('treasure-reward').value.trim(),
				privateNotes: document.getElementById('treasure-notes').value.trim()
			};

			var errors = window.TreasureApp.validateTreasure(t);
			if (errors.length > 0) {
				alert('Please fix the following errors:\n\n' + errors.join('\n'));
				return;
			}

			if (isNew) {
				hunt.treasures.push(t);
			} else {
				for (var i = 0; i < hunt.treasures.length; i++) {
					if (hunt.treasures[i].id === t.id) {
						hunt.treasures[i] = t;
						break;
					}
				}
			}

			hunt.updatedAt = new Date().toISOString();
			window.TreasureApp.hunts.upsert(hunt);
			builderState.editingTreasureId = null;
			renderTreasureList(container);
		});

		// Cancel
		document.getElementById('btn-cancel-treasure').addEventListener('click', function () {
			builderState.editingTreasureId = null;
			renderTreasureList(container);
		});
	}

	/**
	 * Render builder settings (PIN, etc.).
	 */
	function renderBuilderSettings(container) {
		var settings = window.TreasureApp.settings.load();
		var html = '<h3>⚙️ Builder Settings</h3>' +
			'<div class="toggle-group">' +
			'<label><input type="checkbox" id="builder-pin-enabled"' + (settings.builderPinEnabled ? ' checked' : '') + '> Enable Builder PIN</label>' +
			'</div>' +
			'<div class="form-group" id="builder-pin-group" style="' + (settings.builderPinEnabled ? '' : 'display:none;') + '">' +
			'<label for="builder-pin">PIN (numbers only, max 20 digits)</label>' +
			'<input type="text" id="builder-pin" value="' + escapeAttr(settings.builderPin || '') + '" maxlength="20" inputmode="numeric" pattern="[0-9]*">' +
			'</div>' +
			'<p style="font-size:0.75rem;color:var(--danger);margin-bottom:1rem;">⚠️ The PIN is stored as plain text in localStorage. It provides a lightweight guard, not real security.</p>' +
			'<div style="display:flex;gap:0.75rem;flex-wrap:wrap;">' +
			'<button class="btn btn-primary" id="btn-save-builder-settings">💾 Save</button>' +
			'<button class="btn btn-outline" id="btn-cancel-builder-settings">Back</button>' +
			'</div>';

		container.innerHTML = html;

		document.getElementById('builder-pin-enabled').addEventListener('change', function () {
			document.getElementById('builder-pin-group').style.display = this.checked ? '' : 'none';
		});

		document.getElementById('btn-save-builder-settings').addEventListener('click', function () {
			settings.builderPinEnabled = document.getElementById('builder-pin-enabled').checked;
			settings.builderPin = document.getElementById('builder-pin').value.trim();
			window.TreasureApp.settings.save(settings);
			builderState.pinVerified = false;
			alert('Builder settings saved.');
			renderHuntList(container);
		});

		document.getElementById('btn-cancel-builder-settings').addEventListener('click', function () {
			renderHuntList(container);
		});
	}

	// === Builder Helpers ===

	function findTreasureById(hunt, treasureId) {
		if (!hunt || !hunt.treasures) return null;
		for (var i = 0; i < hunt.treasures.length; i++) {
			if (hunt.treasures[i].id === treasureId) {
				return hunt.treasures[i];
			}
		}
		return null;
	}

	function bindElements(selector, event, handler) {
		var els = document.querySelectorAll(selector);
		for (var i = 0; i < els.length; i++) {
			els[i].addEventListener(event, handler);
		}
	}

	function escapeHtml(str) {
		if (!str) return '';
		return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function escapeAttr(str) {
		if (!str) return '';
		return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	// ====================================================================
	// MAP INTEGRATION (Phase 06)
	// ====================================================================

	var builderMap = null;
	var builderMarkers = [];
	var builderCircles = [];
	var pendingMapClickLatLng = null;

	/**
	 * Initialize or return the builder map instance.
	 */
	function getBuilderMap() {
		if (builderMap) {
			// Invalidate size in case container changed
			setTimeout(function () { builderMap.invalidateSize(); }, 100);
			return builderMap;
		}
		var mapEl = document.getElementById('builder-map');
		if (!mapEl) return null;
		if (typeof L === 'undefined') {
			mapEl.innerHTML = '<p style="color:var(--danger);padding:1rem;text-align:center;">⚠️ Map library failed to load. Check your network connection.</p>';
			return null;
		}
		builderMap = L.map('builder-map', {
			center: [0, 0],
			zoom: 2,
			zoomControl: true
		});
		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
			maxZoom: 19
		}).addTo(builderMap);
		return builderMap;
	}

	/**
	 * Clear all markers and circles from the builder map.
	 */
	function clearBuilderMap() {
		for (var i = 0; i < builderMarkers.length; i++) {
			if (builderMap) builderMap.removeLayer(builderMarkers[i]);
		}
		for (var j = 0; j < builderCircles.length; j++) {
			if (builderMap) builderMap.removeLayer(builderCircles[j]);
		}
		builderMarkers = [];
		builderCircles = [];
	}

	/**
	 * Add treasure markers to the builder map.
	 * @param {Object} hunt
	 * @param {Function} onMarkerClick - Called with treasure ID when marker clicked.
	 */
	function renderBuilderMapMarkers(hunt, onMarkerClick) {
		var map = getBuilderMap();
		if (!map) return;
		clearBuilderMap();

		if (!hunt || !hunt.treasures || hunt.treasures.length === 0) return;

		var bounds = L.latLngBounds([]);
		for (var i = 0; i < hunt.treasures.length; i++) {
			var t = hunt.treasures[i];
			if (!isValidCoords(t.lat, t.lng)) continue;
			var latlng = L.latLng(t.lat, t.lng);
			bounds.extend(latlng);

			// Marker
			var marker = L.marker(latlng, {
				draggable: true,
				title: t.title
			}).addTo(map);

			// Popup
			var popupHtml = '<strong>' + escapeHtml(t.icon || '📍') + ' ' + escapeHtml(t.title || 'Treasure') + '</strong><br>' +
				'<small>' + t.lat.toFixed(6) + ', ' + t.lng.toFixed(6) + '</small><br>' +
				'<button class="btn-map-edit" data-tid="' + t.id + '" style="font-size:0.8rem;">✏️ Edit</button> ';
			marker.bindPopup(popupHtml);

			marker.on('popupopen', function () {
				// Bind popup buttons after it opens
				setTimeout(function () {
					var popupBtns = document.querySelectorAll('.btn-map-edit');
					for (var b = 0; b < popupBtns.length; b++) {
						popupBtns[b].addEventListener('click', function (ev) {
							var tid = ev.target.getAttribute('data-tid');
							if (onMarkerClick) onMarkerClick(tid);
							map.closePopup();
						});
					}
				}, 50);
			});

			// Drag end — confirm update
			marker.on('dragend', function (ev) {
				var newLatLng = ev.target.getLatLng();
				var tid = ev.target.getTitle ? null : null;
				// Find treasure by position
				var updated = false;
				for (var k = 0; k < hunt.treasures.length; k++) {
					if (hunt.treasures[k].lat === t.lat && hunt.treasures[k].lng === t.lng && hunt.treasures[k].id === t.id) {
						hunt.treasures[k].lat = parseFloat(newLatLng.lat.toFixed(6));
						hunt.treasures[k].lng = parseFloat(newLatLng.lng.toFixed(6));
						updated = true;
						break;
					}
				}
				if (updated) {
					hunt.updatedAt = new Date().toISOString();
					window.TreasureApp.hunts.upsert(hunt);
				}
				renderBuilderMapMarkers(hunt, onMarkerClick);
			});

			builderMarkers.push(marker);

			// Radius circle
			var radius = t.radiusMeters || hunt.defaultRadiusMeters || 25;
			var circle = L.circle(latlng, {
				radius: radius,
				color: '#f4c542',
				fillColor: '#f4c542',
				fillOpacity: 0.15,
				weight: 1
			}).addTo(map);
			builderCircles.push(circle);
		}

		if (bounds.isValid()) {
			map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
		}
	}

	/**
	 * Set up map click handler for adding treasures.
	 * @param {Function} onMapClick - Called with {lat, lng}.
	 */
	function setupBuilderMapClick(onMapClick) {
		var map = getBuilderMap();
		if (!map) return;
		map.off('click');
		map.on('click', function (e) {
			if (onMapClick) onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
		});
	}

	/**
	 * Destroy the builder map (when leaving builder view).
	 */
	function destroyBuilderMap() {
		if (builderMap) {
			builderMap.remove();
			builderMap = null;
			builderMarkers = [];
			builderCircles = [];
		}
	}

	/**
	 * Show the builder map container.
	 */
	function showBuilderMap() {
		var mapEl = document.getElementById('builder-map');
		if (mapEl) {
			mapEl.style.display = '';
		}
	}

	/**
	 * Hide the builder map container.
	 */
	function hideBuilderMap() {
		var mapEl = document.getElementById('builder-map');
		if (mapEl) {
			mapEl.style.display = 'none';
		}
	}

	// ====================================================================
	// PLAYER HUNT VIEW (Phase 07)
	// ====================================================================

	var playerState = {
		huntId: null,
		watchId: null,
		currentPosition: null,
		playerMap: null,
		playerMarker: null,
		playerAccuracyCircle: null,
		treasureMarkers: [],
		treasureCircles: [],
		audioUnlocked: false // track if user interacted to allow audio
	};

	/**
	 * Start the player hunt view.
	 */
	function startPlayerHunt() {
		playerState.huntId = window.TreasureApp.activeHunt.get();
		if (!playerState.huntId) {
			alert('No active hunt selected. Go to the Builder and select a hunt first.');
			window.TreasureApp.showView('home');
			return;
		}

		var hunt = window.TreasureApp.hunts.get(playerState.huntId);
		if (!hunt || !hunt.treasures || hunt.treasures.length === 0) {
			alert('The active hunt has no treasures. Add some treasures in the Builder first.');
			window.TreasureApp.showView('home');
			return;
		}

		// Initialize or update progress
		var progress = window.TreasureApp.progress.load(playerState.huntId);
		if (!progress.startedAt) {
			progress.startedAt = new Date().toISOString();
			progress.foundTreasureIds = [];
		}
		window.TreasureApp.progress.save(playerState.huntId, progress);

		window.TreasureApp.showView('player');
		renderPlayerView();
		startGPSWatch();
		initPlayerMap();
	}

	/**
	 * Render the player view content.
	 */
	function renderPlayerView() {
		var container = document.getElementById('player-content');
		var hunt = window.TreasureApp.hunts.get(playerState.huntId);
		var progress = window.TreasureApp.progress.load(playerState.huntId);
		var settings = window.TreasureApp.settings.load();
		if (!container || !hunt) return;

		var foundCount = progress.foundTreasureIds ? progress.foundTreasureIds.length : 0;
		var totalCount = hunt.treasures.length;
		var allFound = foundCount >= totalCount;

		document.getElementById('player-hunt-title').textContent = '⚔️ ' + hunt.title;

		// Target treasure
		var target = getTargetTreasure(hunt, progress);

		var html = '';

		// Progress bar
		html += '<div class="player-stats">' +
			'<div class="player-stat">' +
			'<div class="stat-value">' + foundCount + ' / ' + totalCount + '</div>' +
			'<div class="stat-label">Treasures Found</div>' +
			'</div>' +
			'<div class="player-stat">' +
			'<div class="stat-value" id="player-distance">---</div>' +
			'<div class="stat-label">Distance to Target</div>' +
			'</div>' +
			'</div>';

		// Mode indicator
		html += '<div style="text-align:center;font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem;">' +
			'Mode: ' + (hunt.mode === 'orderedTrail' ? '🔗 Ordered Trail' : '🔀 Any Order') +
			'</div>';

		// Warm/cold indicator
		html += '<div id="warm-cold" class="warm-cold cold">🌍 Waiting for GPS...</div>';

		// Clue
		if (target && !allFound) {
			html += '<div class="clue-box">' +
				'<div class="clue-label">🧩 Clue</div>' +
				'<div class="clue-text" id="player-clue">' + escapeHtml(target.clue || 'Search the area...') + '</div>' +
				'</div>';

			html += '<button class="btn btn-outline btn-small" id="btn-show-hint" style="margin-bottom:0.75rem;">💡 Show Hint</button>';
			html += '<div id="player-hint" style="display:none;color:var(--gold);font-style:italic;margin-bottom:0.75rem;padding:0.5rem;background:var(--panel);border-radius:12px;">' + escapeHtml(target.hint || 'No hint available.') + '</div>';
		}

		if (allFound) {
			html += '<div class="clue-box" style="border-left-color:var(--accent);">' +
				'<div class="clue-label">🎉 All Treasures Found!</div>' +
				'<div class="clue-text">Head back and claim your reward!</div>' +
				'</div>';
			html += '<button class="btn btn-primary btn-large" id="btn-claim-reward">🏆 Claim Final Reward</button>';
		}

		// GPS accuracy
		html += '<div style="text-align:center;font-size:0.75rem;color:var(--muted);margin-top:0.75rem;" id="player-gps-info">🛰️ Waiting for GPS fix...</div>';

		// Action buttons
		html += '<div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1rem;">' +
			'<button class="btn btn-outline btn-small" id="btn-check-location">📍 Check My Location</button>' +
			'<button class="btn btn-outline btn-small" id="btn-recenter-map">🗺️ Recenter Map</button>' +
			'<button class="btn btn-outline btn-small" id="btn-pause-hunt">⏸ Pause Hunt</button>' +
			'<button class="btn btn-danger btn-small" id="btn-end-hunt">⏹ End Hunt</button>' +
			'</div>';

		container.innerHTML = html;

		// Bind events
		document.getElementById('btn-show-hint').addEventListener('click', function () {
			var hintEl = document.getElementById('player-hint');
			if (hintEl) hintEl.style.display = hintEl.style.display === 'none' ? '' : 'none';
		});

		document.getElementById('btn-check-location').addEventListener('click', function () {
			if (playerState.currentPosition) {
				updatePlayerUI(playerState.currentPosition);
				alert('Current accuracy: ' + Math.round(playerState.currentPosition.accuracy) + 'm');
			} else {
				alert('No GPS position available yet.');
			}
		});

		document.getElementById('btn-recenter-map').addEventListener('click', function () {
			if (playerState.playerMap && playerState.currentPosition) {
				playerState.playerMap.setView([playerState.currentPosition.lat, playerState.currentPosition.lng], 17);
			}
		});

		document.getElementById('btn-pause-hunt').addEventListener('click', function () {
			stopGPSWatch();
			alert('Hunt paused. Tap "Check My Location" to resume tracking.');
		});

		document.getElementById('btn-end-hunt').addEventListener('click', function () {
			if (confirm('End this hunt? Your progress is saved.')) {
				stopGPSWatch();
				destroyPlayerMap();
				window.TreasureApp.showView('home');
			}
		});

		document.getElementById('btn-claim-reward').addEventListener('click', function () {
			// Phase 08 will implement full reward screen
			showFinalReward();
		});
	}

	/**
	 * Determine which treasure is the current target.
	 */
	function getTargetTreasure(hunt, progress) {
		if (!hunt || !hunt.treasures) return null;
		var foundIds = progress.foundTreasureIds || [];

		if (hunt.mode === 'orderedTrail') {
			// First unfound in order
			for (var i = 0; i < hunt.treasures.length; i++) {
				if (foundIds.indexOf(hunt.treasures[i].id) === -1) {
					return hunt.treasures[i];
				}
			}
			return null;
		}

		// anyOrder — nearest unfound
		if (!playerState.currentPosition) return hunt.treasures[0]; // fallback
		var nearest = null;
		var nearestDist = Infinity;
		for (var j = 0; j < hunt.treasures.length; j++) {
			if (foundIds.indexOf(hunt.treasures[j].id) !== -1) continue;
			var d = window.TreasureApp.distanceMeters(
				playerState.currentPosition.lat, playerState.currentPosition.lng,
				hunt.treasures[j].lat, hunt.treasures[j].lng
			);
			if (d < nearestDist) {
				nearestDist = d;
				nearest = hunt.treasures[j];
			}
		}
		return nearest;
	}

	/**
	 * Start GPS position watching.
	 */
	function startGPSWatch() {
		if (!navigator.geolocation) {
			alert('Geolocation is not supported on this device.');
			return;
		}

		stopGPSWatch(); // clear any existing

		playerState.watchId = navigator.geolocation.watchPosition(
			function (pos) {
				playerState.currentPosition = {
					lat: pos.coords.latitude,
					lng: pos.coords.longitude,
					accuracy: pos.coords.accuracy,
					timestamp: pos.timestamp
				};
				updatePlayerUI(playerState.currentPosition);
				updatePlayerMap();
				checkUnlock();
			},
			function (err) {
				var msg = 'GPS error. ';
				if (err.code === 1) msg += 'Permission denied. Please enable location access.';
				else if (err.code === 2) msg += 'Position unavailable. Check your GPS signal.';
				else if (err.code === 3) msg += 'Request timed out. Try again.';
				document.getElementById('warm-cold').textContent = '⚠️ ' + msg;
				document.getElementById('warm-cold').className = 'warm-cold cold';
			},
			{
				enableHighAccuracy: true,
				timeout: 30000,
				maximumAge: 5000
			}
		);
	}

	/**
	 * Stop GPS watching.
	 */
	function stopGPSWatch() {
		if (playerState.watchId !== null) {
			navigator.geolocation.clearWatch(playerState.watchId);
			playerState.watchId = null;
		}
	}

	/**
	 * Update the player UI with current position and distances.
	 */
	function updatePlayerUI(position) {
		if (!position) return;
		var hunt = window.TreasureApp.hunts.get(playerState.huntId);
		var progress = window.TreasureApp.progress.load(playerState.huntId);
		var settings = window.TreasureApp.settings.load();
		if (!hunt) return;

		var target = getTargetTreasure(hunt, progress);

		// Update GPS info
		var gpsEl = document.getElementById('player-gps-info');
		if (gpsEl) {
			var acc = position.accuracy ? Math.round(position.accuracy) : '?';
			gpsEl.textContent = '🛰️ Accuracy: ±' + acc + 'm · Last update: ' + new Date(position.timestamp).toLocaleTimeString();
		}

		// Update distance
		if (target) {
			var dist = window.TreasureApp.distanceMeters(position.lat, position.lng, target.lat, target.lng);
			var distEl = document.getElementById('player-distance');
			if (distEl) {
				distEl.textContent = window.TreasureApp.formatDistance(dist, settings.units);
			}

			// Warm/cold
			var wcEl = document.getElementById('warm-cold');
			if (wcEl) {
				var radius = target.radiusMeters || hunt.defaultRadiusMeters || 25;
				if (dist <= radius) {
					wcEl.textContent = '🔥 You\'re right on top of it!';
					wcEl.className = 'warm-cold very-close';
				} else if (dist < 30) {
					wcEl.textContent = '🔥 You\'re very close! (' + Math.round(dist) + 'm)';
					wcEl.className = 'warm-cold very-close';
				} else if (dist < 100) {
					wcEl.textContent = '🌡 Getting warmer... (' + Math.round(dist) + 'm)';
					wcEl.className = 'warm-cold warm';
				} else if (dist < 500) {
					wcEl.textContent = '🧊 Getting colder... (' + Math.round(dist) + 'm)';
					wcEl.className = 'warm-cold cold';
				} else {
					wcEl.textContent = '❄️ Keep searching! (' + Math.round(dist) + 'm away)';
					wcEl.className = 'warm-cold cold';
				}
			}
		}

		// Save last position
		progress.lastKnownPosition = {
			lat: position.lat,
			lng: position.lng,
			accuracy: position.accuracy,
			timestamp: position.timestamp
		};
		window.TreasureApp.progress.save(playerState.huntId, progress);
	}

	/**
	 * Check if player is within unlock radius of any eligible treasure.
	 */
	function checkUnlock() {
		var hunt = window.TreasureApp.hunts.get(playerState.huntId);
		var progress = window.TreasureApp.progress.load(playerState.huntId);
		var settings = window.TreasureApp.settings.load();
		if (!hunt || !playerState.currentPosition) return;

		var pos = playerState.currentPosition;
		var foundIds = progress.foundTreasureIds || [];

		for (var i = 0; i < hunt.treasures.length; i++) {
			var t = hunt.treasures[i];
			if (foundIds.indexOf(t.id) !== -1) continue;

			// For ordered mode, only the next unfound can be unlocked
			if (hunt.mode === 'orderedTrail') {
				for (var j = 0; j < hunt.treasures.length; j++) {
					if (foundIds.indexOf(hunt.treasures[j].id) === -1) {
						if (hunt.treasures[j].id !== t.id) return; // not this one's turn
						break;
					}
				}
			}

			var dist = window.TreasureApp.distanceMeters(pos.lat, pos.lng, t.lat, t.lng);
			var radius = t.radiusMeters || hunt.defaultRadiusMeters || 25;

			if (dist <= radius) {
				// Check strict accuracy
				if (settings.strictAccuracy && pos.accuracy > settings.maxAccuracyMeters) {
					// Don't auto-unlock, but we already updated UI
					continue;
				}
				unlockTreasure(t.id);
				return;
			}
		}
	}

	/**
	 * Unlock a treasure — mark found, save progress, show modal.
	 */
	function unlockTreasure(treasureId) {
		var hunt = window.TreasureApp.hunts.get(playerState.huntId);
		var progress = window.TreasureApp.progress.load(playerState.huntId);
		if (!hunt) return;

		var foundIds = progress.foundTreasureIds || [];
		if (foundIds.indexOf(treasureId) !== -1) return; // already found

		var treasure = findTreasureById(hunt, treasureId);
		if (!treasure) return;

		// Mark found
		foundIds.push(treasureId);
		progress.foundTreasureIds = foundIds;
		window.TreasureApp.progress.save(playerState.huntId, progress);

		// Show treasure-found modal (Phase 08 will enhance)
		showTreasureFoundModal(treasure, hunt);

		// Refresh player view
		setTimeout(function () {
			renderPlayerView();
			updatePlayerMap();
		}, 500);
	}

	/**
	 * Initialize the player map.
	 */
	function initPlayerMap() {
		var mapDiv = document.getElementById('player-map');
		if (!mapDiv || typeof L === 'undefined') return;

		destroyPlayerMap();

		playerState.playerMap = L.map('player-map', {
			center: [0, 0],
			zoom: 2,
			zoomControl: true
		});

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '&copy; OSM',
			maxZoom: 19
		}).addTo(playerState.playerMap);

		setTimeout(function () {
			if (playerState.playerMap) playerState.playerMap.invalidateSize();
		}, 300);

		updatePlayerMap();
	}

	/**
	 * Update player map markers.
	 */
	function updatePlayerMap() {
		var map = playerState.playerMap;
		if (!map) return;

		var hunt = window.TreasureApp.hunts.get(playerState.huntId);
		var progress = window.TreasureApp.progress.load(playerState.huntId);
		if (!hunt) return;

		// Clear old treasure markers
		for (var i = 0; i < playerState.treasureMarkers.length; i++) {
			map.removeLayer(playerState.treasureMarkers[i]);
		}
		for (var j = 0; j < playerState.treasureCircles.length; j++) {
			map.removeLayer(playerState.treasureCircles[j]);
		}
		playerState.treasureMarkers = [];
		playerState.treasureCircles = [];

		var foundIds = progress.foundTreasureIds || [];

		// Show treasure markers if exact markers enabled
		for (var k = 0; k < hunt.treasures.length; k++) {
			var t = hunt.treasures[k];
			if (!isValidCoords(t.lat, t.lng)) continue;
			var isFound = foundIds.indexOf(t.id) !== -1;

			if (hunt.showExactMarkers) {
				var icon = isFound
					? L.divIcon({ className: 'treasure-marker-found', html: '✅', iconSize: [24, 24] })
					: L.divIcon({ className: 'treasure-marker-unfound', html: t.icon || '📍', iconSize: [28, 28], iconAnchor: [14, 14] });

				var marker = L.marker([t.lat, t.lng], { icon: icon }).addTo(map);
				if (!isFound) {
					marker.bindPopup('<strong>' + escapeHtml(t.icon || '') + ' ' + escapeHtml(t.title) + '</strong>');
				}
				playerState.treasureMarkers.push(marker);
			}

			// Show radius circle for unfound
			if (!isFound && !hunt.showExactMarkers) {
				var radius = t.radiusMeters || hunt.defaultRadiusMeters || 25;
				var circle = L.circle([t.lat, t.lng], {
					radius: Math.max(radius, 50), // minimum vague zone
					color: '#f4c542',
					fillColor: '#f4c542',
					fillOpacity: 0.08,
					weight: 1,
					dashArray: '5, 10'
				}).addTo(map);
				circle.bindPopup('🔍 Search zone');
				playerState.treasureCircles.push(circle);
			}
		}

		// Update user location marker
		if (playerState.currentPosition) {
			var pos = playerState.currentPosition;
			if (playerState.playerMarker) {
				playerState.playerMarker.setLatLng([pos.lat, pos.lng]);
			} else {
				var userIcon = L.divIcon({
					className: 'player-marker',
					html: '<div style="width:16px;height:16px;background:#4285F4;border:3px solid white;border-radius:50%;box-shadow:0 0 8px rgba(66,133,244,0.6);"></div>',
					iconSize: [22, 22],
					iconAnchor: [11, 11]
				});
				playerState.playerMarker = L.marker([pos.lat, pos.lng], { icon: userIcon }).addTo(map);
			}

			// Accuracy circle
			if (playerState.playerAccuracyCircle) {
				playerState.playerAccuracyCircle.setLatLng([pos.lat, pos.lng]);
				playerState.playerAccuracyCircle.setRadius(pos.accuracy || 10);
			} else {
				playerState.playerAccuracyCircle = L.circle([pos.lat, pos.lng], {
					radius: pos.accuracy || 10,
					color: '#4285F4',
					fillColor: '#4285F4',
					fillOpacity: 0.1,
					weight: 1
				}).addTo(map);
			}
		}
	}

	/**
	 * Destroy the player map.
	 */
	function destroyPlayerMap() {
		if (playerState.playerMap) {
			playerState.playerMap.remove();
			playerState.playerMap = null;
			playerState.playerMarker = null;
			playerState.playerAccuracyCircle = null;
			playerState.treasureMarkers = [];
			playerState.treasureCircles = [];
		}
	}

	/**
	 * Show treasure found modal.
	 */
	function showTreasureFoundModal(treasure, hunt) {
		window.TreasureApp.showView('treasure-found');
		renderTreasureFoundContent(treasure, hunt);
	}

	/**
	 * Render the treasure-found modal content.
	 */
	function renderTreasureFoundContent(treasure, hunt) {
		var container = document.getElementById('treasure-found-content');
		if (!container) return;

		var foundCount = 0;
		var totalCount = hunt.treasures.length;
		var progress = window.TreasureApp.progress.load(playerState.huntId);
		if (progress && progress.foundTreasureIds) {
			foundCount = progress.foundTreasureIds.length;
		}

		var html = '<div style="font-size:4rem;animation:pulse 0.5s ease-out;">' + (treasure.icon || '🎉') + '</div>' +
			'<h1 style="color:var(--gold);font-size:2rem;margin:0.5rem 0;">Treasure Found!</h1>' +
			'<h2 style="color:var(--text);font-size:1.3rem;margin-bottom:0.75rem;">' + escapeHtml(treasure.title) + '</h2>' +
			(treasure.foundMessage ? '<p style="font-size:1.1rem;color:var(--accent);margin-bottom:0.5rem;">' + escapeHtml(treasure.foundMessage) + '</p>' : '') +
			(treasure.rewardText ? '<p style="font-size:1rem;color:var(--muted);">' + escapeHtml(treasure.rewardText) + '</p>' : '') +
			'<p style="color:var(--muted);margin-top:1rem;">' + foundCount + ' / ' + totalCount + ' treasures found</p>' +
			'<button class="btn btn-primary btn-large" id="btn-continue-hunt" style="margin-top:1.5rem;">▶ Continue Hunting</button>';

		container.innerHTML = html;

		// Trigger effects
		triggerTreasureEffects();

		// Continue button
		document.getElementById('btn-continue-hunt').addEventListener('click', function () {
			// Check if all found
			if (foundCount >= totalCount) {
				showFinalReward();
			} else {
				window.TreasureApp.showView('player');
				renderPlayerView();
				updatePlayerMap();
			}
		});

		// Auto-dismiss after 5 seconds if user doesn't tap
		setTimeout(function () {
			var modal = document.getElementById('view-treasure-found');
			if (modal && modal.classList.contains('active')) {
				if (foundCount >= totalCount) {
					showFinalReward();
				} else {
					window.TreasureApp.showView('player');
					renderPlayerView();
					updatePlayerMap();
				}
			}
		}, 5000);
	}

	/**
	 * Trigger confetti, vibration, and sound effects.
	 */
	function triggerTreasureEffects() {
		var settings = window.TreasureApp.settings.load();

		// Confetti
		spawnConfetti();

		// Vibration
		if (settings.vibrationEnabled && navigator.vibrate) {
			try {
				navigator.vibrate([200, 100, 200, 100, 400]);
			} catch (e) {}
		}

		// Sound
		if (settings.soundEnabled) {
			playTreasureChime();
		}
	}

	/**
	 * CSS confetti animation.
	 */
	function spawnConfetti() {
		var container = document.createElement('div');
		container.className = 'confetti-container';
		document.body.appendChild(container);

		var colors = ['#f4c542', '#51e6a6', '#ff6b6b', '#4285F4', '#cdbf91', '#ff9800', '#e91e63'];
		var count = 60;

		for (var i = 0; i < count; i++) {
			var piece = document.createElement('div');
			piece.className = 'confetti-piece';
			piece.style.left = Math.random() * 100 + '%';
			piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
			piece.style.width = (Math.random() * 8 + 6) + 'px';
			piece.style.height = (Math.random() * 8 + 6) + 'px';
			piece.style.animationDuration = (Math.random() * 2 + 2) + 's';
			piece.style.animationDelay = Math.random() * 0.5 + 's';
			piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
			container.appendChild(piece);
		}

		// Remove after animation
		setTimeout(function () {
			if (container.parentNode) {
				container.parentNode.removeChild(container);
			}
		}, 3500);
	}

	/**
	 * Play a short treasure chime using Web Audio API.
	 */
	function playTreasureChime() {
		try {
			var AudioContext = window.AudioContext || window.webkitAudioContext;
			if (!AudioContext) return;
			var ctx = new AudioContext();
			var notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
			var startTime = ctx.currentTime;
			for (var i = 0; i < notes.length; i++) {
				var osc = ctx.createOscillator();
				var gain = ctx.createGain();
				osc.type = 'sine';
				osc.frequency.value = notes[i];
				gain.gain.setValueAtTime(0.3, startTime + i * 0.15);
				gain.gain.exponentialRampToValueAtTime(0.01, startTime + i * 0.15 + 0.3);
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.start(startTime + i * 0.15);
				osc.stop(startTime + i * 0.15 + 0.3);
			}
		} catch (e) {
			// Web Audio not supported — silent fallback
		}
	}

	/**
	 * Show final reward screen.
	 */
	function showFinalReward() {
		stopGPSWatch();
		var hunt = window.TreasureApp.hunts.get(playerState.huntId);
		var progress = window.TreasureApp.progress.load(playerState.huntId);
		if (!hunt) return;

		progress.completedAt = new Date().toISOString();
		window.TreasureApp.progress.save(playerState.huntId, progress);

		window.TreasureApp.showView('final-reward');
		renderFinalRewardContent(hunt);
	}

	/**
	 * Render the final reward screen content.
	 */
	function renderFinalRewardContent(hunt) {
		var container = document.getElementById('final-reward-content');
		if (!container) return;

		var html = '<div style="font-size:4rem;animation:bounceIn 0.6s ease-out;">🏆</div>' +
			'<h1 style="color:var(--gold);font-size:2rem;margin:0.5rem 0;">Congratulations!</h1>' +
			'<p style="color:var(--text);font-size:1.2rem;margin-bottom:0.5rem;">You found all the treasures in</p>' +
			'<h2 style="color:var(--accent);font-size:1.4rem;margin-bottom:1rem;">' + escapeHtml(hunt.title) + '</h2>' +
			(hunt.finalReward ? '<div style="background:var(--panel);border-radius:var(--radius);padding:1.5rem;margin:1rem 0;border:2px solid var(--gold);"><p style="font-size:1.3rem;color:var(--gold);">' + escapeHtml(hunt.finalReward) + '</p></div>' : '') +
			'<div style="display:flex;flex-direction:column;gap:0.75rem;margin-top:1.5rem;">' +
			'<button class="btn btn-primary btn-large" id="btn-play-again">🔄 Play Again</button>' +
			'<button class="btn btn-outline btn-large" id="btn-build-another">🔧 Build Another Hunt</button>' +
			'<button class="btn btn-outline" id="btn-export-results">📤 Export Results</button>' +
			'</div>';

		container.innerHTML = html;

		// Confetti on final reward
		spawnConfetti();
		setTimeout(function () { spawnConfetti(); }, 800);

		// Try vibration
		var settings = window.TreasureApp.settings.load();
		if (settings.vibrationEnabled && navigator.vibrate) {
			try { navigator.vibrate([300, 100, 300, 100, 600]); } catch (e) {}
		}

		document.getElementById('btn-play-again').addEventListener('click', function () {
			// Reset progress
			window.TreasureApp.progress.delete(playerState.huntId);
			playerState = {
				huntId: playerState.huntId,
				watchId: null,
				currentPosition: null,
				playerMap: null,
				playerMarker: null,
				playerAccuracyCircle: null,
				treasureMarkers: [],
				treasureCircles: [],
				audioUnlocked: false
			};
			startPlayerHunt();
		});

		document.getElementById('btn-build-another').addEventListener('click', function () {
			destroyPlayerMap();
			window.TreasureApp.showView('builder');
			renderBuilder();
		});

		document.getElementById('btn-export-results').addEventListener('click', function () {
			// Phase 09 will implement proper export
			alert('Export will be available in the next phase.');
		});
	}

	// Add animations for treasure modal and final reward
	var animationStyles = document.createElement('style');
	animationStyles.textContent =
		'@keyframes pulse {' +
		'  0% { transform: scale(0.5); opacity: 0; }' +
		'  50% { transform: scale(1.2); }' +
		'  100% { transform: scale(1); opacity: 1; }' +
		'}' +
		'@keyframes bounceIn {' +
		'  0% { transform: scale(0); }' +
		'  60% { transform: scale(1.15); }' +
		'  80% { transform: scale(0.95); }' +
		'  100% { transform: scale(1); }' +
		'}' +
		'.treasure-marker-found { font-size:18px; text-align:center; }' +
		'.treasure-marker-unfound { font-size:22px; text-align:center; filter:drop-shadow(0 0 4px rgba(244,197,66,0.6)); }';
	document.head.appendChild(animationStyles);

	// ====================================================================
	// IMPORT / EXPORT (Phase 09)
	// ====================================================================

	/**
	 * Export the active hunt as a downloadable JSON file.
	 */
	function exportActiveHunt() {
		var huntId = window.TreasureApp.activeHunt.get();
		if (!huntId) {
			alert('No active hunt to export.');
			return;
		}

		if (!confirm('⚠️ Exported hunt files may contain private coordinates. Only share them with people you trust. Continue?')) {
			return;
		}

		var hunt = window.TreasureApp.hunts.get(huntId);
		if (!hunt) {
			alert('Hunt not found.');
			return;
		}

		downloadJSON(hunt, hunt.id + '.json');
	}

	/**
	 * Export all hunts as a downloadable JSON file.
	 */
	function exportAllHunts() {
		if (!confirm('⚠️ Exported hunt files may contain private coordinates. Only share them with people you trust. Continue?')) {
			return;
		}

		var hunts = window.TreasureApp.hunts.load();
		if (hunts.length === 0) {
			alert('No hunts to export.');
			return;
		}

		downloadJSON({ hunts: hunts }, 'treasure-trail-all-hunts.json');
	}

	/**
	 * Download data as a JSON file.
	 */
	function downloadJSON(data, filename) {
		var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	/**
	 * Trigger file input for importing a hunt.
	 */
	function triggerImportHunt() {
		var input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json,application/json';
		input.addEventListener('change', function () {
			var file = input.files[0];
			if (!file) return;
			var reader = new FileReader();
			reader.onload = function (e) {
				try {
					var data = JSON.parse(e.target.result);
					importHuntData(data);
				} catch (err) {
					alert('Invalid JSON file. Could not parse.');
				}
			};
			reader.readAsText(file);
		});
		input.click();
	}

	/**
	 * Import hunt data from parsed JSON.
	 */
	function importHuntData(data) {
		// Check if it's an all-hunts export
		var huntsToImport = [];
		if (data.hunts && Array.isArray(data.hunts)) {
			huntsToImport = data.hunts;
		} else if (data.id && data.treasures) {
			huntsToImport = [data];
		} else {
			alert('Invalid hunt data. The file must contain a hunt object or a { "hunts": [...] } wrapper.');
			return;
		}

		if (huntsToImport.length === 0) {
			alert('No hunts found in the file.');
			return;
		}

		var imported = 0;
		var skipped = 0;
		var errors = [];

		for (var i = 0; i < huntsToImport.length; i++) {
			var hunt = huntsToImport[i];
			var huntErrors = window.TreasureApp.validateHunt(hunt);
			if (huntErrors.length > 0) {
				errors.push('Hunt "' + (hunt.title || 'Untitled') + '": ' + huntErrors.join('; '));
				skipped++;
				continue;
			}

			// Check for duplicate ID
			var existing = window.TreasureApp.hunts.get(hunt.id);
			if (existing) {
				var action = confirm('A hunt with ID "' + hunt.id + '" ("' + hunt.title + '") already exists.\n\nClick OK to replace it, or Cancel to skip import.');
				if (!action) {
					skipped++;
					continue;
				}
			}

			// Ensure required fields
			if (!hunt.version) hunt.version = 1;
			if (!hunt.createdAt) hunt.createdAt = new Date().toISOString();
			hunt.updatedAt = new Date().toISOString();
			if (!hunt.mode) hunt.mode = 'anyOrder';
			if (!hunt.defaultRadiusMeters) hunt.defaultRadiusMeters = 25;
			if (hunt.showExactMarkers === undefined) hunt.showExactMarkers = true;

			// Ensure all treasures have IDs
			for (var j = 0; j < hunt.treasures.length; j++) {
				if (!hunt.treasures[j].id) {
					hunt.treasures[j].id = generateId();
				}
				if (!hunt.treasures[j].radiusMeters) {
					hunt.treasures[j].radiusMeters = hunt.defaultRadiusMeters || 25;
				}
			}

			window.TreasureApp.hunts.upsert(hunt);
			imported++;
		}

		var msg = 'Import complete!\n\n✅ Imported: ' + imported + ' hunt(s)';
		if (skipped > 0) msg += '\n⏭ Skipped: ' + skipped;
		if (errors.length > 0) msg += '\n⚠️ Errors:\n' + errors.join('\n');
		alert(msg);

		// Refresh home view
		refreshHomeView();
	}

	/**
	 * Load the sample hunt from data/sample-hunt.json.
	 */
	function loadSampleHunt() {
		if (!confirm('Load the sample hunt? This will import a sample hunt with FAKE coordinates for demonstration.')) {
			return;
		}

		fetch('./data/sample-hunt.json')
			.then(function (response) {
				if (!response.ok) throw new Error('Failed to load sample hunt.');
				return response.json();
			})
			.then(function (data) {
				importHuntData(data);
				// Set as active
				if (data.id) {
					window.TreasureApp.activeHunt.set(data.id);
				}
				refreshHomeView();
			})
			.catch(function (err) {
				alert('Could not load sample hunt: ' + err.message);
			});
	}

	// ====================================================================
	// SETTINGS / PRIVACY VIEW (Phase 09)
	// ====================================================================

	function renderSettingsView() {
		var container = document.getElementById('settings-content');
		var settings = window.TreasureApp.settings.load();
		var hunts = window.TreasureApp.hunts.load();
		var activeId = window.TreasureApp.activeHunt.get();
		var activeHunt = activeId ? window.TreasureApp.hunts.get(activeId) : null;

		var html = '';

		// Privacy explanation
		html += '<div class="card" style="margin-bottom:1.5rem;">' +
			'<h3 style="color:var(--gold);margin-bottom:0.5rem;">🔒 Privacy & Storage</h3>' +
			'<p style="font-size:0.9rem;color:var(--text);line-height:1.6;">' +
			'Treasure Trail is <strong>local-only</strong> by default.</p>' +
			'<p style="font-size:0.85rem;color:var(--muted);margin-top:0.5rem;line-height:1.6;">' +
			'The public website contains only the app code. Your real hunt locations and progress are saved in this browser on this device.</p>' +
			'<p style="font-size:0.85rem;color:var(--muted);margin-top:0.5rem;line-height:1.6;">' +
			'The app does not upload your locations to GitHub, a database, or a backend server.</p>' +
			'<p style="font-size:0.85rem;color:var(--muted);margin-top:0.5rem;line-height:1.6;">' +
			'Map tiles may be loaded from OpenStreetMap. Your browser may contact the map provider to display the map.</p>' +
			'<p style="font-size:0.85rem;color:var(--muted);margin-top:0.5rem;line-height:1.6;">' +
			'If you export a hunt file, that file may contain private coordinates. Do not commit exported hunt files to a public repository unless you want those locations to be public.</p>' +
			'</div>';

		// Storage status
		html += '<div class="card" style="margin-bottom:1.5rem;">' +
			'<h3 style="color:var(--gold);margin-bottom:0.5rem;">💾 Storage Status</h3>' +
			'<p style="font-size:0.9rem;">Hunts saved: <strong>' + hunts.length + '</strong></p>' +
			'<p style="font-size:0.9rem;">Active hunt: <strong>' + (activeHunt ? escapeHtml(activeHunt.title) : 'None') + '</strong></p>' +
			'<p style="font-size:0.9rem;">Storage available: <strong>' + (window.TreasureApp.isStorageAvailable() ? '✅ Yes' : '❌ No (in-memory only)') + '</strong></p>' +
			'</div>';

		// Settings toggles
		html += '<div class="card" style="margin-bottom:1.5rem;">' +
			'<h3 style="color:var(--gold);margin-bottom:0.75rem;">⚙️ Settings</h3>' +

			'<div class="toggle-group">' +
			'<label><input type="checkbox" id="set-sound"' + (settings.soundEnabled ? ' checked' : '') + '> Enable Sound</label>' +
			'</div>' +

			'<div class="toggle-group">' +
			'<label><input type="checkbox" id="set-vibration"' + (settings.vibrationEnabled ? ' checked' : '') + '> Enable Vibration</label>' +
			'</div>' +

			'<div class="toggle-group">' +
			'<label><input type="checkbox" id="set-strict-acc"' + (settings.strictAccuracy ? ' checked' : '') + '> Strict Accuracy (block auto-unlock if GPS is poor)</label>' +
			'</div>' +

			'<div class="form-group">' +
			'<label for="set-max-acc">Max Accuracy Threshold (meters)</label>' +
			'<input type="number" id="set-max-acc" value="' + settings.maxAccuracyMeters + '" min="5" max="500" step="5">' +
			'</div>' +

			'<div class="form-group">' +
			'<label for="set-units">Distance Units</label>' +
			'<select id="set-units">' +
			'<option value="meters"' + (settings.units === 'meters' ? ' selected' : '') + '>Meters</option>' +
			'<option value="feet"' + (settings.units === 'feet' ? ' selected' : '') + '>Feet</option>' +
			'</select>' +
			'</div>' +

			'<div class="toggle-group">' +
			'<label><input type="checkbox" id="set-builder-pin-enabled"' + (settings.builderPinEnabled ? ' checked' : '') + '> Enable Builder PIN</label>' +
			'</div>' +

			'<div class="form-group" id="set-builder-pin-group" style="' + (settings.builderPinEnabled ? '' : 'display:none;') + '">' +
			'<label for="set-builder-pin">Builder PIN</label>' +
			'<input type="text" id="set-builder-pin" value="' + escapeAttr(settings.builderPin || '') + '" maxlength="20" inputmode="numeric" pattern="[0-9]*">' +
			'</div>' +

			'<button class="btn btn-primary" id="btn-save-settings" style="margin-top:0.75rem;">💾 Save Settings</button>' +
			'</div>';

		// Danger zone
		html += '<div class="card" style="border-color:var(--danger);">' +
			'<h3 style="color:var(--danger);margin-bottom:0.5rem;">⚠️ Danger Zone</h3>' +
			'<div style="display:flex;gap:0.75rem;flex-wrap:wrap;">' +
			'<button class="btn btn-outline btn-small" id="btn-export-all">📤 Export All Hunts</button>' +
			'<button class="btn btn-danger btn-small" id="btn-clear-data">🗑 Clear All Local Data</button>' +
			'</div>' +
			'<button class="btn btn-link btn-small" id="btn-open-debug" style="margin-top:0.75rem;opacity:0.5;">🐛 Debug Panel</button>' +
			'</div>';

		container.innerHTML = html;

		// Event: PIN toggle
		document.getElementById('set-builder-pin-enabled').addEventListener('change', function () {
			document.getElementById('set-builder-pin-group').style.display = this.checked ? '' : 'none';
		});

		// Event: Save settings
		document.getElementById('btn-save-settings').addEventListener('click', function () {
			settings.soundEnabled = document.getElementById('set-sound').checked;
			settings.vibrationEnabled = document.getElementById('set-vibration').checked;
			settings.strictAccuracy = document.getElementById('set-strict-acc').checked;
			settings.maxAccuracyMeters = parseInt(document.getElementById('set-max-acc').value, 10) || 50;
			settings.units = document.getElementById('set-units').value;
			settings.builderPinEnabled = document.getElementById('set-builder-pin-enabled').checked;
			settings.builderPin = document.getElementById('set-builder-pin').value.trim();
			window.TreasureApp.settings.save(settings);
			builderState.pinVerified = false;
			alert('Settings saved!');
		});

		// Event: Export all
		document.getElementById('btn-export-all').addEventListener('click', function () {
			exportAllHunts();
		});

		// Event: Clear data
		document.getElementById('btn-clear-data').addEventListener('click', function () {
			if (confirm('⚠️ This will permanently delete ALL hunts, progress, and settings from this device. This cannot be undone. Are you sure?')) {
				if (confirm('FINAL WARNING: All local data will be erased. Continue?')) {
					window.TreasureApp.resetAll();
					alert('All local data cleared.');
					window.TreasureApp.showView('home');
				}
			}
		});

		// Event: Open debug
		document.getElementById('btn-open-debug').addEventListener('click', function () {
			window.TreasureApp.showView('debug');
		});
	}

	// ====================================================================
	// DEBUG PANEL (Phase 09)
	// ====================================================================

	function renderDebugView() {
		var container = document.getElementById('debug-content');
		var huntId = window.TreasureApp.activeHunt.get();
		var hunt = huntId ? window.TreasureApp.hunts.get(huntId) : null;
		var progress = huntId ? window.TreasureApp.progress.load(huntId) : null;
		var settings = window.TreasureApp.settings.load();

		var pos = playerState.currentPosition;

		var html = '<h3>🐛 Developer Debug Panel</h3>' +
			'<p style="font-size:0.75rem;color:var(--danger);margin-bottom:1rem;">Developer testing only. Real gameplay uses phone GPS.</p>';

		// GPS Info
		html += '<div class="card">' +
			'<h4>📍 GPS State</h4>' +
			'<pre style="font-size:0.8rem;color:var(--muted);white-space:pre-wrap;">' +
			'Latitude: ' + (pos ? pos.lat.toFixed(6) : 'N/A') + '\n' +
			'Longitude: ' + (pos ? pos.lng.toFixed(6) : 'N/A') + '\n' +
			'Accuracy: ' + (pos ? Math.round(pos.accuracy) + 'm' : 'N/A') + '\n' +
			'Last Update: ' + (pos ? new Date(pos.timestamp).toLocaleTimeString() : 'N/A') +
			'</pre>' +
			'</div>';

		// Hunt Info
		if (hunt) {
			html += '<div class="card">' +
				'<h4>🎯 Active Hunt: ' + escapeHtml(hunt.title) + '</h4>' +
				'<pre style="font-size:0.8rem;color:var(--muted);white-space:pre-wrap;">' +
				'Hunt ID: ' + hunt.id + '\n' +
				'Mode: ' + hunt.mode + '\n' +
				'Show Markers: ' + hunt.showExactMarkers + '\n' +
				'</pre>';

			if (hunt.treasures) {
				html += '<p style="font-weight:600;margin-bottom:0.25rem;">Treasure Distances:</p>';
				for (var i = 0; i < hunt.treasures.length; i++) {
					var t = hunt.treasures[i];
					var found = progress && progress.foundTreasureIds && progress.foundTreasureIds.indexOf(t.id) !== -1;
					var dist = 'N/A';
					if (pos) {
						dist = Math.round(window.TreasureApp.distanceMeters(pos.lat, pos.lng, t.lat, t.lng)) + 'm';
					}
					html += '<div style="font-size:0.8rem;padding:0.25rem 0;">' +
						(found ? '✅' : '🔍') + ' ' + escapeHtml(t.title) +
						' — ' + dist +
						' (radius: ' + (t.radiusMeters || hunt.defaultRadiusMeters || 25) + 'm)' +
						'</div>';
				}
			}

			// Simulate buttons
			html += '<p style="font-weight:600;margin-top:0.75rem;margin-bottom:0.5rem;">🔧 Simulate (for testing):</p>';
			for (var j = 0; j < hunt.treasures.length; j++) {
				var st = hunt.treasures[j];
				if (progress && progress.foundTreasureIds && progress.foundTreasureIds.indexOf(st.id) !== -1) continue;
				html += '<button class="btn btn-small btn-outline btn-simulate" data-tid="' + st.id + '" style="margin:0.25rem;">' +
					'📍 Simulate near: ' + escapeHtml(st.title) +
					'</button> ';
			}
			html += '</div>';
		}

		// Storage keys
		html += '<div class="card">' +
			'<h4>🗄 Storage Keys</h4>' +
			'<pre id="debug-storage-keys" style="font-size:0.75rem;color:var(--muted);white-space:pre-wrap;">Loading...</pre>' +
			'</div>';

		// Actions
		html += '<div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1rem;">' +
			'<button class="btn btn-outline btn-small" id="btn-dump-debug">📋 Dump Debug JSON</button>' +
			'<button class="btn btn-danger btn-small" id="btn-debug-clear">🗑 Clear All Data</button>' +
			'</div>';

		container.innerHTML = html;

		// Storage keys
		setTimeout(function () {
			var keys = [];
			try {
				if (window.TreasureApp.isStorageAvailable()) {
					for (var k = 0; k < localStorage.length; k++) {
						var key = localStorage.key(k);
						if (key.indexOf('treasureTrail.') === 0) {
							keys.push(key);
						}
					}
				}
			} catch (e) {}
			var keyEl = document.getElementById('debug-storage-keys');
			if (keyEl) {
				keyEl.textContent = keys.length > 0 ? keys.join('\n') : '(no treasureTrail keys)';
			}
		}, 50);

		// Simulate buttons
		bindElements('.btn-simulate', 'click', function (e) {
			var tid = e.target.getAttribute('data-tid');
			if (!hunt) return;
			var st = findTreasureById(hunt, tid);
			if (!st) return;
			if (!confirm('⚠️ Simulate being at treasure "' + st.title + '"? This will unlock it as if you were standing there.')) return;
			playerState.currentPosition = {
				lat: st.lat,
				lng: st.lng,
				accuracy: 5,
				timestamp: Date.now()
			};
			updatePlayerUI(playerState.currentPosition);
			updatePlayerMap();
			checkUnlock();
			alert('Simulated position set to ' + st.lat.toFixed(6) + ', ' + st.lng.toFixed(6));
		});

		// Dump debug
		document.getElementById('btn-dump-debug').addEventListener('click', function () {
			var debug = {
				currentPosition: pos,
				activeHuntId: huntId,
				hunt: hunt,
				progress: progress,
				settings: settings,
				huntCount: window.TreasureApp.hunts.load().length,
				storageAvailable: window.TreasureApp.isStorageAvailable()
			};
			downloadJSON(debug, 'treasure-trail-debug.json');
		});

		// Clear data
		document.getElementById('btn-debug-clear').addEventListener('click', function () {
			if (confirm('Delete ALL local data?')) {
				window.TreasureApp.resetAll();
				window.TreasureApp.showView('home');
			}
		});
	}
})();
