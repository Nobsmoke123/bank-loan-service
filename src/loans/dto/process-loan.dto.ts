import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum ProcessLoanStatus {
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export class ProcessLoanDto {
  @IsString()
  @IsEnum(ProcessLoanStatus, {
    message: 'The status should either be approved or rejected.',
  })
  status: ProcessLoanStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
