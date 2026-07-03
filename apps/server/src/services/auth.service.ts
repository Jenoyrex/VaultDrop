import type { PrismaClient } from "@prisma/client";
import { hashPassword, signAccessToken, verifyPassword } from "@vaultdrop/crypto";
import type { ServerEnv } from "@vaultdrop/config";
import type { AuthResponse, UserDTO } from "@vaultdrop/types";
import { AppError } from "../utils/app-error.js";

function toUserDTO(user: { id: string; username: string; createdAt: Date }): UserDTO {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt.toISOString()
  };
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: ServerEnv
  ) {}

  async register(username: string, password: string): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) {
      throw AppError.conflict("Username is already taken");
    }

    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.create({
      data: { username, passwordHash }
    });

    const accessToken = signAccessToken({
      userId: user.id,
      username: user.username,
      secret: this.env.JWT_SECRET,
      expiresIn: this.env.JWT_EXPIRES_IN
    });

    return { user: toUserDTO(user), accessToken };
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw AppError.unauthorized("Invalid username or password");
    }

    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      throw AppError.unauthorized("Invalid username or password");
    }

    const accessToken = signAccessToken({
      userId: user.id,
      username: user.username,
      secret: this.env.JWT_SECRET,
      expiresIn: this.env.JWT_EXPIRES_IN
    });

    return { user: toUserDTO(user), accessToken };
  }

  async getCurrentUser(userId: string): Promise<UserDTO> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw AppError.notFound("User not found");
    }
    return toUserDTO(user);
  }

  async usernameExists(username: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    return user !== null;
  }
}
