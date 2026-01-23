import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prismaPkg from "@prisma/client";

const { Role } = prismaPkg as unknown as {
  Role: typeof import("@prisma/client").Role;
};
type RoleType = (typeof Role)[keyof typeof Role];

export type AuthUser = {
  id: string;
  employeeId: string;
  name: string;
  dept: string | null;
  role: RoleType;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return secret;
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      employeeId: user.employeeId,
      name: user.name,
      dept: user.dept,
      role: user.role,
    },
    getJwtSecret(),
    { expiresIn: "7d" }
  );
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;

    req.user = {
      id: String(payload.sub),
      employeeId: String(payload.employeeId),
      name: String(payload.name),
      dept: payload.dept ? String(payload.dept) : null,
      role: payload.role as RoleType,
    };

    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(roles: RoleType[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}
