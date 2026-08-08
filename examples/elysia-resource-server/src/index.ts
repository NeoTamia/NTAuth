import { createExampleResourceServer } from "./app";

const issuer = process.env.NTAUTH_ISSUER ?? "http://localhost:3001";
const port = Number(process.env.PORT ?? "3101");

createExampleResourceServer({
  audience: "urn:neotamia:service:ntscout",
  issuer,
  requiredScopes: ["openid", "ntscout:access"],
  service: "ntscout",
}).listen(port);

console.log(`Example NTScout resource server listening on http://localhost:${port}`);
