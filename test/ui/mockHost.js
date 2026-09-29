// Stands in for the extension host inside the UI test harness.
// Expects `__FIXTURE__` (see fixture.ts) and `__SCENARIO__` to be defined before this runs.
(() => {
  const fx = __FIXTURE__;
  const scenario = __SCENARIO__;
  const sent = [];
  let state;
  const reply = (msg, delay = 0) => setTimeout(() => window.postMessage(msg, '*'), delay);
  const pages = fx.pages.slice();

  window.__sent = sent;
  window.__host = {
    fixture: fx,
    send: (msg) => reply(msg),
    setContent(id, text) {
      fx.contents[id] = text;
    },
    state: () => state,
  };

  window.acquireVsCodeApi = () => ({
    postMessage(m) {
      sent.push(m);
      switch (m.type) {
        case 'ready':
        case 'refresh':
          reply({ type: 'loading', message: 'Loading history…' });
          if (scenario.error) {
            reply({ type: 'init', payload: { ...fx.init, stops: [], error: scenario.error } }, 30);
          } else {
            reply({ type: 'init', payload: fx.init }, 30);
          }
          break;
        case 'getContent': {
          const text = fx.contents[m.stopId];
          const result =
            scenario.binary && scenario.binary === m.stopId
              ? { requestId: m.requestId, stopId: m.stopId, binary: true }
              : text === undefined
                ? { requestId: m.requestId, stopId: m.stopId, error: 'unknown revision' }
                : { requestId: m.requestId, stopId: m.stopId, text };
          reply({ type: 'content', result }, scenario.contentDelay ?? 5);
          break;
        }
        case 'loadMore': {
          if (m.all) {
            const all = pages.splice(0).reverse().flatMap((p) => p.stops);
            reply({ type: 'more', stops: all, hasMore: false }, 80);
          } else {
            const page = pages.shift();
            reply({ type: 'more', stops: page ? page.stops : [], hasMore: page ? page.hasMore : false }, 80);
          }
          break;
        }
      }
    },
    setState(s) {
      state = s;
    },
    getState() {
      return state;
    },
  });
})();
