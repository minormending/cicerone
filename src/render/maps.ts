/**
 * The real map, laid over the drawn one.
 *
 * The SVG route stays in the page and is still what you get first: it needs no
 * network, no JavaScript and no waiting, and it is what prints. A guide on
 * paper is the copy that survives a dead battery in a foreign city, and a WebGL
 * canvas is not reliably part of a printed page. So the drawing remains the
 * floor and this is the upgrade on top of it — if the tiles never arrive, the
 * page is exactly as good as it was yesterday.
 *
 * Tiles come from OpenFreeMap, which serves OpenStreetMap data with no key and
 * no account, in the Positron style: grey, low contrast, almost no colour of
 * its own. That is the only kind of basemap that can carry a coral line
 * without arguing with it.
 *
 * ---
 *
 * This is a string of plain JavaScript rather than a module, for the same
 * reason BOOK_CSS is a string: `cicerone book` writes one self-contained file
 * with no bundler in front of it and nothing to serve alongside it, while the
 * site bundles its own TypeScript. A string is the only form both can use, so
 * there is one copy of this rather than two that drift.
 *
 * It contains no backticks and no dollar-brace, because it lives inside a
 * template literal. `npm test` checks that it still parses.
 */
export const MAP_JS = `
(function () {
  var STYLE = 'https://tiles.openfreemap.org/styles/positron';
  var LIB = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.0/maplibre-gl';
  var CORAL = '#E2574C';
  var PAPER = '#FBFAF7';
  var loading = null;

  /* Load the library once, and only on a page that has a route to show. */
  function library() {
    if (loading) return loading;
    loading = new Promise(function (resolve) {
      if (typeof maplibregl !== 'undefined') return resolve(true);
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LIB + '.css';
      document.head.appendChild(css);
      var script = document.createElement('script');
      script.src = LIB + '.js';
      script.async = true;
      script.onload = function () { resolve(true); };
      /* Offline, blocked, or a bad day for the CDN. The drawn route is still
         on the page and still correct, so this is not an error. */
      script.onerror = function () { resolve(false); };
      document.head.appendChild(script);
    });
    return loading;
  }

  function routeOf(host) {
    var raw = host.getAttribute('data-route');
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length >= 2 ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function draw(host, route) {
    var canvas = document.createElement('div');
    canvas.className = 'route-map';
    host.appendChild(canvas);

    var map = new maplibregl.Map({
      container: canvas,
      style: STYLE,
      /* Interaction off. This is an illustration in a book, not a tool, and it
         sits inside a page you scroll: a map that swallows the wheel is the
         most irritating thing a page can do. */
      interactive: false,
      attributionControl: { compact: true }
    });

    map.on('load', function () {
      var bounds = new maplibregl.LngLatBounds();
      for (var i = 0; i < route.length; i++) bounds.extend(route[i]);
      /* maxZoom matters for the days that barely move: two stops on the same
         square would otherwise fill the frame with one building. */
      map.fitBounds(bounds, { padding: 46, duration: 0, maxZoom: 15.5 });

      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: route }
        }
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': CORAL, 'line-width': 3.5, 'line-opacity': 0.9 }
      });

      map.addSource('stops', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: route.map(function (point, index) {
            return {
              type: 'Feature',
              properties: { first: index === 0 },
              geometry: { type: 'Point', coordinates: point }
            };
          })
        }
      });
      map.addLayer({
        id: 'route-stops',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': ['case', ['get', 'first'], 6.5, 5],
          'circle-color': ['case', ['get', 'first'], CORAL, PAPER],
          'circle-stroke-color': CORAL,
          'circle-stroke-width': 2.5
        }
      });

      /* Only now is there something better than the drawing to look at. */
      host.classList.add('has-map');
    });
  }

  /* Upgrade every route in the document. Safe to call again after a re-render:
     a route that already has a map is left alone. */
  function mount() {
    var hosts = [].slice.call(document.querySelectorAll('.route[data-route]'))
      .filter(function (host) { return !host.querySelector('.route-map'); });
    if (hosts.length === 0) return;
    library().then(function (ready) {
      if (!ready) return;
      hosts.forEach(function (host) {
        var route = routeOf(host);
        if (route) draw(host, route);
      });
    });
  }

  window.ciceroneMaps = mount;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
`
