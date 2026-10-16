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
    const [path, query = ''] = String(hash || '').replace(/^#/, '').trim().split('?');
    const [head, id, tab] = path.split('/');
    if (String(head || '').toLowerCase() !== 'projects' || !id) return null;
    try {
      const route = { projectId: decodeURIComponent(id), tab: decodeURIComponent(tab || '') || 'overview' };
      const params = new URLSearchParams(query);
      const categoryId = params.get('category') || params.get('categoryId');
      if (categoryId) route.categoryId = categoryId;
      return route;
    } catch {
      return null;
    }
  }

  function hashForProject(route) {
    const path = `#projects/${encodeURIComponent(route.projectId)}/${encodeURIComponent(route.tab || 'overview')}`;
    return route.categoryId ? `${path}?category=${encodeURIComponent(route.categoryId)}` : path;
  }

  function categoryIdForProject(projectId, category) {
    const record = category && typeof category === 'object' ? category : { name: category };
    const explicitId = record.id || record.categoryId;
    if (explicitId) return String(explicitId);
    const identity = `${String(projectId || '')}\u0000${String(record.name || '').trim()}`;
    let hash = 2166136261;
    for (let index = 0; index < identity.length; index += 1) {
      hash ^= identity.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `category-${(hash >>> 0).toString(36)}`;
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
        const changed = view !== currentView || (route?.projectId || null) !== (currentRoute?.projectId || null) || (route?.tab || null) !== (currentRoute?.tab || null) || (route?.categoryId || null) !== (currentRoute?.categoryId || null);
        currentView = view;
        currentRoute = route;
        return changed ? view : null;
      }
    };
  }

  return { categoryIdForProject, createViewRouter, hashForView, hashForProject, parseProjectRoute, resolveView, views: [...views] };
});
