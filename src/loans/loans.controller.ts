import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LoanPaginationDto } from './dto/loan-pagination.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AuthenticatedUser } from 'src/common/interfaces/auth-user.interface';
import { RepayLoanDto } from './dto/repay-loan.dto';
import { ProcessLoanDto } from './dto/process-loan.dto';
import { ApplyLoanDto } from './dto/apply-loan.dto';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Role } from 'src/common/decorators/role.decorator';
import { UserRole } from 'src/prisma/generated/enums';
import { LoansService } from './loans.service';

@UseGuards(AuthGuard, RoleGuard)
@Controller('loans')
export class LoansController {
  constructor(private readonly loanService: LoansService) {}

  @Post()
  @Role(UserRole.CUSTOMER)
  async applyLoan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() applyLoanDto: ApplyLoanDto,
  ) {
    return this.loanService.applyLoan(user, applyLoanDto);
  }

  @Patch(':id')
  @Role(UserRole.ADMIN)
  async processLoan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') loan_id: string,
    @Body() processLoan: ProcessLoanDto,
  ) {
    return this.loanService.processLoan(user, loan_id, processLoan);
  }

  @Post(':id/repay')
  @Role(UserRole.CUSTOMER)
  async repayLoan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') loan_id: string,
    @Body() repayLoanDto: RepayLoanDto,
  ) {
    return this.loanService.repayLoan(user, loan_id, repayLoanDto.amount);
  }

  @Get()
  async queryLoans(
    @CurrentUser() user: AuthenticatedUser,
    @Query() paginationDto: LoanPaginationDto,
  ) {
    if (user.role === 'CUSTOMER') {
      return this.loanService.queryLoans(user, paginationDto);
    } else {
      return this.loanService.adminQueryLoans(paginationDto);
    }
  }
}
