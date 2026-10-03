(function (root, factory) {
  const helpers = factory();
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  else root.regularWorkCommentHelpers = helpers;
})(globalThis, function () {
  function normalizeCommentText(value) {
    return String(value ?? '').trim();
  }

  function validateRegularWorkComment(value) {
    const text = normalizeCommentText(value);
    return { text, error: text ? '' : 'Please enter a comment.' };
  }

  function createTaskScopedSubmitGuard() {
    const inFlight = new Set();
    return {
      isSaving(taskId) {
        return inFlight.has(String(taskId));
      },
      async run(taskId, submit) {
        const key = String(taskId);
        if (inFlight.has(key)) return false;
        inFlight.add(key);
        try {
          await submit();
          return true;
        } finally {
          inFlight.delete(key);
        }
      }
    };
  }

  const delegatedRoots = new WeakSet();

  function installRegularWorkCommentClickDelegation(root, onAdd) {
    if (!root || typeof root.addEventListener !== 'function' || typeof onAdd !== 'function') {
      throw new TypeError('A click-event root and Add handler are required.');
    }
    if (delegatedRoots.has(root)) return false;
    delegatedRoots.add(root);
    root.addEventListener('click', event => {
      const button = event.target?.closest?.('#addComment');
      if (!button || button.disabled || (typeof root.contains === 'function' && !root.contains(button))) return;
      const taskId = String(button.dataset?.task || '');
      if (!taskId) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      onAdd(taskId, event, button);
    }, true);
    return true;
  }

  return { createTaskScopedSubmitGuard, installRegularWorkCommentClickDelegation, normalizeCommentText, validateRegularWorkComment };
});