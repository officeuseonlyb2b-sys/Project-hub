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
    const requested = String(hash || '').replace(/^#/, '').trim().split('/')[0].toLowerCase();
    const view = aliases.get(requested) || requested;
    if (!views.has(view) || (view === 'performance' && !isSystemAdmin)) return 'dashboard';
    return view || 'dashboard';
  }

  function hashForView(view) {
    return `#${views.has(view) ? view : 'dashboard'}`;
  }

  function parseProjectRoute(hash) {
    const [head, id, tab] = String(hash || '').replace(/^#/, '').trim().split('/');
    if (String(head || '').toLowerCase() !== 'projects' || !id) return null;
    try {
      return { projectId: decodeURIComponent(id), tab: decodeURIComponent(tab || '') || 'overview' };
    } catch {
      return null;
    }
  }

  function hashForProject(route) {
    return `#projects/${encodeURIComponent(route.projectId)}/${encodeURIComponent(route.tab || 'overview')}`;
  }

  function createViewRouter({ location, history, isSystemAdmin = () => false }) {
    if (!location || !history) throw new TypeError('A location and history object are required.');
    let currentView = resolveView(location.hash, isSystemAdmin());
    let currentRoute = currentView === 'projects' ? parseProjectRoute(location.hash) : null;

    function write(view, replace, route) {
      const hash = view === 'projects' && route ? hashForProject(route) : hashForView(view);
      if (location.hash === hash) return;
      history[replace ? 'replaceState' : 'pushState']({ executionHubView: view }, '', hash);
    }

    return {
      get current() { return currentView; },
      get route() { return currentRoute; },
      sync(requestedView, route = null) {
        const view = resolveView(hashForView(requestedView), isSystemAdmin());
        const nextRoute = view === 'projects' && route?.projectId ? route : null;
        const unauthorizedFallback = view === 'dashboard' && requestedView !== 'dashboard';
        const sameProject = (nextRoute?.projectId || null) === (currentRoute?.projectId || null);
        write(view, unauthorizedFallback || (view === currentView && sameProject), nextRoute);
        currentView = view;
        currentRoute = nextRoute;
        return view;
      },
      restore() {
        const view = resolveView(location.hash, isSystemAdmin());
        const route = view === 'projects' ? parseProjectRoute(location.hash) : null;
        write(view, true, route);
        const changed = view !== currentView || (route?.projectId || null) !== (currentRoute?.projectId || null) || (route?.tab || null) !== (currentRoute?.tab || null);
        currentView = view;
        currentRoute = route;
        return changed ? view : null;
      }
    };
  }

  return { createViewRouter, hashForView, hashForProject, parseProjectRoute, resolveView, views: [...views] };
});
