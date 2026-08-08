import {
  createHttpNTAuthTransport,
  createNTAuthSession,
  type NTAuthSession,
} from "@neotamia/nuxt-auth";

export default defineNuxtPlugin(() => {
  const origin = useRequestURL().origin;
  const requestHeaders = useRequestHeaders(["cookie"]);
  const transport = createHttpNTAuthTransport({
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (requestHeaders.cookie) headers.set("cookie", requestHeaders.cookie);
      return globalThis.fetch(new URL(input.toString(), origin), { ...init, headers });
    },
  });
  return {
    provide: {
      ntauth: createNTAuthSession({ expectedIssuer: "http://localhost:3001", transport }),
    },
  };
});

declare module "#app" {
  interface NuxtApp {
    $ntauth: NTAuthSession;
  }
}

declare module "vue" {
  interface ComponentCustomProperties {
    $ntauth: NTAuthSession;
  }
}
