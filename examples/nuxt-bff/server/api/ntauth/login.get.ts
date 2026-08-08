export default defineEventHandler((event) => {
  const query = getQuery(event);
  const returnTo = typeof query.returnTo === "string" ? query.returnTo : "/";
  return {
    authorizationUrl: `/api/ntauth/example-not-configured?returnTo=${encodeURIComponent(returnTo)}`,
  };
});
