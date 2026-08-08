export default defineEventHandler((event) => {
  deleteCookie(event, "ntauth_session");
  setResponseStatus(event, 204);
  return null;
});
