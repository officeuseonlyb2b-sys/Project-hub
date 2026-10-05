(function (root, factory) {
  const helpers = factory();
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  else root.regularWorkTaskStatus = helpers;
})(globalThis, function () {
  const statusOptions = ['Not Started', 'In Progress', 'Waiting', 'Blocked', 'Ready for Review', 'Changes Required', 'Completed'];

  function createRegularWorkTaskStatusChange(task, nextStatus, actorUid, completedAt = new Date().toISOString()) {
    if (!task || typeof nextStatus !== 'string' || !statusOptions.includes(nextStatus)) return null;
    const previousStatus = task.status || 'Not Started';
    if (previousStatus === nextStatus) return null;

    const updates = { status: nextStatus };
    if (nextStatus === 'Completed') {
      updates.completedAt = completedAt;
      updates.completedByUid = actorUid;
    } else if (previousStatus === 'Completed') {
      updates.completedAt = null;
      updates.completedByUid = null;
    }

    const activityVerb = nextStatus === 'Completed'
      ? 'completed this task'
      : previousStatus === 'Completed'
        ? 'reopened this task'
        : `changed status from ${previousStatus} to ${nextStatus}`;

    return { previousStatus, nextStatus, updates, activityVerb };
  }

  return { createRegularWorkTaskStatusChange, statusOptions: [...statusOptions] };
});
