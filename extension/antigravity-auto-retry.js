oka(() => {
  const GLOBAL_KEY = '__antigravityAutoRetry__';
  const PUBLIC_API_NAME = 'antigravityAutoRetry';

  const PANEL_ELEMENT_ID = 'antigravity.agentSidePanelInputBox';
  const RETRY_BUTTON_REGEX = /\bretry\b/i;
  const MIN_CLICK_INTERVAL_MS = 500;
  const SCAN_DEBOUNCE_MS = 250;
  const GLOBAL_FALLBACK_SCAN_INTERVAL_MS = 5_000;

  // Error contexts where it's safe to auto-retry. Each entry has a label
  // (used in logs) and a regex that must match some ancestor's textContent
  // for a Retry click to fire. Order doesn't matter — first match wins.
  const ERROR_PATTERNS = [
    { label: 'high traffic', regex: /high\s+traffic/i },
    {
      label: 'agent terminated',
      regex: /agent\s+(execution\s+)?terminated\s+due\s+to\s+error/i
    }
  ];

  // Mode selector. Override via:
  //   localStorage.antigravityAutoRetryMode = 'high-traffic-only'
  //
  //   'all'               — retry on every pattern in ERROR_PATTERNS (default)
  //   'high-traffic-only' — only retry the transient overload error
  const RETRY_MODE = (() => {
    try {
      return localStorage.getItem('antigravityAutoRetryMode') === 'high-traffic-only'
        ? 'high-traffic-only'
        : 'all';
    } catch (_) {
      return 'all';
    }
  })();

  const ACTIVE_PATTERNS =
    RETRY_MODE === 'high-traffic-only'
      ? ERROR_PATTERNS.filter((p) => p.label === 'high traffic')
      : ERROR_PATTERNS;

  // Safety circuit breaker. If the retry button stays visible after this many
  // clicks in this window, assume the UI is broken and stop clicking.
  const RUNAWAY_WINDOW_MS = 60_000;
  const RUNAWAY_MAX_CLICKS = 10;

  // Periodic "still on duty" heartbeat so the user can see the script is
  // alive without enabling verbose debug logging.
  const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;

  const DEBUG = (() => {
    try {
      return localStorage.getItem('antigravityAutoRetryDebug') === '1';
    } catch (_) {
      return false;
    }
  })();

  const OBSERVED_ATTRIBUTE_FILTER = ['disabled', 'aria-disabled'];

  // User-visible logging. Subtle styled prefix so it stands out in the console
  // without being noisy. `debug()` stays gated behind the DEBUG flag for
  // per-scan detail.
  const LOG_PREFIX = '%c[Antigravity Auto Retry]';
  const LOG_STYLE = 'color:#4ea1ff;font-weight:bold';
  const LOG_RESET = 'color:inherit';

  const info = (message, ...args) => {
    console.log(`${LOG_PREFIX}%c ${message}`, LOG_STYLE, LOG_RESET, ...args);
  };

  const warn = (message, ...args) => {
    console.warn(`${LOG_PREFIX}%c ${message}`, LOG_STYLE, LOG_RESET, ...args);
  };

  const debug = (...args) => {
    if (DEBUG) {
      console.log('[antigravityAutoRetry]', ...args);
    }
  };

  window[GLOBAL_KEY]?.stop();

  let isRunning = false;
  let scanTimeout = null;
  let isTripped = false;

  let documentObserver = null;
  let panelObserver = null;
  let activePanel = null;
  let heartbeatTimer = null;
  let globalFallbackTimer = null;

  let lastRetryClickAt = 0;
  let pendingGlobalScan = false;
  let retryClickCount = 0;
  let scanCount = 0;
  const recentClicks = [];

  const normalizeText = (value) =>
    String(value || '').replace(/\s+/g, ' ').trim();

  const isElementVisible = (el) => {
    if (!el || !el.isConnected) return false;

    const style = getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      el.getClientRects().length > 0
    );
  };

  const isButtonEnabled = (btn) =>
    !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';

  const getPanel = () => document.getElementById(PANEL_ELEMENT_ID);

  const getButtonText = (btn) => {
    const candidates = [
      btn.textContent,
      btn.getAttribute('aria-label'),
      btn.getAttribute('title')
    ];

    for (const value of candidates) {
      const text = normalizeText(value);
      if (text) return text;
    }

    return '';
  };

  const ERROR_ANCESTOR_DEPTH = 20;

  const matchErrorContext = (btn) => {
    // Anchor the click on a known error context so we don't fire on unrelated
    // Retry buttons (e.g., a Git retry dialog). Walk up the ancestor chain and
    // check each ancestor's textContent against ACTIVE_PATTERNS. Antigravity
    // nests the error fairly deep — observed 10 levels in the wild — so we
    // allow a generous upper bound. Stops at document.body either way.
    let node = btn;
    for (let i = 0; i < ERROR_ANCESTOR_DEPTH && node && node !== document.body; i++) {
      const text = node.textContent || '';
      for (const pattern of ACTIVE_PATTERNS) {
        if (pattern.regex.test(text)) return pattern;
      }
      node = node.parentElement;
    }
    return null;
  };

  const findRetryButton = (root) => {
    if (!root) return null;

    for (const btn of root.querySelectorAll('button')) {
      if (!isElementVisible(btn) || !isButtonEnabled(btn)) continue;
      if (!RETRY_BUTTON_REGEX.test(getButtonText(btn))) continue;
      const pattern = matchErrorContext(btn);
      if (!pattern) continue;
      return { button: btn, pattern };
    }

    return null;
  };

  const recordClick = (now) => {
    recentClicks.push(now);
    const cutoff = now - RUNAWAY_WINDOW_MS;
    while (recentClicks.length && recentClicks[0] < cutoff) {
      recentClicks.shift();
    }
    if (recentClicks.length >= RUNAWAY_MAX_CLICKS) {
      isTripped = true;
      warn(
        `Circuit breaker tripped — ${RUNAWAY_MAX_CLICKS} clicks in ${
          RUNAWAY_WINDOW_MS / 1000
        }s. Stopping to avoid a click loop. Reload the window to reset.`
      );
      controller.stop();
    }
  };

  function queueScan() {
    scheduleScan(SCAN_DEBOUNCE_MS);
  }

  function queueGlobalScan(delayMs = SCAN_DEBOUNCE_MS) {
    pendingGlobalScan = true;
    scheduleScan(delayMs);
  }

  function scheduleScan(delayMs) {
    if (!isRunning || scanTimeout) return;

    scanTimeout = setTimeout(() => {
      scanTimeout = null;
      scanAndClickRetry();
    }, delayMs);
  }

  function handleDocumentMutation(records) {
    const nextPanel = getPanel();
    if (nextPanel !== activePanel || !activePanel || !activePanel.isConnected) {
      queueGlobalScan();
      return;
    }

    if (records.every((record) => activePanel.contains(record.target))) return;

    queueGlobalScan();
  }

  function attachPanelObserver(panel) {
    panelObserver?.disconnect();
    panelObserver = null;

    if (!panel || !isRunning) return;

    panelObserver = new MutationObserver(queueScan);
    panelObserver.observe(panel, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: OBSERVED_ATTRIBUTE_FILTER
    });
  }

  function scanAndClickRetry() {
    scanCount++;

    if (!isRunning) return;

    const now = Date.now();

    const nextPanel = getPanel();
    if (nextPanel !== activePanel) {
      activePanel = nextPanel;
      attachPanelObserver(activePanel);
    }

    // Normal scans stay inside the known panel. The document-wide scan is
    // still used for debounced document changes outside that panel, preserving
    // per-chat Retry detection without scanning all VS Code buttons on every
    // mutation.
    const includeGlobal = pendingGlobalScan;
    pendingGlobalScan = false;
    const match = findRetryMatch(includeGlobal);
    if (!match || !match.button.isConnected) return;

    if (now - lastRetryClickAt < MIN_CLICK_INTERVAL_MS) return;

    const { button, pattern } = match;
    lastRetryClickAt = now;
    retryClickCount++;
    info(`Clicked Retry (#${retryClickCount}) — matched "${pattern.label}".`);
    debug('clicked retry', { retryClickCount, scanCount, pattern: pattern.label });
    button.click();
    recordClick(now);
  }

  function findRetryMatch(includeGlobal) {
    if (activePanel && activePanel.isConnected) {
      const panelMatch = findRetryButton(activePanel);
      if (panelMatch) return panelMatch;
    }

    if (!includeGlobal && activePanel && activePanel.isConnected) {
      return null;
    }

    return findRetryButton(document.body);
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      const noun = retryClickCount === 1 ? 'retry' : 'retries';
      info(`Still on duty — ${retryClickCount} ${noun} so far.`);
    }, HEARTBEAT_INTERVAL_MS);
  }

  function startGlobalFallback() {
    stopGlobalFallback();
    globalFallbackTimer = setInterval(
      queueGlobalScan,
      GLOBAL_FALLBACK_SCAN_INTERVAL_MS
    );
  }

  function stopGlobalFallback() {
    if (globalFallbackTimer) {
      clearInterval(globalFallbackTimer);
      globalFallbackTimer = null;
    }
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  const controller = {
    start() {
      if (isRunning) return this.status();
      if (isTripped) {
        warn('Refusing to start — circuit breaker tripped. Reload the window to reset.');
        return this.status();
      }

      isRunning = true;

      documentObserver = new MutationObserver(handleDocumentMutation);
      documentObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      startHeartbeat();
      startGlobalFallback();
      queueGlobalScan(0);
      const labels = ACTIVE_PATTERNS.map((p) => `"${p.label}"`).join(' / ');
      info(`On duty — watching for Retry after ${labels} errors (mode: ${RETRY_MODE}).`);
      return this.status();
    },

    stop() {
      isRunning = false;
      if (scanTimeout) {
        clearTimeout(scanTimeout);
        scanTimeout = null;
      }

      documentObserver?.disconnect();
      panelObserver?.disconnect();
      stopHeartbeat();
      stopGlobalFallback();

      documentObserver = null;
      panelObserver = null;
      activePanel = null;
      pendingGlobalScan = false;

      info('Stopped. Call antigravityAutoRetry.start() to resume.');
      return this.status();
    },

    reset() {
      isTripped = false;
      recentClicks.length = 0;
      return this.status();
    },

    status() {
      return {
        isRunning,
        isTripped,
        panelFound: Boolean(getPanel()),
        lastRetryClickAt,
        retryClickCount,
        scanCount,
        recentClicks: recentClicks.length,
        minClickIntervalMs: MIN_CLICK_INTERVAL_MS,
        scanDebounceMs: SCAN_DEBOUNCE_MS,
        globalFallbackScanIntervalMs: GLOBAL_FALLBACK_SCAN_INTERVAL_MS,
        mode: RETRY_MODE,
        activePatterns: ACTIVE_PATTERNS.map((p) => p.label)
      };
    }
  };

  window[GLOBAL_KEY] = controller;
  window[PUBLIC_API_NAME] = controller;

  controller.start();

  // --- Suppress the "installation appears to be corrupt" notification ---
  //
  // Antigravity's IntegrityService caches product.json checksums in the
  // Electron main process. A "Reload Window" only restarts the renderer,
  // so the integrity check still compares stale checksums against the
  // patched workbench.html and fires a false-positive warning. We
  // auto-dismiss this specific notification so the user isn't nagged.
  //
  // On a full quit+restart the checksums match and no notification fires,
  // so this observer is a no-op in that case.
  (() => {
    const CORRUPT_PATTERN = /installation appears to be corrupt/i;
    const DISMISS_DELAY_MS = 500; // short delay so the notification is fully rendered

    const dismissCorruptNotification = (container) => {
      const items = container.querySelectorAll(
        '.notification-list-item, .notifications-list-container .monaco-list-row'
      );
      for (const item of items) {
        const text = item.textContent || '';
        if (!CORRUPT_PATTERN.test(text)) continue;

        // Find the close/dismiss button within this notification
        const closeBtn =
          item.querySelector('.codicon-notifications-clear') ||
          item.querySelector('.codicon-close') ||
          item.querySelector('[title="Close Notification"], [title="Clear Notification"], [aria-label="Close Notification"], [aria-label="Clear Notification"]') ||
          item.querySelector('.action-label.codicon');

        if (closeBtn) {
          info('Dismissed "installation appears to be corrupt" notification (expected after patching — checksums are correct after a full restart).');
          closeBtn.click();
          return true;
        }

        // Fallback: try the "Don't Show Again" secondary action if close button not found
        const dontShow = item.querySelector('[title*="Don\'t Show"], [title*="don\'t show"]');
        if (dontShow) {
          info('Clicked "Don\'t Show Again" on corrupt-installation notification.');
          dontShow.click();
          return true;
        }
      }
      return false;
    };

    const corruptObserver = new MutationObserver(() => {
      // The notification center renders asynchronously — give it a tick
      setTimeout(() => {
        const container =
          document.querySelector('.notifications-list-container') ||
          document.querySelector('.notifications-center') ||
          document.querySelector('.notification-toast-container') ||
          document.body;
        dismissCorruptNotification(container);
      }, DISMISS_DELAY_MS);
    });

    // Observe the workbench for notification toasts appearing
    corruptObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    // Also do an immediate scan in case the notification is already visible
    setTimeout(() => {
      const container =
        document.querySelector('.notifications-list-container') ||
        document.querySelector('.notification-toast-container') ||
        document.body;
      dismissCorruptNotification(container);
    }, 2000);
  })();
})();
