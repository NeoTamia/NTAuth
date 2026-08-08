type RequestOptions = {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  query?: Record<string, string>;
};

export function useAuthApi() {
  const config = useRuntimeConfig();
  const baseURL = String(config.public.apiBaseUrl).replace(/\/$/, "");
  const forwardedHeaders = import.meta.server ? useRequestHeaders(["cookie"]) : {};

  const request = <T>(path: string, options: RequestOptions = {}) =>
    $fetch<T>(`${baseURL}${path}`, {
      ...options,
      credentials: "include",
      headers: { ...forwardedHeaders, ...options.headers },
    });

  return { request };
}
