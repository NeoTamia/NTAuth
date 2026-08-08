type RequestOptions = {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
};

export function useAuthApi() {
  const config = useRuntimeConfig();
  const baseURL = String(config.public.apiBaseUrl).replace(/\/$/, "");

  const request = <T>(path: string, options: RequestOptions = {}) =>
    $fetch<T>(`${baseURL}${path}`, {
      ...options,
      credentials: "include",
    });

  return { request };
}
