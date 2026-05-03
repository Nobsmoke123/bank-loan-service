import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ApplyLoanDto } from './dto/apply-loan.dto';
import { AuthenticatedUser } from 'src/common/interfaces/auth-user.interface';
import { LoanStatus } from 'src/prisma/generated/enums';
import { TransactionIsolationLevel } from 'src/prisma/generated/internal/prismaNamespace';
import { LoanStateMachine } from './loan-state-machine';
import { Prisma } from 'src/prisma/generated/client';
import { LoanPaginationDto } from './dto/loan-pagination.dto';
import { ProcessLoanDto, ProcessLoanStatus } from './dto/process-loan.dto';

@Injectable()
export class LoansService {
  constructor(private readonly prismaService: PrismaService) {}

  async applyLoan(user: AuthenticatedUser, applyLoanDto: ApplyLoanDto) {
    return await this.prismaService.$transaction(
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

        return await tx.loan.create({
          data: {
            user_id: user.id,
            amount: applyLoanDto.amount,
            durationMonths: applyLoanDto.durationInMonths,
            outstandingBalance: applyLoanDto.amount,
          },
        });
      },
      {
        isolationLevel: TransactionIsolationLevel.Serializable,
        maxWait: 30000,
        timeout: 30000,
      },
    );
  }

  async processLoan(
    user: AuthenticatedUser,
    loan_id: string,
    processLoanDto: ProcessLoanDto,
  ) {
    return await this.prismaService.$transaction(
      async (tx) => {
        const { status, note } = processLoanDto;

        const loanStatus =
          status === ProcessLoanStatus.APPROVED
            ? LoanStatus.ACTIVE
            : LoanStatus.REJECTED;

        const [existingLoan, existingUser] = await Promise.all([
          tx.loan.findFirst({
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
                  balance: true,
                  id: true,
                },
              },
            },
          }),

          tx.user.findFirst({
            where: {
              id: user.id,
            },
          }),
        ]);

        if (!existingLoan) {
          throw new NotFoundException(`Loan with id ${loan_id} not found.`);
        }

        if (!existingUser) {
          throw new UnauthorizedException();
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

        const loan = await tx.loan.update({
          where: { id: loan_id },
          data,
        });

        const balance = existingLoan.amount.plus(
          new Prisma.Decimal(existingLoan.user.balance),
        );

        await tx.user.update({
          where: { id: existingLoan.user.id },
          data: { balance },
        });

        return loan;
      },
      {
        isolationLevel: TransactionIsolationLevel.Serializable,
        maxWait: 30000,
        timeout: 30000,
      },
    );
  }

  async repayLoan(user: AuthenticatedUser, loan_id: string, amount: number) {
    return await this.prismaService.$transaction(
      async (tx) => {
        const [existingLoan, existingUser] = await Promise.all([
          tx.loan.findFirst({
            where: { id: loan_id },
          }),

          tx.user.findFirst({
            where: { id: user.id },
          }),
        ]);

        if (!existingLoan) {
          throw new NotFoundException(`Loan with id ${loan_id} not found.`);
        }

        if (!existingUser) {
          throw new UnauthorizedException();
        }

        if (existingLoan.user_id !== existingUser.id) {
          throw new ForbiddenException();
        }

        if (
          existingLoan.outstandingBalance.lessThan(new Prisma.Decimal(amount))
        ) {
          throw new BadRequestException(
            `Excess funds deposit. Deposit: ${amount}, required loan balance: ${existingLoan.outstandingBalance.toString()}.`,
          );
        }

        if (existingUser.balance.lessThan(new Prisma.Decimal(amount))) {
          throw new BadRequestException(
            `Insufficient balance. Available: ${existingUser.balance.toString()}, required: ${amount}.`,
          );
        }

        // Deduct the amount from the user's balance
        const updatedUserBalance = existingUser.balance.minus(
          new Prisma.Decimal(amount),
        );

        await tx.user.update({
          where: { id: user.id },
          data: {
            balance: updatedUserBalance,
          },
        });

        // Deduct the amount from the loan's outstandingBalance
        const updatedLoanBalance = existingLoan.outstandingBalance.minus(
          new Prisma.Decimal(amount),
        );

        const loanUpdateData = {
          outstandingBalance: updatedLoanBalance,
          ...(updatedLoanBalance.lessThanOrEqualTo(0)
            ? { status: LoanStatus.COMPLETED }
            : {}),
        };

        const loan = await tx.loan.update({
          where: { id: loan_id },
          data: loanUpdateData,
        });

        // Create a repayment for the loan with the amount paid and the current balance
        await tx.repayment.create({
          data: {
            loan_id,
            amount: new Prisma.Decimal(amount),
            balance_after: updatedLoanBalance,
          },
        });

        return loan;
      },
      {
        isolationLevel: TransactionIsolationLevel.Serializable,
        maxWait: 30000,
        timeout: 30000,
      },
    );
  }

  async queryLoans(user: AuthenticatedUser, paginationDto: LoanPaginationDto) {
    return await this.prismaService.$transaction(
      async (tx) => {
        const { limit, page } = paginationDto;

        const skip = (page - 1) * limit;

        const loans = await tx.loan.findMany({
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

        return loans;
      },
      {
        isolationLevel: TransactionIsolationLevel.Serializable,
        maxWait: 30000,
        timeout: 30000,
      },
    );
  }

  async adminQueryLoans(paginationDto: LoanPaginationDto) {
    return await this.prismaService.$transaction(
      async (tx) => {
        const { limit, page } = paginationDto;
        const skip = (page - 1) * limit;

        const loans = await tx.loan.findMany({
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

        return loans;
      },
      {
        isolationLevel: TransactionIsolationLevel.Serializable,
        maxWait: 30000,
        timeout: 30000,
      },
    );
  }
}
