export default defineEventHandler((event) => {
  setResponseStatus(event, 401);
  return { code: "authentication_required" };
});
