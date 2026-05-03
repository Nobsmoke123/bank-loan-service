import { IsNumber, Min } from 'class-validator';

export class RepayLoanDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1000)
  amount: number;
}
