// Protección de la API de administración (crear, editar y borrar catálogos).
//
// Cloudflare Access corta el paso en el borde, pero además verificamos acá la firma del token de Access:
// si alguien llega por una URL que Access no cubre (p. ej. un deploy de preview *.pages.dev), igual queda afuera.
// Sin ACCESS_TEAM_DOMAIN/ACCESS_AUD configurados se rechaza todo (falla cerrada).
// Para desarrollo local, .dev.vars define ALLOW_UNAUTHENTICATED=1.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { error } from '../_lib/util.js';

let jwks;
let jwksDomain;

export async function onRequest(context) {
  const { request, env } = context;
  if (env.ALLOW_UNAUTHENTICATED === '1') return context.next();

  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/\/$/, '');
  if (!team || !env.ACCESS_AUD) return error('La administración todavía no tiene Cloudflare Access configurado', 503);

  const cookie = request.headers.get('Cookie') || '';
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  if (!token) return error('No autorizado', 401);

  try {
    if (!jwks || jwksDomain !== team) {
      jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
      jwksDomain = team;
    }
    const { payload } = await jwtVerify(token, jwks, { issuer: team, audience: env.ACCESS_AUD });
    context.data.user = payload.email || payload.sub;
    return context.next();
  } catch {
    return error('No autorizado', 403);
  }
}
