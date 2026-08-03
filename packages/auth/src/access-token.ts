import { SignJWT, jwtVerify } from "jose";

export const ACCESS_TOKEN_TYPE = "access" as const;

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export interface AccessTokenConfig {
  secret: string;
  issuer: string;
  audience: string;
  ttl: string;
}

export interface AccessTokenHandler {
  sign(claims: AccessTokenClaims): Promise<string>;
  verify(token: string): Promise<AccessTokenClaims>;
}

export function createAccessTokenHandler(config: AccessTokenConfig): AccessTokenHandler {
  const secret = new TextEncoder().encode(config.secret);

  return {
    async sign(claims: AccessTokenClaims): Promise<string> {
      return new SignJWT({
        sid: claims.sessionId,
        type: ACCESS_TOKEN_TYPE,
      })
        .setSubject(claims.userId)
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuedAt()
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setExpirationTime(config.ttl)
        .sign(secret);
    },

    async verify(token: string): Promise<AccessTokenClaims> {
      const { payload } = await jwtVerify(token, secret, {
        issuer: config.issuer,
        audience: config.audience,
      });

      const userId = payload.sub;
      const sessionId = payload.sid;
      if (typeof userId !== "string" || typeof sessionId !== "string") {
        throw new Error("Access token is missing required claims");
      }
      if (payload.type !== ACCESS_TOKEN_TYPE) {
        throw new Error("Access token has an unexpected type");
      }

      return { userId, sessionId };
    },
  };
}
