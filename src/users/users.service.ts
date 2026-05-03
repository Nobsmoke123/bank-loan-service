import { ConflictException, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, User } from 'src/prisma/generated/client';
import { DefaultArgs } from '@prisma/client/runtime/client';

@Injectable()
export class UsersService {
  async create(
    tx: Omit<
      PrismaClient<never, undefined, DefaultArgs>,
      '$connect' | '$disconnect' | '$on' | '$use' | '$extends'
    >,
    create_user_dto: CreateUserDto,
  ): Promise<User> {
    // Check if the user already exists
    const existingUser = await tx.user.findFirst({
      where: {
        email: create_user_dto.email,
      },
    });

    if (existingUser) {
      throw new ConflictException('Email is already in use.');
    }

    const salt = await bcrypt.genSalt(12);

    const password = await bcrypt.hash(create_user_dto.password, salt);

    return tx.user.create({
      data: {
        email: create_user_dto.email,
        role: create_user_dto.role,
        name: create_user_dto.name,
        password,
        balance: 0.0,
        tokenVersion: 1,
      },
    });
  }

  async findOne(
    tx: Omit<
      PrismaClient<never, undefined, DefaultArgs>,
      '$connect' | '$disconnect' | '$on' | '$use' | '$extends'
    >,
    email: string,
  ): Promise<User | null> {
    return tx.user.findFirst({ where: { email } });
  }
}
