import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ApplyLoanDto } from './dto/apply-loan.dto';
import { AuthenticatedUser } from 'src/common/interfaces/auth-user.interface';
import { LoanStatus } from 'src/prisma/generated/enums';
import { TransactionIsolationLevel } from 'src/prisma/generated/internal/prismaNamespace';
import { LoanStateMachine } from './loan-state-machine';
import { Loan, Prisma } from 'src/prisma/generated/client';
import { LoanPaginationDto } from './dto/loan-pagination.dto';
import { ProcessLoanDto, ProcessLoanStatus } from './dto/process-loan.dto';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import Redis from 'ioredis';

@Injectable()
export class LoansService {
  constructor(
    private readonly prismaService: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async applyLoan(user: AuthenticatedUser, applyLoanDto: ApplyLoanDto) {
    const loan = await this.prismaService.$transaction(
      async (tx) => {
        const existingLoan = await tx.loan.findFirst({
          where: {
            OR: [
              { user_id: user.id, status: LoanStatus.ACTIVE },
              { user_id: user.id, status: LoanStatus.PENDING },
            ],
          },
        });

        if (existingLoan) {
          if (existingLoan.status === LoanStatus.PENDING) {
            throw new ConflictException(
              'You already have a pending loan. You can only apply for a new loan after this loan has been processed.',
            );
          } else {
            throw new ConflictException(
              'You already have an active loan. Please repay it before applying for a new one.',
            );
          }
        }

        try {
          return await tx.loan.create({
            data: {
              user_id: user.id,
              amount: applyLoanDto.amount,
              durationMonths: applyLoanDto.durationInMonths,
              outstandingBalance: applyLoanDto.amount,
            },
          });
        } catch (error) {
          if (
            error instanceof PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new ConflictException(
              'You already have an active or pending loan.',
            );
          }
          console.log(error);
        }
      },
      {
        isolationLevel: TransactionIsolationLevel.Serializable,
        maxWait: 30000,
        timeout: 30000,
      },
    );

    await this.invalidateCache(user.id);
    await this.invalidateAdminLoansCache();

    return loan;
  }

  async processLoan(
    user: AuthenticatedUser,
    loan_id: string,
    processLoanDto: ProcessLoanDto,
  ) {
    const loan = await this.prismaService.$transaction(
      async (tx) => {
        const { status, note } = processLoanDto;

        const loanStatus =
          status === ProcessLoanStatus.APPROVED
            ? LoanStatus.ACTIVE
            : LoanStatus.REJECTED;

        const existingLoan = await tx.loan.findFirst({
          where: {
            id: loan_id,
          },
          select: {
            id: true,
            amount: true,
            outstandingBalance: true,
            status: true,
            user: {
              select: {
                id: true,
              },
            },
          },
        });

        if (!existingLoan) {
          throw new NotFoundException(`Loan with id ${loan_id} not found.`);
        }

        if (!LoanStateMachine.canTransition(existingLoan.status, loanStatus)) {
          throw new BadRequestException(
            `Loan is already ${existingLoan.status}. Only pending loans can be processed.`,
          );
        }

        const data = {
          status: loanStatus,
          admin_id: user.id,
          ...(loanStatus === LoanStatus.ACTIVE
            ? { approved_at: new Date() }
            : {}),
          note,
        };

        const results = await tx.loan.updateMany({
          where: { id: loan_id, status: LoanStatus.PENDING },
          data,
        });

        if (results.count === 0) {
          throw new BadRequestException('Loan has already been processed.');
        }

        if (loanStatus === LoanStatus.ACTIVE) {
          await tx.user.update({
            where: { id: existingLoan.user.id },
            data: {
              balance: {
                increment: existingLoan.amount,
              },
            },
          });
        }

        return await tx.loan.findUnique({
          where: {
            id: existingLoan.id,
          },
        });
      },
      {
        isolationLevel: TransactionIsolationLevel.Serializable,
        maxWait: 30000,
        timeout: 30000,
      },
    );

    await this.invalidateCache(user.id);
    await this.invalidateAdminLoansCache();

    return loan;
  }

  async repayLoan(user: AuthenticatedUser, loan_id: string, amount: number) {
    const loan = await this.prismaService.$transaction(
      async (tx) => {
        const repayAmount = new Prisma.Decimal(amount);

        const existingLoan = await tx.loan.findFirst({
          where: { id: loan_id },
          select: {
            user_id: true,
            status: true,
            outstandingBalance: true,
            id: true,
            user: {
              select: {
                id: true,
                balance: true,
              },
            },
          },
        });

        if (!existingLoan) {
          throw new NotFoundException(`Loan with id ${loan_id} not found.`);
        }

        if (existingLoan.user_id !== user.id) {
          throw new ForbiddenException();
        }

        if (existingLoan.status !== LoanStatus.ACTIVE) {
          throw new BadRequestException(
            `Loan is already ${existingLoan.status}. Only active loans can be repayed.`,
          );
        }

        if (existingLoan.outstandingBalance.lessThan(repayAmount)) {
          throw new BadRequestException(
            `Excess funds deposit. Deposit: ${repayAmount.toString()}, required loan balance: ${existingLoan.outstandingBalance.toString()}.`,
          );
        }

        if (existingLoan.user.balance.lessThan(repayAmount)) {
          throw new BadRequestException(
            `Insufficient balance. Available: ${existingLoan.user.balance.toString()}, required: ${repayAmount.toString()}.`,
          );
        }

        // Deduct the amount from the user's balance
        const userResult = await tx.user.updateMany({
          where: {
            id: user.id,
            balance: {
              gte: repayAmount,
            },
          },
          data: {
            balance: {
              decrement: repayAmount,
            },
          },
        });

        if (userResult.count === 0) {
          throw new BadRequestException(
            `Insufficient balance. Available: ${existingLoan.user.balance.toString()}, required: ${repayAmount.toString()}.`,
          );
        }

        const loanUpdateResult = await tx.loan.updateMany({
          where: {
            id: loan_id,
            status: LoanStatus.ACTIVE,
            user_id: user.id,
            outstandingBalance: {
              gte: repayAmount,
            },
          },
          data: {
            outstandingBalance: {
              decrement: repayAmount,
            },
          },
        });

        if (loanUpdateResult.count === 0) {
          throw new BadRequestException(
            `Excess funds deposit. Deposit: ${repayAmount.toString()}, required loan balance: ${existingLoan.outstandingBalance.toString()}.`,
          );
        }

        let updatedLoan = await tx.loan.findUnique({
          where: { id: loan_id },
        });

        if (!updatedLoan) {
          throw new NotFoundException(`Loan with id ${loan_id} not found.`);
        }

        // Create a repayment for the loan with the amount paid and the current balance
        await tx.repayment.create({
          data: {
            loan_id,
            amount: repayAmount,
            balance_after: updatedLoan.outstandingBalance,
          },
        });

        if (updatedLoan.outstandingBalance.equals(0)) {
          await tx.loan.updateMany({
            where: { id: loan_id, status: LoanStatus.ACTIVE },
            data: {
              status: LoanStatus.COMPLETED,
              completed_at: new Date(),
            },
          });

          updatedLoan = await tx.loan.findUnique({
            where: { id: loan_id },
          });
        }

        return updatedLoan;
      },
      {
        isolationLevel: TransactionIsolationLevel.Serializable,
        maxWait: 30000,
        timeout: 30000,
      },
    );

    await this.invalidateCache(user.id);
    await this.invalidateAdminLoansCache();

    return loan;
  }

  async queryLoans(user: AuthenticatedUser, paginationDto: LoanPaginationDto) {
    const { limit, page } = paginationDto;

    const skip = (page - 1) * limit;

    const cacheKey = this.buildCacheKey(user, paginationDto);

    const cached = await this.cacheManager.get<string>(cacheKey);

    if (cached) {
      return cached;
    }

    const loans = await this.prismaService.loan.findMany({
      where: {
        user_id: user.id,
      },
      skip,
      take: limit,
      select: {
        admin_id: true,
        approved_at: true,
        completed_at: true,
        amount: true,
        created_at: true,
        updated_at: true,
        id: true,
        durationMonths: true,
        notes: true,
        status: true,
        outstandingBalance: true,
        repayments: {
          select: {
            amount: true,
            balance_after: true,
            loan_id: true,
          },
        },
      },
    });

    await this.setLoanUserCacheKey(user.id, cacheKey, loans, 60_000);

    return loans;
  }

  async adminQueryLoans(paginationDto: LoanPaginationDto) {
    const { limit, page } = paginationDto;
    const skip = (page - 1) * limit;

    const cacheKey = this.buildAdminLoansCacheKey(paginationDto);

    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached) as unknown as Loan[];
    }

