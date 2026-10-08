(function (root, factory) {
  const helpers = factory();
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  else root.regularWorkTaskStatus = helpers;
})(globalThis, function () {
  const statusOptions = ['Pending', 'In Progress', 'Working', 'On Hold', 'Ready for Review', 'Completed', 'Discarded'];

  function createRegularWorkTaskStatusChange(task, nextStatus, actorUid, changedAt = new Date().toISOString()) {
    if (!task || typeof nextStatus !== 'string' || !statusOptions.includes(nextStatus)) return null;
    const previousStatus = task.status || 'Pending';
    const normalizedPreviousStatus = previousStatus === 'Not Started' ? 'Pending' : previousStatus;
    if (previousStatus === nextStatus) return null;

    const updates = { status: nextStatus };
    if (nextStatus === 'Completed') {
      updates.completedAt = changedAt;
      updates.completedByUid = actorUid;
    } else if (normalizedPreviousStatus === 'Completed') {
      updates.completedAt = null;
      updates.completedByUid = null;
    }
    if (nextStatus === 'Discarded') {
      updates.discardedAt = changedAt;
      updates.discardedByUid = actorUid;
    } else if (normalizedPreviousStatus === 'Discarded') {
      updates.discardedAt = null;
      updates.discardedByUid = null;
    }

    const activityVerb = nextStatus === 'Completed'
      ? 'completed this task'
      : normalizedPreviousStatus === 'Completed'
        ? 'reopened this task'
        : nextStatus === 'Discarded'
          ? 'discarded this task'
          : normalizedPreviousStatus === 'Discarded'
            ? 'reopened this discarded task'
            : `changed status from ${previousStatus} to ${nextStatus}`;

    return { previousStatus, nextStatus, updates, activityVerb };
  }

  return { createRegularWorkTaskStatusChange, statusOptions: [...statusOptions] };
});
