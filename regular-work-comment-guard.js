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

  return { createTaskScopedSubmitGuard, normalizeCommentText, validateRegularWorkComment };
});