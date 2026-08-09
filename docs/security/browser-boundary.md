# Frontière navigateur et reverse proxy

NTAuth est publié sous une origine unique. Le reverse proxy termine TLS, route `/api` vers Elysia
et les autres chemins vers Nuxt. Les conteneurs applicatifs ne doivent pas être joignables depuis
Internet.

## Invariants

- Better Auth reçoit une `baseURL` canonique et ne la déduit jamais des headers transmis.
- Les cookies production sont `Secure`, `HttpOnly`, `SameSite=Lax` et limités à `/`.
- CORS contient uniquement des origines HTTP(S) exactes ; la production utilise la même origine.
- Les IP forwardées ne sont interprétées que si `TRUSTED_PROXY_CIDRS` contient les adresses ou CIDR
  exacts du réseau proxy.
- Le proxy remplace, au lieu d'ajouter aveuglément, `X-Forwarded-For`, `X-Real-IP`,
  `X-Forwarded-Proto` et `Host` reçus du client.
- La CSP navigateur interdit les objets, frames, bases externes et scripts inline. Le style inline
  reste autorisé pour le rendu Nuxt ; aucun script inline ou `unsafe-eval` n'est autorisé.
- L'API utilise `default-src 'none'` et ne peut pas être embarquée dans une frame.

## Configuration

```dotenv
AUTH_BASE_URL=https://auth.neotamia.re/api/auth
CORS_ORIGINS=https://auth.neotamia.re
TRUSTED_PROXY_CIDRS=172.30.0.0/24
RATE_LIMIT_ENABLED=true
```

Une liste vide pour `TRUSTED_PROXY_CIDRS` désactive toute confiance dans les headers d'adresse. Il
ne faut jamais utiliser un CIDR qui inclut des clients non fiables ou exposer directement les ports
API/web lorsque cette option est active.

## Preuve staging

1. Vérifier que `curl -I https://auth.neotamia.re/` renvoie CSP, `nosniff`, frame denial,
   Permissions Policy et Referrer Policy.
2. Se connecter et vérifier `Secure; HttpOnly; SameSite=Lax` dans chaque `Set-Cookie`.
3. Envoyer une origine non autorisée et confirmer l'absence de header CORS permissif.
4. Envoyer un faux `X-Forwarded-For` directement sur un réseau isolé : il ne doit jamais être
   possible d'atteindre le conteneur en contournant le proxy.
5. Vérifier que les assets Nuxt et les parcours OAuth fonctionnent sans violation CSP bloquante.

## Retour arrière

Revenir au dernier digest validé et restaurer la configuration précédente du proxy. Ne jamais
désactiver CSRF, CSP ou les attributs de cookie pour rétablir un flux. Une origine ou un proxy
supplémentaire doit être ajouté explicitement puis repasser les tests de cette frontière.
