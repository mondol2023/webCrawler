import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { IUser } from '../models/User.model';

export interface JwtPayload {
  userId: string;
  role: 'admin' | 'user';
  email: string;
}

export function signAccessToken(user: Pick<IUser, '_id' | 'role' | 'email'>): string {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role, email: user.email } as JwtPayload,
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

export function signRefreshToken(user: Pick<IUser, '_id' | 'role' | 'email'>): string {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role, email: user.email } as JwtPayload,
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  );
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
}