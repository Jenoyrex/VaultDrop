export interface AccessTokenPayload {
  sub: string;
  username: string;
  /** Must equal `User.tokenVersion` in the database; bumping that column revokes every outstanding token for the user. */
  ver: number;
  iat?: number;
  exp?: number;
}