    const loans = await this.prismaService.loan.findMany({
      skip,
      take: limit,
      select: {
        admin_id: true,
        approved_at: true,
        completed_at: true,
        amount: true,
        created_at: true,
        updated_at: true,
        id: true,
        durationMonths: true,
        notes: true,
        status: true,
        outstandingBalance: true,

        repayments: {
          select: {
            amount: true,
            balance_after: true,
            loan_id: true,
          },
        },
        user: {
          select: {
            name: true,
            email: true,
            role: true,
            balance: true,
          },
        },
      },
    });

    await this.setAdminLoansCacheKey(cacheKey, loans, 60_000);

    return loans;
  }

  private buildCacheKey(
    user: AuthenticatedUser,
    paginationDto: LoanPaginationDto,
  ) {
    const { limit, page } = paginationDto;
    return `loans:user:${user.id}:page:${page}:limit:${limit}`;
  }

  private async setLoanUserCacheKey(
    user_id: string,
    cacheKey: string,
    value: unknown,
    ttlMs: number = 60_000,
  ) {
    const setKey = this.buildUsersLoanCacheSetKey(user_id);

    await this.cacheManager.set(cacheKey, value, ttlMs);

    await this.cacheManager.get<string>(cacheKey);

    await this.redis.sadd(setKey, cacheKey);

    await this.redis.expire(setKey, ttlMs);
  }

  private async invalidateCache(user_id: string) {
    const setKey = this.buildUsersLoanCacheSetKey(user_id);

    const keys = await this.redis.smembers(setKey);

    if (keys.length > 0) {
      await Promise.all(keys.map((key) => this.cacheManager.del(key)));
    }

    await this.redis.del(setKey);
  }

  private buildUsersLoanCacheSetKey(user_id: string) {
    return `loans:user:${user_id}:keys`;
  }

  private buildAdminLoansCacheSetKey() {
    return `loans:admin:keys`;
  }

  private buildAdminLoansCacheKey(paginationDto: LoanPaginationDto) {
    const { page, limit } = paginationDto;
    return `loans:admin:page:${page}:limit:${limit}`;
  }

  private async setAdminLoansCacheKey(
    cacheKey: string,
    value: unknown,
    ttlMs: number = 60_000,
  ) {
    const setKey = this.buildAdminLoansCacheSetKey();

    await this.cacheManager.set(cacheKey, value, ttlMs);

    await this.redis.sadd(setKey, cacheKey);

    await this.redis.expire(setKey, Math.ceil(ttlMs / 1000));
  }

  private async invalidateAdminLoansCache() {
    const setKey = this.buildAdminLoansCacheSetKey();

    const keys = await this.redis.smembers(setKey);

    if (keys.length > 0) {
      await Promise.all(keys.map((key) => this.cacheManager.del(key)));
    }

    await this.redis.del(setKey);
  }
}
