export async function fetchApp(request, app, ip) {
  const url = new URL(request.url);
  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers: Object.fromEntries(request.headers),
    socket: { remoteAddress: ip || 'unknown' },
    async *[Symbol.asyncIterator]() {
      if (request.body) yield* request.body;
    },
  };
  const headers = new Headers();
  let status = 200;
  let response;
  const res = {
    setHeader: (key, value) => headers.set(key, value),
    writeHead(code, fields) {
      status = code;
      for (const [key, value] of Object.entries(fields)) headers.set(key, value);
    },
    end(data) { response = new Response(data, { status, headers }); },
  };
  await app(req, res);
  return response;
}
