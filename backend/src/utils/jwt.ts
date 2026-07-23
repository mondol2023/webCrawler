import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { IUser } from '../models/User.model';

export interface JwtPayload {
  userId: string;
  role: 'admin' | 'user';
  email: string;
}

function buildPayload(user: Pick<IUser, '_id' | 'role' | 'email'>): JwtPayload {
  return { userId: user._id.toString(), role: user.role, email: user.email };
}

export function signAccessToken(user: Pick<IUser, '_id' | 'role' | 'email'>): string {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(buildPayload(user), env.JWT_SECRET, options);
}

export function signRefreshToken(user: Pick<IUser, '_id' | 'role' | 'email'>): string {
  const options: SignOptions = {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign(buildPayload(user), env.JWT_REFRESH_SECRET, options);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
}