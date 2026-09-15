let requestTokenPromise: Promise<string | null> | null = null;

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return fetch(input, init);
  }

  let response = await fetchWithToken(input, init, await requestToken());
  if (response.status === 403) {
    requestTokenPromise = null;
    response = await fetchWithToken(input, init, await requestToken());
  }
  return response;
}

async function fetchWithToken(
  input: RequestInfo | URL,
  init: RequestInit,
  token: string | null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("x-herzi-request-token", token);
  return fetch(input, { ...init, headers });
}

async function requestToken(): Promise<string | null> {
  requestTokenPromise ??= fetch("/api/request-token", { cache: "no-store" })
    .then(async (response) => {
      // A rebuilt web bundle can briefly be served by the pre-token server.
      // Keep existing mutations usable until that process is restarted.
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Request token failed (${response.status})`);
      const body = (await response.json()) as { token?: unknown };
      if (typeof body.token !== "string" || !body.token) {
        throw new Error("Server returned an invalid request token");
      }
      return body.token;
    })
    .catch((error) => {
      requestTokenPromise = null;
      throw error;
    });
  return requestTokenPromise;
}
