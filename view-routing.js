(function (root, factory) {
  const routing = factory();
  if (typeof module === 'object' && module.exports) module.exports = routing;
  else root.executionHubViewRouting = routing;
})(globalThis, function () {
  const views = new Set([
    'dashboard', 'projects', 'dailywork', 'mywork', 'planner',
    'approvals', 'team', 'performance', 'activity'
  ]);
  const aliases = new Map([
    ['command', 'dashboard'],
    ['daily-work-performance', 'dailywork'],
    ['people', 'team'],
    ['people-departments', 'team']
  ]);

  function resolveView(hash, isSystemAdmin = false) {
    const requested = String(hash || '').replace(/^#/, '').trim().toLowerCase();
    const view = aliases.get(requested) || requested;
    if (!views.has(view) || (view === 'performance' && !isSystemAdmin)) return 'dashboard';
    return view || 'dashboard';
  }

  function hashForView(view) {
    return `#${views.has(view) ? view : 'dashboard'}`;
  }

  function createViewRouter({ location, history, isSystemAdmin = () => false }) {
    if (!location || !history) throw new TypeError('A location and history object are required.');
    let currentView = resolveView(location.hash, isSystemAdmin());

    function write(view, replace) {
      const hash = hashForView(view);
      if (location.hash === hash) return;
      history[replace ? 'replaceState' : 'pushState']({ executionHubView: view }, '', hash);
    }

    return {
      get current() { return currentView; },
      sync(requestedView) {
        const view = resolveView(hashForView(requestedView), isSystemAdmin());
        const unauthorizedFallback = view === 'dashboard' && requestedView !== 'dashboard';
        write(view, unauthorizedFallback || view === currentView);
        currentView = view;
        return view;
      },
      restore() {
        const view = resolveView(location.hash, isSystemAdmin());
        write(view, true);
        if (view === currentView) return null;
        currentView = view;
        return view;
      }
    };
  }

  return { createViewRouter, hashForView, resolveView, views: [...views] };
});
